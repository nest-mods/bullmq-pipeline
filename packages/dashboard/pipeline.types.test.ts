import assert from 'node:assert/strict';

import type {
  PipelineErrorResponse,
  PipelineNodeSnapshot,
  PipelineRunDetails,
  PipelineRunsResponse,
  PipelineRunSummary,
  PipelineStageNodesResponse,
  PipelineStageSummary,
} from './pipeline.types.ts';

Deno.test('exports the shared pipeline dashboard transport DTOs', () => {
  const run = {
    id: 'run-1',
    pipelineName: 'pipeline-1',
    status: 'RUNNING',
    error: '',
    createdNodes: 3,
    completedNodes: 1,
    pendingNodes: 1,
    failedNodes: 1,
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
    stageId: 'stage-1',
    stepName: 'step-1',
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
    order: 1,
  } satisfies PipelineNodeSnapshot;
  const stage = {
    id: 'stage-1',
    runId: run.id,
    invocationId: 'invocation-1',
    pipelineName: run.pipelineName,
    stepName: 'step-1',
    parentStageIds: [],
    counts: {
      PENDING: 0,
      RUNNING: 1,
      RETRYING: 0,
      COMPLETED: 1,
      FAILED: 1,
    },
    createdAt: 1,
    updatedAt: 2,
  } satisfies PipelineStageSummary;
  const pageInfo = {
    page: 1,
    pageSize: 25,
    hasPreviousPage: false,
    hasNextPage: false,
  };
  const details = { run, stages: [stage] } satisfies PipelineRunDetails;
  const runs = { runs: [], pageInfo } satisfies PipelineRunsResponse;
  const stageNodes = {
    nodes: [node],
    pageInfo,
  } satisfies PipelineStageNodesResponse;
  const error = { error: 'missing' } satisfies PipelineErrorResponse;

  assert.deepEqual(details, { run, stages: [stage] });
  assert.deepEqual(runs, { runs: [], pageInfo });
  assert.deepEqual(stageNodes, { nodes: [node], pageInfo });
  assert.deepEqual(error, { error: 'missing' });
});
