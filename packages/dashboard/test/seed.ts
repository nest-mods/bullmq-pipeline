import type { Job } from 'bullmq';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { Redis } from 'ioredis';

import { withResourceScope } from './resource-lifecycle.ts';

const reportQueueName = 'pipeline--social-analysis-report--report-work';
const trendQueueName = 'pipeline--social-analysis-trend--generate-trend';
const crawlQueueName = 'pipeline--social-analysis-crawl--crawl-source';
const pipelineKeyRoot = `${Deno.env.get('PIPELINE_PREFIX') ?? 'pipeline'}:`;
const pipelineRunsKey = `${pipelineKeyRoot}runs`;
const connection = {
  host: Deno.env.get('REDIS_HOST') ?? 'redis',
  port: Number(Deno.env.get('REDIS_PORT') ?? '6379'),
  maxRetriesPerRequest: null,
};

await withResourceScope(async (scope) => {
  const redis = scope.open(
    () => new Redis(connection),
    (resource) => resource.quit(),
  );
  const reportQueue = scope.open(
    () => new Queue(reportQueueName, { connection }),
    (resource) => resource.close(),
  );
  const trendQueue = scope.open(
    () => new Queue(trendQueueName, { connection }),
    (resource) => resource.close(),
  );
  const crawlQueue = scope.open(
    () => new Queue(crawlQueueName, { connection }),
    (resource) => resource.close(),
  );
  const queues = [reportQueue, trendQueue, crawlQueue];
  const reportEvents = scope.open(
    () => new QueueEvents(reportQueueName, { connection }),
    (resource) => resource.close(),
  );
  const trendEvents = scope.open(
    () => new QueueEvents(trendQueueName, { connection }),
    (resource) => resource.close(),
  );
  const crawlEvents = scope.open(
    () => new QueueEvents(crawlQueueName, { connection }),
    (resource) => resource.close(),
  );
  const queueEvents = [reportEvents, trendEvents, crawlEvents];

  await Promise.all([
    redis.ping(),
    ...queues.map((queue) => queue.waitUntilReady()),
    ...queueEvents.map((events) => events.waitUntilReady()),
  ]);

  const retainedJobOptions = {
    removeOnComplete: false,
    removeOnFail: false,
  };
  const reportJob = await reportQueue.add(
    'report-work',
    { fixture: 'dashboard-e2e' },
    { ...retainedJobOptions, jobId: 'report-job', attempts: 1 },
  );
  const trendJob = await trendQueue.add(
    'generate-trend',
    { fixture: 'dashboard-e2e' },
    { ...retainedJobOptions, jobId: 'trend-job', attempts: 3 },
  );
  const crawlJob = await crawlQueue.add(
    'crawl-source',
    { fixture: 'dashboard-e2e' },
    { ...retainedJobOptions, jobId: 'crawl-job', attempts: 3 },
  );

  const completionResults = Promise.allSettled([
    reportJob.waitUntilFinished(reportEvents, 30_000),
    trendJob.waitUntilFinished(trendEvents, 30_000),
    crawlJob.waitUntilFinished(crawlEvents, 30_000),
  ]);

  const reportWorker = scope.open(
    () =>
      new Worker(
        reportQueueName,
        async (job) => {
          await job.updateProgress({ records: 24 });
          return { records: 24 };
        },
        { connection },
      ),
    (resource) => resource.close(),
  );
  reportWorker.on('error', scope.reportError);
  const trendWorker = scope.open(
    () =>
      new Worker(
        trendQueueName,
        async (job) => {
          await job.updateProgress({ records: 12 });
          if (job.attemptsMade === 0) {
            throw new Error('trend first attempt failed');
          }
          return { records: 12 };
        },
        { connection },
      ),
    (resource) => resource.close(),
  );
  trendWorker.on('error', scope.reportError);
  const crawlWorker = scope.open(
    () =>
      new Worker(
        crawlQueueName,
        async (job) => {
          await job.updateProgress({ pages: 4 });
          throw new Error('provider failed');
        },
        { connection },
      ),
    (resource) => resource.close(),
  );
  crawlWorker.on('error', scope.reportError);
  const workers: Worker[] = [reportWorker, trendWorker, crawlWorker];
  await Promise.all(workers.map((worker) => worker.waitUntilReady()));

  const [reportResult, trendResult, crawlResult] = await completionResults;
  assertCompleted('report-job', reportResult);
  assertCompleted('trend-job', trendResult);
  if (
    crawlResult.status !== 'rejected' ||
    !String(crawlResult.reason).includes('provider failed')
  ) {
    throw new Error(
      `crawl-job must fail with provider failed, received ${
        String(crawlResult)
      }`,
    );
  }
  const persistedJobs = await Promise.all([
    getPersistedJob(reportQueue, 'report-job'),
    getPersistedJob(trendQueue, 'trend-job'),
    getPersistedJob(crawlQueue, 'crawl-job'),
  ]);
  await seedDashboardFixtures(redis, persistedJobs);
  console.log('real BullMQ jobs and dashboard fixtures seeded');
});

function assertCompleted(
  jobId: string,
  result: PromiseSettledResult<unknown>,
): void {
  if (result.status === 'rejected') {
    throw new Error(`${jobId} did not complete`, { cause: result.reason });
  }
}

async function getPersistedJob(queue: Queue, jobId: string): Promise<Job> {
  const job = await queue.getJob(jobId);
  if (!job) throw new Error(`BullMQ job ${jobId} disappeared after processing`);
  return job;
}

async function seedDashboardFixtures(
  redisClient: Redis,
  jobs: Job[],
): Promise<void> {
  const [reportJob, trendJob, crawlJob] = jobs;
  const pipeline = redisClient.pipeline();
  const runId = 'dashboard-e2e-run';
  pipeline.zadd(pipelineRunsKey, 1999997, runId);
  pipeline.hset(pipelineRunKey(runId), {
    id: runId,
    name: 'social-analysis-report',
    pipelineName: 'social-analysis-report',
    status: 'RUNNING',
    error: '',
    pendingNodes: 1,
    failedNodes: 1,
    createdAt: 1784500000000,
    updatedAt: 1784503600000,
  });

  const nodesKey = `${pipelineRunKey(runId)}:nodes`;
  pipeline.zadd(
    nodesKey,
    1001,
    'report-node',
    1002,
    'trend-node',
    1003,
    'crawl-node',
  );
  const nodeFixtures = [
    {
      id: 'report-node',
      pipelineName: 'social-analysis-report',
      invocationId: 'report-invocation',
      scopeId: 'report-scope',
      parentNodeIds: [],
      job: reportJob,
    },
    {
      id: 'trend-node',
      pipelineName: 'social-analysis-trend',
      invocationId: 'trend-invocation',
      scopeId: 'trend-scope',
      parentNodeIds: ['report-node'],
      job: trendJob,
    },
    {
      id: 'crawl-node',
      pipelineName: 'social-analysis-crawl',
      invocationId: 'crawl-invocation',
      scopeId: 'crawl-scope',
      parentNodeIds: ['report-node'],
      job: crawlJob,
    },
  ];
  for (const fixture of nodeFixtures) {
    const state = await fixture.job.getState();
    const jobId = fixture.job.id;
    if (!jobId) throw new Error(`BullMQ job for ${fixture.id} has no ID`);
    pipeline.hset(`${pipelineRunKey(runId)}:node:${fixture.id}`, {
      id: fixture.id,
      runId,
      pipelineName: fixture.pipelineName,
      invocationId: fixture.invocationId,
      scopeId: fixture.scopeId,
      name: fixture.job.name,
      stepName: fixture.job.name,
      stage: fixture.job.name,
      status: state.toUpperCase(),
      parentNodeIds: JSON.stringify(fixture.parentNodeIds),
      queueName: fixture.job.queueName,
      jobId,
      attempt: fixture.job.attemptsMade,
      maxAttempts: fixture.job.opts.attempts ?? 1,
      progress: JSON.stringify(fixture.job.progress),
      error: state === 'failed' ? fixture.job.failedReason : '',
    });
  }

  pipeline.zadd(
    pipelineRunsKey,
    2000003,
    'missing-run',
    2000002,
    'dashboard-expired-completed',
    2000001,
    'dashboard-expired-failed',
    2000000,
    'dashboard-expired-running',
    1999999,
    'dashboard-malformed-run',
    1999998,
    'dashboard-stress-run',
  );
  const completedRunKey = pipelineRunKey('dashboard-expired-completed');
  pipeline.hset(completedRunKey, {
    id: 'dashboard-expired-completed',
    name: 'expired-completed',
    pipelineName: 'retention-pipeline',
    status: 'COMPLETED',
    expiresAt: 1,
  });
  pipeline.zadd(
    `${completedRunKey}:nodes`,
    1,
    'expired-completed-node',
  );
  pipeline.hset(
    `${completedRunKey}:node:expired-completed-node`,
    {
      id: 'expired-completed-node',
      runId: 'dashboard-expired-completed',
      status: 'COMPLETED',
      stepName: 'retention-checkpoint',
    },
  );
  pipeline.hset(pipelineRunKey('dashboard-expired-failed'), {
    id: 'dashboard-expired-failed',
    name: 'expired-failed',
    pipelineName: 'retention-pipeline',
    status: 'FAILED',
    expiresAt: 1,
  });
  pipeline.hset(pipelineRunKey('dashboard-expired-running'), {
    id: 'dashboard-expired-running',
    name: 'expired-running',
    pipelineName: 'retention-pipeline',
    status: 'RUNNING',
    pendingNodes: 2,
    failedNodes: 0,
    createdAt: 100,
    updatedAt: 200,
    expiresAt: 1,
  });
  const malformedRunKey = pipelineRunKey('dashboard-malformed-run');
  pipeline.hset(malformedRunKey, {
    id: 'dashboard-malformed-run',
    name: '',
    pipelineName: '',
    status: '',
    error: '',
    pendingNodes: 'invalid',
    failedNodes: '',
    createdAt: 'invalid',
    updatedAt: '',
    completedAt: 'Infinity',
    expiresAt: 'NaN',
  });

  const malformedNodesKey = `${malformedRunKey}:nodes`;
  pipeline.zadd(
    malformedNodesKey,
    1,
    'invalid-json-node',
    2,
    'wrong-type-node',
    3,
    'missing-node-hash',
  );
  pipeline.hset(
    `${malformedRunKey}:node:invalid-json-node`,
    {
      id: 'invalid-json-node',
      runId: '',
      pipelineName: '',
      invocationId: '',
      scopeId: '',
      name: '',
      stepName: '',
      stage: '',
      status: '',
      parentNodeIds: 'not-json',
      queueName: '',
      jobId: '',
      attempt: 'invalid',
      maxAttempts: '',
      progress: 'not-json',
      forkName: '',
      error: '',
      createdAt: 'invalid',
      updatedAt: '',
      startedAt: 'NaN',
      completedAt: '',
    },
  );
  pipeline.hset(
    `${malformedRunKey}:node:wrong-type-node`,
    {
      id: 'wrong-type-node',
      runId: '',
      pipelineName: '',
      invocationId: '',
      scopeId: '',
      name: '',
      stepName: '',
      stage: 'fallback-stage',
      status: '',
      parentNodeIds: '{"parent":"wrong-type"}',
      queueName: '',
      jobId: '',
      attempt: '',
      maxAttempts: 'invalid',
      progress: '["wrong-type"]',
      forkName: '',
      error: '',
      createdAt: '',
      updatedAt: 'invalid',
      startedAt: '',
      completedAt: 'Infinity',
    },
  );

  const stressRunKey = pipelineRunKey('dashboard-stress-run');
  pipeline.hset(stressRunKey, {
    id: 'dashboard-stress-run',
    name: 'stress-pipeline',
    pipelineName: 'stress-pipeline',
    status: 'RUNNING',
    pendingNodes: 180,
    failedNodes: 0,
    createdAt: 300,
    updatedAt: 400,
  });
  const stressNodesKey = `${stressRunKey}:nodes`;
  for (let depth = 0; depth < 10; depth++) {
    for (let index = 0; index < 20; index++) {
      const nodeId = stressNodeId(depth, index);
      const parentNodeIds = depth === 0 ? [] : [stressNodeId(depth - 1, index)];
      pipeline.zadd(stressNodesKey, depth * 20 + index, nodeId);
      pipeline.hset(
        `${stressRunKey}:node:${nodeId}`,
        {
          id: nodeId,
          runId: 'dashboard-stress-run',
          pipelineName: 'stress-pipeline',
          name: `depth-${depth}`,
          stepName: `depth-${depth}`,
          stage: `depth-${depth}`,
          status: 'PENDING',
          parentNodeIds: JSON.stringify(parentNodeIds),
          attempt: 1,
          maxAttempts: 1,
          progress: JSON.stringify({ depth, index }),
        },
      );
    }
  }

  for (let index = 1; index <= 105; index++) {
    const suffix = String(index).padStart(3, '0');
    const bulkId = `dashboard-bulk-${suffix}`;
    pipeline.zadd(pipelineRunsKey, 1000000 + index, bulkId);
    pipeline.hset(pipelineRunKey(bulkId), {
      id: bulkId,
      name: `bulk-${suffix}`,
      pipelineName: 'bulk-pipeline',
      status: 'COMPLETED',
      pendingNodes: 0,
      failedNodes: 0,
      createdAt: index,
      updatedAt: index,
    });
  }

  const results = await pipeline.exec();
  if (results === null) throw new Error('Redis fixture pipeline was aborted');
  const commandError = results.find(([error]) => error !== null)?.[0];
  if (commandError) throw commandError;
}

function pipelineRunKey(runId: string): string {
  return `${pipelineKeyRoot}run:${runId}`;
}

function stressNodeId(depth: number, index: number): string {
  return `stress-d${String(depth).padStart(2, '0')}-n${
    String(index).padStart(2, '0')
  }`;
}
