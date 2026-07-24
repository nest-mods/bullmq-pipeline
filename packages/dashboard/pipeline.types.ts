export type PipelineNodeStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'RETRYING'
  | 'COMPLETED'
  | 'FAILED';

export type PipelineRunStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED';

export interface PipelinePageRequest {
  page?: number;
  pageSize?: number;
}

export interface PipelinePageInfo {
  page: number;
  pageSize: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
}

export interface PipelineRunSummary {
  id: string;
  pipelineName: string;
  status: PipelineRunStatus;
  error: string;
  createdNodes: number;
  completedNodes: number;
  pendingNodes: number;
  failedNodes: number;
  createdAt: number | null;
  updatedAt: number | null;
  completedAt: number | null;
  expiresAt: number | null;
}

export interface PipelineStageCounts {
  PENDING: number;
  RUNNING: number;
  RETRYING: number;
  COMPLETED: number;
  FAILED: number;
}

export interface PipelineStageSummary {
  id: string;
  runId: string;
  invocationId: string;
  pipelineName: string;
  stepName: string;
  parentStageIds: string[];
  counts: PipelineStageCounts;
  createdAt: number | null;
  updatedAt: number | null;
}

export interface PipelineNodeSnapshot {
  id: string;
  runId: string;
  pipelineName: string;
  invocationId: string;
  scopeId: string;
  stageId: string;
  stepName: string;
  status: PipelineNodeStatus;
  parentNodeIds: string[];
  queueName: string;
  jobId: string;
  attempt: number;
  maxAttempts: number;
  progress: Record<string, unknown>;
  forkName: string;
  error: string;
  order: number;
  createdAt: number | null;
  updatedAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
}

export interface PipelineRunDetails {
  run: PipelineRunSummary;
  stages: PipelineStageSummary[];
}

export interface PipelineRunsResponse {
  runs: PipelineRunSummary[];
  pageInfo: PipelinePageInfo;
}

export interface PipelineStageNodesResponse {
  nodes: PipelineNodeSnapshot[];
  pageInfo: PipelinePageInfo;
}

export interface PipelineErrorResponse {
  error: string;
}
