import assert from 'node:assert/strict';

import {
  parsePipelineIdentifier,
  parsePipelineNodeStatus,
  parsePipelinePageRequest,
} from './pipeline-dashboard.request.ts';

Deno.test('parses bounded Pipeline Dashboard page parameters', () => {
  assert.deepEqual(parsePipelinePageRequest(undefined, undefined), {
    page: 1,
    pageSize: 25,
  });
  assert.deepEqual(parsePipelinePageRequest('2', '100'), {
    page: 2,
    pageSize: 100,
  });
  assert.throws(() => parsePipelinePageRequest('0', '25'), /page must/);
  assert.throws(() => parsePipelinePageRequest('1', '101'), /pageSize must/);
  assert.throws(() => parsePipelinePageRequest(['1'], '25'), /page must/);
});

Deno.test('validates identifiers and Node statuses used in Redis keys', () => {
  assert.equal(parsePipelineIdentifier('run-1', 'runId'), 'run-1');
  assert.throws(() => parsePipelineIdentifier('../run', 'runId'), /invalid/);
  assert.equal(parsePipelineNodeStatus('FAILED'), 'FAILED');
  assert.throws(() => parsePipelineNodeStatus('failed'), /status must/);
});
