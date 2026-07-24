import assert from 'node:assert/strict';

import {
  type PipelineRedisClient,
  PipelineRunRepository,
} from './pipeline-run.repository.ts';

class RecordingRedis implements PipelineRedisClient {
  readonly calls: string[] = [];
  readonly hashes = new Map<string, Record<string, string>>();
  readonly sortedSets = new Map<string, string[]>();
  readonly sets = new Map<string, string[]>();

  hgetall(key: string): Promise<Record<string, string>> {
    this.calls.push(`hgetall ${key}`);
    return Promise.resolve(this.hashes.get(key) ?? {});
  }

  smembers(key: string): Promise<string[]> {
    this.calls.push(`smembers ${key}`);
    return Promise.resolve(this.sets.get(key) ?? []);
  }

  zcard(key: string): Promise<number> {
    this.calls.push(`zcard ${key}`);
    return Promise.resolve(this.sortedSets.get(key)?.length ?? 0);
  }

  zrange(key: string, start: number, end: number): Promise<string[]> {
    this.calls.push(`zrange ${key} ${start} ${end}`);
    return Promise.resolve(
      this.range(this.sortedSets.get(key) ?? [], start, end),
    );
  }

  zrevrange(key: string, start: number, end: number): Promise<string[]> {
    this.calls.push(`zrevrange ${key} ${start} ${end}`);
    return Promise.resolve(
      this.range([...(this.sortedSets.get(key) ?? [])].reverse(), start, end),
    );
  }

  private range(values: string[], start: number, end: number): string[] {
    return values.slice(start, end < 0 ? undefined : end + 1);
  }
}

Deno.test('reads a bounded page from the configured pipeline namespace', async () => {
  const redis = new RecordingRedis();
  const repository = new PipelineRunRepository(redis, { prefix: 'tenant' });
  redis.sortedSets.set('tenant:runs', ['run-1', 'run-2', 'run-3']);
  for (const runId of ['run-1', 'run-2', 'run-3']) {
    redis.hashes.set(`tenant:run:${runId}`, {
      id: runId,
      pipelineName: 'pipeline-1',
      status: 'RUNNING',
      error: '',
      createdNodes: '3',
      completedNodes: '1',
      pendingNodes: '1',
      failedNodes: '1',
    });
  }

  const response = await repository.listRuns({ page: 1, pageSize: 2 });

  assert.deepEqual(response.runs.map((run) => run.id), ['run-3', 'run-2']);
  assert.deepEqual(response.pageInfo, {
    page: 1,
    pageSize: 2,
    hasPreviousPage: false,
    hasNextPage: true,
  });
  assert.deepEqual(response.runs[0], {
    id: 'run-3',
    pipelineName: 'pipeline-1',
    status: 'RUNNING',
    error: '',
    createdNodes: 3,
    completedNodes: 1,
    pendingNodes: 1,
    failedNodes: 1,
    createdAt: null,
    updatedAt: null,
    completedAt: null,
    expiresAt: null,
  });
  assert.equal(redis.calls[0], 'zrevrange tenant:runs 0 2');
});

Deno.test('skips a Run whose Hash disappeared without mutating Redis', async () => {
  const redis = new RecordingRedis();
  const repository = new PipelineRunRepository(redis);
  redis.sortedSets.set('pipeline:runs', ['active', 'missing']);
  redis.hashes.set('pipeline:run:active', {
    id: 'active',
    pipelineName: 'pipeline-1',
    status: 'RUNNING',
    error: '',
    createdNodes: '0',
    completedNodes: '0',
    pendingNodes: '0',
    failedNodes: '0',
  });

  const response = await repository.listRuns({ page: 1, pageSize: 2 });

  assert.deepEqual(response.runs.map((run) => run.id), ['active']);
  assert.deepEqual(redis.sortedSets.get('pipeline:runs'), [
    'active',
    'missing',
  ]);
});

Deno.test('returns Stage summaries without reading every Node', async () => {
  const redis = new RecordingRedis();
  const repository = new PipelineRunRepository(redis);
  redis.hashes.set('pipeline:run:run-1', {
    id: 'run-1',
    pipelineName: 'report',
    status: 'RUNNING',
    error: '',
    createdNodes: '4',
    completedNodes: '1',
    pendingNodes: '2',
    failedNodes: '1',
  });
  redis.sortedSets.set('pipeline:run:run-1:stages', ['stage-1', 'stage-2']);
  redis.hashes.set('pipeline:run:run-1:stage:stage-1', {
    id: 'stage-1',
    runId: 'run-1',
    invocationId: 'invocation-1',
    pipelineName: 'report',
    stepName: 'prepare',
    createdAt: '1',
    updatedAt: '2',
  });
  redis.hashes.set('pipeline:run:run-1:stage:stage-1:counts', {
    PENDING: '0',
    RUNNING: '0',
    RETRYING: '0',
    COMPLETED: '1',
    FAILED: '0',
  });
  redis.hashes.set('pipeline:run:run-1:stage:stage-2', {
    id: 'stage-2',
    runId: 'run-1',
    invocationId: 'invocation-1',
    pipelineName: 'report',
    stepName: 'collect',
  });
  redis.hashes.set('pipeline:run:run-1:stage:stage-2:counts', {
    PENDING: '2',
    RUNNING: '0',
    RETRYING: '0',
    COMPLETED: '0',
    FAILED: '1',
  });
  redis.sets.set('pipeline:run:run-1:stage:stage-2:parents', ['stage-1']);

  const details = await repository.getRun('run-1');

  assert.deepEqual(details?.stages, [
    {
      id: 'stage-1',
      runId: 'run-1',
      invocationId: 'invocation-1',
      pipelineName: 'report',
      stepName: 'prepare',
      parentStageIds: [],
      counts: {
        PENDING: 0,
        RUNNING: 0,
        RETRYING: 0,
        COMPLETED: 1,
        FAILED: 0,
      },
      createdAt: 1,
      updatedAt: 2,
    },
    {
      id: 'stage-2',
      runId: 'run-1',
      invocationId: 'invocation-1',
      pipelineName: 'report',
      stepName: 'collect',
      parentStageIds: ['stage-1'],
      counts: {
        PENDING: 2,
        RUNNING: 0,
        RETRYING: 0,
        COMPLETED: 0,
        FAILED: 1,
      },
      createdAt: null,
      updatedAt: null,
    },
  ]);
  assert.ok(
    redis.calls.every((call) => !call.includes('run:run-1:nodes ')),
    `run details must not scan Node indexes: ${redis.calls.join(', ')}`,
  );
});

Deno.test('pages Nodes within one Stage status index', async () => {
  const redis = new RecordingRedis();
  const repository = new PipelineRunRepository(redis);
  redis.hashes.set('pipeline:run:run-1', {
    id: 'run-1',
    pipelineName: 'report',
  });
  redis.hashes.set('pipeline:run:run-1:stage:stage-1', {
    id: 'stage-1',
    runId: 'run-1',
    pipelineName: 'crawl',
    stepName: 'crawl-source',
  });
  redis.sortedSets.set(
    'pipeline:run:run-1:stage:stage-1:nodes:FAILED',
    ['node-1', 'node-2', 'node-3'],
  );
  for (const nodeId of ['node-1', 'node-2', 'node-3']) {
    redis.hashes.set(`pipeline:run:run-1:node:${nodeId}`, {
      id: nodeId,
      runId: 'run-1',
      pipelineName: 'crawl',
      invocationId: 'invocation-1',
      scopeId: 'scope-1',
      stageId: 'stage-1',
      stepName: 'crawl-source',
      status: 'FAILED',
      parentNodeIds: '[]',
      queueName: 'pipeline--crawl--crawl-source',
      jobId: nodeId,
      attempt: '3',
      maxAttempts: '3',
      progress: '{}',
      forkName: '',
      error: 'provider failed',
      order: nodeId.slice(-1),
    });
  }

  const response = await repository.getStageNodes(
    'run-1',
    'stage-1',
    'FAILED',
    { page: 2, pageSize: 1 },
  );

  assert.deepEqual(response?.nodes.map((node) => node.id), ['node-2']);
  assert.deepEqual(response?.pageInfo, {
    page: 2,
    pageSize: 1,
    hasPreviousPage: true,
    hasNextPage: true,
  });
  assert.equal(response?.nodes[0].stageId, 'stage-1');
  assert.equal(response?.nodes[0].order, 2);
  assert.ok(
    redis.calls.includes(
      'zrange pipeline:run:run-1:stage:stage-1:nodes:FAILED 1 2',
    ),
  );
});

Deno.test('keeps a 5000-Node Stage query bounded to one page', async () => {
  const redis = new RecordingRedis();
  const repository = new PipelineRunRepository(redis);
  redis.hashes.set('pipeline:run:run-1', {
    id: 'run-1',
    pipelineName: 'stress',
  });
  redis.hashes.set('pipeline:run:run-1:stage:stage-1', {
    id: 'stage-1',
    pipelineName: 'stress',
  });
  const nodeIds = Array.from(
    { length: 5_000 },
    (_, index) => `node-${String(index).padStart(4, '0')}`,
  );
  redis.sortedSets.set(
    'pipeline:run:run-1:stage:stage-1:nodes:COMPLETED',
    nodeIds,
  );
  for (const nodeId of nodeIds.slice(0, 25)) {
    redis.hashes.set(`pipeline:run:run-1:node:${nodeId}`, {
      id: nodeId,
      runId: 'run-1',
      pipelineName: 'stress',
      invocationId: 'invocation-1',
      scopeId: 'scope-1',
      stageId: 'stage-1',
      stepName: 'collect',
      status: 'COMPLETED',
      parentNodeIds: '[]',
      queueName: 'pipeline--stress--collect',
      jobId: nodeId,
      attempt: '1',
      maxAttempts: '1',
      progress: '{}',
      forkName: '',
      error: '',
      order: nodeId.slice(-4),
    });
  }

  const response = await repository.getStageNodes(
    'run-1',
    'stage-1',
    'COMPLETED',
  );

  assert.equal(response?.nodes.length, 25);
  assert.equal(response?.pageInfo.hasNextPage, true);
  assert.equal(
    redis.calls.filter((call) => call.includes(':node:')).length,
    25,
  );
  assert.ok(
    redis.calls.includes(
      'zrange pipeline:run:run-1:stage:stage-1:nodes:COMPLETED 0 25',
    ),
  );
});

Deno.test('returns null when a Run or Stage no longer exists', async () => {
  const redis = new RecordingRedis();
  const repository = new PipelineRunRepository(redis);

  assert.equal(await repository.getRun('missing'), null);
  assert.equal(
    await repository.getStageNodes('missing', 'stage-1', 'FAILED'),
    null,
  );

  redis.hashes.set('pipeline:run:run-1', {
    id: 'run-1',
    pipelineName: 'report',
  });
  assert.equal(
    await repository.getStageNodes('run-1', 'missing', 'FAILED'),
    null,
  );
});
