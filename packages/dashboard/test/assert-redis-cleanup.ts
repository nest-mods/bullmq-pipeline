import assert from 'node:assert/strict';
import { Redis } from 'ioredis';

import { withResourceScope } from './resource-lifecycle.ts';

const pipelineKeyRoot = `${Deno.env.get('PIPELINE_KEY_PREFIX') ?? ''}pipeline:`;
const runsKey = `${pipelineKeyRoot}runs`;
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
  await redis.ping();

  for (
    const runId of [
      'missing-run',
      'dashboard-expired-completed',
      'dashboard-expired-failed',
    ]
  ) {
    assert.equal(
      await redis.zscore(runsKey, runId),
      null,
      `${runId} must be removed from ${runsKey}`,
    );
  }

  const completedKey = pipelineRunKey('dashboard-expired-completed');
  await assertHashFields(redis, completedKey, {
    id: 'dashboard-expired-completed',
    status: 'COMPLETED',
    expiresAt: '1',
  });

  const failedKey = pipelineRunKey('dashboard-expired-failed');
  await assertHashFields(redis, failedKey, {
    id: 'dashboard-expired-failed',
    status: 'FAILED',
    expiresAt: '1',
  });

  const completedNodeId = 'expired-completed-node';
  assert.equal(
    await redis.zscore(`${completedKey}:nodes`, completedNodeId),
    '1',
    'the completed run node index must remain unchanged',
  );
  await assertHashFields(redis, `${completedKey}:node:${completedNodeId}`, {
    id: completedNodeId,
    runId: 'dashboard-expired-completed',
    status: 'COMPLETED',
    stepName: 'retention-checkpoint',
  });

  assert.equal(
    await redis.zscore(runsKey, 'dashboard-expired-running'),
    '2000000',
    'an expired running run must remain indexed',
  );
  assert.equal(
    await redis.zcard(runsKey),
    109,
    'the run index must retain exactly 109 members',
  );

  console.log(
    'real Redis stale-index cleanup, running retention, and snapshot preservation passed',
  );
});

function pipelineRunKey(runId: string): string {
  return `${pipelineKeyRoot}run:${runId}`;
}

async function assertHashFields(
  redis: Redis,
  key: string,
  expectedFields: Record<string, string>,
): Promise<void> {
  assert.equal(await redis.type(key), 'hash', `${key} must remain a HASH`);
  for (const [field, expected] of Object.entries(expectedFields)) {
    assert.equal(
      await redis.hget(key, field),
      expected,
      `${key} must retain ${field}=${expected}`,
    );
  }
}
