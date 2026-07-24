import type {
  PipelineNodeStatus,
  PipelinePageRequest,
} from './pipeline.types.ts';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const NODE_STATUSES = new Set<PipelineNodeStatus>([
  'PENDING',
  'RUNNING',
  'RETRYING',
  'COMPLETED',
  'FAILED',
]);

export class PipelineDashboardRequestError extends Error {}

export function parsePipelinePageRequest(
  pageValue: unknown,
  pageSizeValue: unknown,
): PipelinePageRequest {
  return {
    page: positiveInteger(pageValue, 'page', 1),
    pageSize: positiveInteger(
      pageSizeValue,
      'pageSize',
      DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    ),
  };
}

export function parsePipelineIdentifier(value: string, name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new PipelineDashboardRequestError(`${name} is invalid`);
  }
  return value;
}

export function parsePipelineNodeStatus(value: unknown): PipelineNodeStatus {
  if (
    typeof value !== 'string' || !NODE_STATUSES.has(value as PipelineNodeStatus)
  ) {
    throw new PipelineDashboardRequestError(
      'status must be PENDING, RUNNING, RETRYING, COMPLETED, or FAILED',
    );
  }
  return value as PipelineNodeStatus;
}

function positiveInteger(
  value: unknown,
  name: string,
  fallback: number,
  maximum?: number,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new PipelineDashboardRequestError(
      `${name} must be a positive integer`,
    );
  }
  const parsed = Number(value);
  if (parsed < 1 || (maximum !== undefined && parsed > maximum)) {
    const suffix = maximum === undefined ? '' : ` no greater than ${maximum}`;
    throw new PipelineDashboardRequestError(
      `${name} must be a positive integer${suffix}`,
    );
  }
  return parsed;
}
