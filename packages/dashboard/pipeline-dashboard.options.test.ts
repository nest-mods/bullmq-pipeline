import assert from 'node:assert/strict';

import { parsePipelineDashboardOptions } from './pipeline-dashboard.options.ts';

Deno.test('defaults the Redis key prefix to an empty string', () => {
  assert.deepEqual(parsePipelineDashboardOptions(undefined), { keyPrefix: '' });
  assert.deepEqual(parsePipelineDashboardOptions({}), { keyPrefix: '' });
});

Deno.test('preserves a configured Redis key prefix verbatim', () => {
  assert.deepEqual(
    parsePipelineDashboardOptions({ keyPrefix: 'tenant:' }),
    { keyPrefix: 'tenant:' },
  );
});

Deno.test('rejects non-object extension options', () => {
  for (const value of [null, [], 'tenant:', 1, true]) {
    assert.throws(
      () => parsePipelineDashboardOptions(value),
      TypeError,
      'Pipeline dashboard options must be an object',
    );
  }
});

Deno.test('rejects a non-string Redis key prefix', () => {
  assert.throws(
    () => parsePipelineDashboardOptions({ keyPrefix: 1 }),
    TypeError,
    'Pipeline dashboard option "keyPrefix" must be a string',
  );
});
