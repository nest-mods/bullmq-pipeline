import type { Job } from 'bullmq';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { Redis } from 'ioredis';

import type { PipelineNodeStatus } from '../pipeline.types.ts';
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
    pipelineName: 'social-analysis-report',
    status: 'RUNNING',
    error: '',
    createdNodes: 4,
    completedNodes: 2,
    pendingNodes: 1,
    failedNodes: 1,
    createdAt: 1784500000000,
    updatedAt: 1784503600000,
  });

  const runKey = pipelineRunKey(runId);
  const nodesKey = `${runKey}:nodes`;
  pipeline.zadd(
    nodesKey,
    1001,
    'report-node',
    1002,
    'trend-node',
    1003,
    'crawl-node',
    1004,
    'finalize-node',
  );
  const nodeFixtures = [
    {
      id: 'report-node',
      pipelineName: 'social-analysis-report',
      invocationId: 'report-invocation',
      scopeId: 'report-scope',
      stageId: 'report-stage',
      order: 1001,
      parentStageIds: [],
      parentNodeIds: [],
      job: reportJob,
    },
    {
      id: 'trend-node',
      pipelineName: 'social-analysis-trend',
      invocationId: 'trend-invocation',
      scopeId: 'trend-scope',
      stageId: 'trend-stage',
      order: 1002,
      parentStageIds: ['report-stage'],
      parentNodeIds: ['report-node'],
      job: trendJob,
    },
    {
      id: 'crawl-node',
      pipelineName: 'social-analysis-crawl',
      invocationId: 'crawl-invocation',
      scopeId: 'crawl-scope',
      stageId: 'crawl-stage',
      order: 1003,
      parentStageIds: ['report-stage'],
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
      stageId: fixture.stageId,
      stepName: fixture.job.name,
      status: state.toUpperCase(),
      parentNodeIds: JSON.stringify(fixture.parentNodeIds),
      queueName: fixture.job.queueName,
      jobId,
      attempt: fixture.job.attemptsMade,
      maxAttempts: fixture.job.opts.attempts ?? 1,
      progress: JSON.stringify(fixture.job.progress),
      forkName: '',
      error: state === 'failed' ? fixture.job.failedReason : '',
      order: fixture.order,
      createdAt: 1784500000000,
      updatedAt: 1784503600000,
    });
    pipeline.zadd(`${runKey}:stages`, fixture.order, fixture.stageId);
    pipeline.hset(`${runKey}:stage:${fixture.stageId}`, {
      id: fixture.stageId,
      runId,
      invocationId: fixture.invocationId,
      pipelineName: fixture.pipelineName,
      stepName: fixture.job.name,
      createdAt: 1784500000000,
      updatedAt: 1784503600000,
    });
    pipeline.hset(`${runKey}:stage:${fixture.stageId}:counts`, {
      PENDING: 0,
      RUNNING: 0,
      RETRYING: 0,
      COMPLETED: state === 'completed' ? 1 : 0,
      FAILED: state === 'failed' ? 1 : 0,
    });
    if (fixture.parentStageIds.length > 0) {
      pipeline.sadd(
        `${runKey}:stage:${fixture.stageId}:parents`,
        ...fixture.parentStageIds,
      );
    }
    pipeline.zadd(
      `${runKey}:stage:${fixture.stageId}:nodes:${state.toUpperCase()}`,
      fixture.order,
      fixture.id,
    );
  }
  pipeline.zadd(`${runKey}:stages`, 1004, 'finalize-stage');
  pipeline.hset(`${runKey}:stage:finalize-stage`, {
    id: 'finalize-stage',
    runId,
    invocationId: 'report-invocation',
    pipelineName: 'social-analysis-report',
    stepName: 'complete-report-generation',
    createdAt: 1784503600000,
    updatedAt: 1784503600000,
  });
  pipeline.hset(`${runKey}:stage:finalize-stage:counts`, {
    PENDING: 1,
    RUNNING: 0,
    RETRYING: 0,
    COMPLETED: 0,
    FAILED: 0,
  });
  pipeline.sadd(
    `${runKey}:stage:finalize-stage:parents`,
    'trend-stage',
    'crawl-stage',
  );
  pipeline.zadd(
    `${runKey}:stage:finalize-stage:nodes:PENDING`,
    1004,
    'finalize-node',
  );
  pipeline.hset(`${runKey}:node:finalize-node`, {
    id: 'finalize-node',
    runId,
    pipelineName: 'social-analysis-report',
    invocationId: 'report-invocation',
    scopeId: 'report-scope',
    stageId: 'finalize-stage',
    stepName: 'complete-report-generation',
    status: 'PENDING',
    parentNodeIds: JSON.stringify(['trend-node', 'crawl-node']),
    queueName: reportQueueName,
    jobId: '',
    attempt: 0,
    maxAttempts: 1,
    progress: '{}',
    forkName: '',
    error: '',
    order: 1004,
    createdAt: 1784503600000,
    updatedAt: 1784503600000,
  });

  pipeline.zadd(
    pipelineRunsKey,
    2000003,
    'missing-run',
  );

  const cardinalities = [100, 500, 1_000, 5_000];
  const statuses: PipelineNodeStatus[] = [
    'PENDING',
    'RUNNING',
    'RETRYING',
    'COMPLETED',
    'FAILED',
  ];
  for (const cardinality of cardinalities) {
    const cardinalityRunId = cardinality === 5_000
      ? 'dashboard-stress-run'
      : `dashboard-cardinality-${cardinality}`;
    const cardinalityRunKey = pipelineRunKey(cardinalityRunId);
    const nodesPerStage = cardinality / 10;
    pipeline.zadd(
      pipelineRunsKey,
      1999998 - cardinalities.indexOf(cardinality),
      cardinalityRunId,
    );
    pipeline.hset(cardinalityRunKey, {
      id: cardinalityRunId,
      pipelineName: 'stress-pipeline',
      status: 'FAILED',
      error: '',
      createdNodes: cardinality,
      completedNodes: cardinality / 5,
      pendingNodes: cardinality * 3 / 5,
      failedNodes: cardinality / 5,
      createdAt: 300,
      updatedAt: 400,
    });
    for (let depth = 0; depth < 10; depth++) {
      const stageId = stressStageId(depth);
      pipeline.zadd(`${cardinalityRunKey}:stages`, depth, stageId);
      pipeline.hset(`${cardinalityRunKey}:stage:${stageId}`, {
        id: stageId,
        runId: cardinalityRunId,
        invocationId: 'stress-invocation',
        pipelineName: 'stress-pipeline',
        stepName: `depth-${depth}`,
        createdAt: 300 + depth,
        updatedAt: 400,
      });
      pipeline.hset(`${cardinalityRunKey}:stage:${stageId}:counts`, {
        PENDING: nodesPerStage / 5,
        RUNNING: nodesPerStage / 5,
        RETRYING: nodesPerStage / 5,
        COMPLETED: nodesPerStage / 5,
        FAILED: nodesPerStage / 5,
      });
      if (depth > 0) {
        pipeline.sadd(
          `${cardinalityRunKey}:stage:${stageId}:parents`,
          stressStageId(depth - 1),
        );
      }
      for (let index = 0; index < nodesPerStage; index++) {
        const nodeId = stressNodeId(depth, index);
        const parentNodeIds = depth === 0
          ? []
          : [stressNodeId(depth - 1, index)];
        const status = statuses[index % statuses.length];
        const order = depth * nodesPerStage + index;
        pipeline.zadd(`${cardinalityRunKey}:nodes`, order, nodeId);
        pipeline.zadd(
          `${cardinalityRunKey}:stage:${stageId}:nodes:${status}`,
          order,
          nodeId,
        );
        pipeline.hset(`${cardinalityRunKey}:node:${nodeId}`, {
          id: nodeId,
          runId: cardinalityRunId,
          pipelineName: 'stress-pipeline',
          invocationId: 'stress-invocation',
          scopeId: 'stress-scope',
          stageId,
          stepName: `depth-${depth}`,
          status,
          parentNodeIds: JSON.stringify(parentNodeIds),
          queueName: `pipeline--stress-pipeline--depth-${depth}`,
          jobId: nodeId,
          attempt: status === 'RETRYING' ? 2 : 1,
          maxAttempts: 3,
          progress: JSON.stringify({ depth, index }),
          forkName: '',
          error: status === 'FAILED' ? `failure ${nodeId}` : '',
          order,
          createdAt: 300 + order,
          updatedAt: 400,
        });
      }
    }
  }

  for (let index = 1; index <= 105; index++) {
    const suffix = String(index).padStart(3, '0');
    const bulkId = `dashboard-bulk-${suffix}`;
    pipeline.zadd(pipelineRunsKey, 1000000 + index, bulkId);
    pipeline.hset(pipelineRunKey(bulkId), {
      id: bulkId,
      pipelineName: 'bulk-pipeline',
      status: 'COMPLETED',
      error: '',
      createdNodes: index,
      completedNodes: index,
      pendingNodes: 0,
      failedNodes: 0,
      createdAt: index,
      updatedAt: index,
      completedAt: index,
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

function stressStageId(depth: number): string {
  return `stress-stage-${String(depth).padStart(2, '0')}`;
}
