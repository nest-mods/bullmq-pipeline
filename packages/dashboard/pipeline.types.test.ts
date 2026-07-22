import assert from 'node:assert/strict';

import type {
  PipelineErrorResponse,
  PipelineNodeSnapshot,
  PipelineRunDetails,
  PipelineRunsResponse,
  PipelineRunSummary,
} from './pipeline.types.ts';

Deno.test('exports the shared pipeline dashboard transport DTOs', () => {
  const run = {
    id: 'run-1',
    name: 'run-1',
    pipelineName: 'pipeline-1',
    status: 'RUNNING',
    error: '',
    pendingNodes: 1,
    failedNodes: 0,
    createdAt: 1,
    updatedAt: 2,
    completedAt: null,
    expiresAt: null,
  } satisfies PipelineRunSummary;
  const node = {
    id: 'node-1',
    runId: run.id,
    pipelineName: run.pipelineName,
    invocationId: 'invocation-1',
    scopeId: 'scope-1',
    name: 'node-1',
    stepName: 'step-1',
    stage: 'step-1',
    status: 'RUNNING',
    parentNodeIds: [],
    queueName: 'pipeline--pipeline-1--step-1',
    jobId: 'job-1',
    attempt: 1,
    maxAttempts: 3,
    progress: {},
    forkName: '',
    error: '',
    createdAt: 1,
    updatedAt: 2,
    startedAt: 2,
    completedAt: null,
  } satisfies PipelineNodeSnapshot;
  const details = { run, nodes: [node] } satisfies PipelineRunDetails;
  const runs = { runs: [] } satisfies PipelineRunsResponse;
  const error = { error: 'missing' } satisfies PipelineErrorResponse;

  assert.deepEqual(details, { run, nodes: [node] });
  assert.deepEqual(runs, { runs: [] });
  assert.deepEqual(error, { error: 'missing' });
});
