import assert from 'node:assert/strict';

import {
  type PipelineRedisClient,
  PipelineRunRepository,
} from './pipeline-run.repository.ts';

class RecordingRedis implements PipelineRedisClient {
  readonly calls: string[] = [];

  hgetall(key: string): Promise<Record<string, string>> {
    this.calls.push(`hgetall ${key}`);
    if (key.endsWith(':node:node-1')) {
      return Promise.resolve({ id: 'node-1' });
    }
    return Promise.resolve({
      id: 'run-1',
      pipelineName: 'pipeline-1',
      status: 'RUNNING',
    });
  }

  zrange(key: string, start: number, end: number): Promise<string[]> {
    this.calls.push(`zrange ${key} ${start} ${end}`);
    return Promise.resolve(['node-1']);
  }

  zrevrange(key: string, start: number, end: number): Promise<string[]> {
    this.calls.push(`zrevrange ${key} ${start} ${end}`);
    return Promise.resolve(['run-1']);
  }

  zrem(key: string, ...members: string[]): Promise<number> {
    this.calls.push(`zrem ${key} ${members.join(' ')}`);
    return Promise.resolve(members.length);
  }
}

Deno.test('uses the unprefixed pipeline namespace by default', async () => {
  const redis = new RecordingRedis();
  await assertRepositoryKeys('', new PipelineRunRepository(redis), redis);
});

Deno.test('prepends a configured key prefix verbatim', async () => {
  const redis = new RecordingRedis();
  const repository = new PipelineRunRepository(redis, { keyPrefix: 'tenant:' });
  await assertRepositoryKeys('tenant:', repository, redis);
});

async function assertRepositoryKeys(
  prefix: string,
  repository: PipelineRunRepository,
  redis: RecordingRedis,
): Promise<void> {
  await repository.listRuns();
  await repository.getRun('run-1');

  assert.deepEqual(redis.calls, [
    `zrevrange ${prefix}pipeline:runs 0 -1`,
    `hgetall ${prefix}pipeline:run:run-1`,
    `hgetall ${prefix}pipeline:run:run-1`,
    `zrange ${prefix}pipeline:run:run-1:nodes 0 -1`,
    `hgetall ${prefix}pipeline:run:run-1:node:node-1`,
  ]);
}
