import assert from 'node:assert/strict';

import { withResourceScope } from './resource-lifecycle.ts';

Deno.test('preserves the primary error and every shutdown error', async () => {
  const primaryError = new Error('primary failed');
  const workerEventError = new Error('worker emitted during close');
  const workerCloseError = new Error('worker close failed');
  const redisQuitError = new Error('redis quit failed');
  const cleanupOrder: string[] = [];

  const thrown = await rejectionOf(() =>
    withResourceScope((scope) => {
      scope.open(() => 'redis', () => {
        cleanupOrder.push('redis');
        throw redisQuitError;
      });
      scope.open(() => 'worker', () => {
        cleanupOrder.push('worker');
        scope.reportError(workerEventError);
        throw workerCloseError;
      });
      throw primaryError;
    })
  );

  assert.ok(thrown instanceof AggregateError);
  assert.deepEqual(thrown.errors, [
    primaryError,
    workerEventError,
    workerCloseError,
    redisQuitError,
  ]);
  assert.deepEqual(cleanupOrder, ['worker', 'redis']);
});

Deno.test('cleans registered resources after later construction fails', async () => {
  const constructionError = new Error('next constructor failed');
  const cleanupOrder: string[] = [];

  const thrown = await rejectionOf(() =>
    withResourceScope((scope) => {
      scope.open(() => 'first queue', () => {
        cleanupOrder.push('first queue');
      });
      scope.open(() => {
        throw constructionError;
      }, () => {
        cleanupOrder.push('unreachable');
      });
    })
  );

  assert.equal(thrown, constructionError);
  assert.deepEqual(cleanupOrder, ['first queue']);
});

async function rejectionOf(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error('expected action to reject');
}
