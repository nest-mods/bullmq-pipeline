import assert from 'node:assert/strict';
import { Queue } from 'bullmq';

const expectedJobs = [
  {
    queueName: 'pipeline--social-analysis-report--report-work',
    jobId: 'report-job',
    state: 'completed',
    attemptsMade: 1,
    maxAttempts: 1,
    progress: { records: 24 },
  },
  {
    queueName: 'pipeline--social-analysis-trend--generate-trend',
    jobId: 'trend-job',
    state: 'completed',
    attemptsMade: 2,
    maxAttempts: 3,
    progress: { records: 12 },
  },
  {
    queueName: 'pipeline--social-analysis-crawl--crawl-source',
    jobId: 'crawl-job',
    state: 'failed',
    attemptsMade: 3,
    maxAttempts: 3,
    progress: { pages: 4 },
    failedReason: 'provider failed',
  },
] as const;

const connection = {
  host: Deno.env.get('REDIS_HOST') ?? 'redis',
  port: Number(Deno.env.get('REDIS_PORT') ?? '6379'),
  maxRetriesPerRequest: null,
};
const queues = expectedJobs.map(({ queueName }) =>
  new Queue(queueName, { connection })
);
const summaries: Record<string, unknown>[] = [];

try {
  for (const [index, expected] of expectedJobs.entries()) {
    const queue = queues[index];
    const job = await queue.getJob(expected.jobId);
    assert.ok(
      job,
      `expected BullMQ job ${expected.jobId} to exist in queue ${expected.queueName}`,
    );
    assert.equal(job.id, expected.jobId);
    assert.equal(job.queueName, expected.queueName);
    assert.equal(await job.getState(), expected.state);
    assert.equal(job.attemptsMade, expected.attemptsMade);
    assert.equal(job.opts.attempts ?? 1, expected.maxAttempts);
    assert.deepEqual(job.progress, expected.progress);
    if ('failedReason' in expected) {
      assert.equal(job.failedReason, expected.failedReason);
    }

    summaries.push({
      queueName: job.queueName,
      jobId: job.id,
      state: await job.getState(),
      attemptsMade: job.attemptsMade,
      progress: job.progress,
      failedReason: job.failedReason,
    });
  }
} finally {
  await Promise.all(queues.map((queue) => queue.close()));
}

console.log(`real BullMQ jobs passed: ${JSON.stringify(summaries)}`);
