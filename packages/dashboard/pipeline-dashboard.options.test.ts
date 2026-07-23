import assert from 'node:assert/strict';

import { parsePipelineDashboardOptions } from './pipeline-dashboard.options.ts';

Deno.test('defaults the pipeline namespace prefix to pipeline', () => {
  assert.deepEqual(parsePipelineDashboardOptions(undefined), {
    prefix: 'pipeline',
  });
  assert.deepEqual(parsePipelineDashboardOptions({}), { prefix: 'pipeline' });
});

Deno.test('preserves a configured pipeline namespace prefix', () => {
  assert.deepEqual(
    parsePipelineDashboardOptions({ prefix: 'tenant_pipeline' }),
    { prefix: 'tenant_pipeline' },
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

Deno.test('rejects a non-string pipeline namespace prefix', () => {
  assert.throws(
    () => parsePipelineDashboardOptions({ prefix: 1 }),
    TypeError,
    'Pipeline dashboard option "prefix" must be a string',
  );
});

Deno.test('rejects a pipeline namespace prefix that the runtime cannot use', () => {
  for (const prefix of ['', ':pipeline', 'tenant:', 'tenant pipeline']) {
    assert.throws(
      () => parsePipelineDashboardOptions({ prefix }),
      TypeError,
      'Pipeline dashboard option "prefix" must start with a letter or number',
    );
  }
});
