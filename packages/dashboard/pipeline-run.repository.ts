import type {
  PipelineNodeSnapshot,
  PipelineNodeStatus,
  PipelinePageInfo,
  PipelinePageRequest,
  PipelineRunDetails,
  PipelineRunsResponse,
  PipelineRunStatus,
  PipelineRunSummary,
  PipelineStageCounts,
  PipelineStageNodesResponse,
  PipelineStageSummary,
} from './pipeline.types.ts';

export interface PipelineRedisClient {
  hgetall(key: string): Promise<Record<string, string>>;
  smembers(key: string): Promise<string[]>;
  zrange(key: string, start: number, end: number): Promise<string[]>;
  zrevrange(key: string, start: number, end: number): Promise<string[]>;
}

export interface PipelineRunRepositoryOptions {
  prefix?: string;
}

export interface PipelineRunReader {
  listRuns(page?: PipelinePageRequest): Promise<PipelineRunsResponse>;
  getRun(runId: string): Promise<PipelineRunDetails | null>;
  getStageNodes(
    runId: string,
    stageId: string,
    status: PipelineNodeStatus,
    page?: PipelinePageRequest,
  ): Promise<PipelineStageNodesResponse | null>;
}

export class PipelineRunRepository implements PipelineRunReader {
  private readonly keyRoot: string;

  constructor(
    private readonly redis: PipelineRedisClient,
    options: PipelineRunRepositoryOptions = {},
  ) {
    this.keyRoot = `${options.prefix ?? 'pipeline'}:`;
  }

  async listRuns(
    request: PipelinePageRequest = {},
  ): Promise<PipelineRunsResponse> {
    const page = this.page(request);
    const offset = (page.page - 1) * page.pageSize;
    const runIds = await this.redis.zrevrange(
      `${this.keyRoot}runs`,
      offset,
      offset + page.pageSize,
    );
    const runs = await Promise.all(
      runIds.map(async (runId) =>
        this.parseRun(await this.redis.hgetall(this.runKey(runId)))
      ),
    );
    return {
      runs: runs
        .filter((run): run is PipelineRunSummary => run !== null)
        .slice(0, page.pageSize),
      pageInfo: this.pageInfo(
        page,
        runIds.length > page.pageSize,
      ),
    };
  }

  async getRun(runId: string): Promise<PipelineRunDetails | null> {
    const run = this.parseRun(await this.redis.hgetall(this.runKey(runId)));
    if (!run) return null;

    const stageIds = await this.redis.zrange(this.stagesKey(runId), 0, -1);
    const stages = await Promise.all(
      stageIds.map(async (stageId) => await this.readStage(runId, stageId)),
    );

    return {
      run,
      stages: stages.filter((stage): stage is PipelineStageSummary =>
        stage !== null
      ),
    };
  }

  async getStageNodes(
    runId: string,
    stageId: string,
    status: PipelineNodeStatus,
    request: PipelinePageRequest = {},
  ): Promise<PipelineStageNodesResponse | null> {
    const [run, stage] = await Promise.all([
      this.redis.hgetall(this.runKey(runId)),
      this.redis.hgetall(this.stageKey(runId, stageId)),
    ]);
    if (!run.id || !stage.id) return null;

    const page = this.page(request);
    const offset = (page.page - 1) * page.pageSize;
    const nodeIds = await this.redis.zrange(
      this.stageNodesKey(runId, stageId, status),
      offset,
      offset + page.pageSize,
    );
    const nodes = await Promise.all(
      nodeIds.slice(0, page.pageSize).map(async (nodeId) =>
        this.parseNode(await this.redis.hgetall(this.nodeKey(runId, nodeId)))
      ),
    );

    return {
      nodes: nodes.filter((node): node is PipelineNodeSnapshot =>
        node !== null
      ),
      pageInfo: this.pageInfo(page, nodeIds.length > page.pageSize),
    };
  }

  private async readStage(
    runId: string,
    stageId: string,
  ): Promise<PipelineStageSummary | null> {
    const [stage, counts, parentStageIds] = await Promise.all([
      this.redis.hgetall(this.stageKey(runId, stageId)),
      this.redis.hgetall(this.stageCountsKey(runId, stageId)),
      this.redis.smembers(this.stageParentsKey(runId, stageId)),
    ]);
    if (!stage.id) return null;

    return {
      id: stage.id,
      runId: stage.runId,
      invocationId: stage.invocationId,
      pipelineName: stage.pipelineName,
      stepName: stage.stepName,
      parentStageIds: parentStageIds.sort(),
      counts: this.parseCounts(counts),
      createdAt: this.nullableNumber(stage.createdAt),
      updatedAt: this.nullableNumber(stage.updatedAt),
    };
  }

  private parseRun(data: Record<string, string>): PipelineRunSummary | null {
    if (!data.id) return null;

    return {
      id: data.id,
      pipelineName: data.pipelineName,
      status: data.status as PipelineRunStatus,
      error: data.error,
      createdNodes: Number(data.createdNodes),
      completedNodes: Number(data.completedNodes),
      pendingNodes: Number(data.pendingNodes),
      failedNodes: Number(data.failedNodes),
      createdAt: this.nullableNumber(data.createdAt),
      updatedAt: this.nullableNumber(data.updatedAt),
      completedAt: this.nullableNumber(data.completedAt),
      expiresAt: this.nullableNumber(data.expiresAt),
    };
  }

  private parseNode(
    data: Record<string, string>,
  ): PipelineNodeSnapshot | null {
    if (!data.id) return null;

    return {
      id: data.id,
      runId: data.runId,
      pipelineName: data.pipelineName,
      invocationId: data.invocationId,
      scopeId: data.scopeId,
      stageId: data.stageId,
      stepName: data.stepName,
      status: data.status as PipelineNodeStatus,
      parentNodeIds: this.stringArray(data.parentNodeIds),
      queueName: data.queueName,
      jobId: data.jobId,
      attempt: Number(data.attempt),
      maxAttempts: Number(data.maxAttempts),
      progress: this.jsonObject(data.progress),
      forkName: data.forkName,
      error: data.error,
      order: Number(data.order),
      createdAt: this.nullableNumber(data.createdAt),
      updatedAt: this.nullableNumber(data.updatedAt),
      startedAt: this.nullableNumber(data.startedAt),
      completedAt: this.nullableNumber(data.completedAt),
    };
  }

  private parseCounts(data: Record<string, string>): PipelineStageCounts {
    return {
      PENDING: Number(data.PENDING),
      RUNNING: Number(data.RUNNING),
      RETRYING: Number(data.RETRYING),
      COMPLETED: Number(data.COMPLETED),
      FAILED: Number(data.FAILED),
    };
  }

  private page(request: PipelinePageRequest): Required<PipelinePageRequest> {
    return {
      page: request.page ?? 1,
      pageSize: request.pageSize ?? 25,
    };
  }

  private pageInfo(
    page: Required<PipelinePageRequest>,
    hasNextPage: boolean,
  ): PipelinePageInfo {
    return {
      ...page,
      hasPreviousPage: page.page > 1,
      hasNextPage,
    };
  }

  private nullableNumber(value: string | undefined): number | null {
    if (!value) return null;
    return Number(value);
  }

  private stringArray(value: string): string[] {
    return JSON.parse(value) as string[];
  }

  private jsonObject(value: string): Record<string, unknown> {
    return JSON.parse(value) as Record<string, unknown>;
  }

  private runKey(runId: string): string {
    return `${this.keyRoot}run:${runId}`;
  }

  private stagesKey(runId: string): string {
    return `${this.runKey(runId)}:stages`;
  }

  private stageKey(runId: string, stageId: string): string {
    return `${this.runKey(runId)}:stage:${stageId}`;
  }

  private stageParentsKey(runId: string, stageId: string): string {
    return `${this.stageKey(runId, stageId)}:parents`;
  }

  private stageCountsKey(runId: string, stageId: string): string {
    return `${this.stageKey(runId, stageId)}:counts`;
  }

  private stageNodesKey(
    runId: string,
    stageId: string,
    status: PipelineNodeStatus,
  ): string {
    return `${this.stageKey(runId, stageId)}:nodes:${status}`;
  }

  private nodeKey(runId: string, nodeId: string): string {
    return `${this.runKey(runId)}:node:${nodeId}`;
  }
}
