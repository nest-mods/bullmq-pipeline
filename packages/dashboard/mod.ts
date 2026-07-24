import type { BullBoardExtension } from 'bull-board-docker/extensions';
import type { Request, Response } from 'express';
import { parsePipelineDashboardOptions } from './pipeline-dashboard.options.ts';
import {
  parsePipelineIdentifier,
  parsePipelineNodeStatus,
  parsePipelinePageRequest,
  PipelineDashboardRequestError,
} from './pipeline-dashboard.request.ts';
import type {
  PipelineErrorResponse,
  PipelineRunDetails,
  PipelineRunsResponse,
  PipelineStageNodesResponse,
} from './pipeline.types.ts';
import dashboardHtml from './public/index.html' with { type: 'text' };
import { PipelineRunRepository } from './pipeline-run.repository.ts';

const extension: BullBoardExtension = {
  id: 'pipeline-dashboard',
  apiVersion: 1,
  activate(context, rawOptions) {
    const options = parsePipelineDashboardOptions(rawOptions);
    const repository = new PipelineRunRepository(context.redis, options);

    context.router.get(
      '/api/pipelines',
      async (
        request: Request,
        response: Response<PipelineRunsResponse | PipelineErrorResponse>,
      ) => {
        try {
          response.json(
            await repository.listRuns(
              parsePipelinePageRequest(
                request.query.page,
                request.query.pageSize,
              ),
            ),
          );
        } catch (error) {
          respondToRequestError(response, error);
        }
      },
    );

    context.router.get(
      '/api/pipelines/:runId',
      async (
        request: Request,
        response: Response<PipelineRunDetails | PipelineErrorResponse>,
      ) => {
        let runId: string;
        try {
          runId = parsePipelineIdentifier(request.params.runId, 'runId');
        } catch (error) {
          respondToRequestError(response, error);
          return;
        }
        const details = await repository.getRun(runId);
        if (!details) {
          response.status(404).json({
            error: `Pipeline run ${runId} not found`,
          });
          return;
        }
        response.json(details);
      },
    );

    context.router.get(
      '/api/pipelines/:runId/stages/:stageId/nodes',
      async (
        request: Request,
        response: Response<PipelineStageNodesResponse | PipelineErrorResponse>,
      ) => {
        let runId: string;
        let stageId: string;
        try {
          runId = parsePipelineIdentifier(request.params.runId, 'runId');
          stageId = parsePipelineIdentifier(request.params.stageId, 'stageId');
          const result = await repository.getStageNodes(
            runId,
            stageId,
            parsePipelineNodeStatus(request.query.status),
            parsePipelinePageRequest(
              request.query.page,
              request.query.pageSize,
            ),
          );
          if (!result) {
            response.status(404).json({
              error: `Pipeline stage ${stageId} not found in run ${runId}`,
            });
            return;
          }
          response.json(result);
        } catch (error) {
          respondToRequestError(response, error);
        }
      },
    );

    context.router.get('/', (_request: Request, response: Response) => {
      response.type('html').send(dashboardHtml);
    });

    context.pages.mount({
      root: new URL('./public/', import.meta.url),
      preload: [
        'index.html',
        'pipeline-dashboard.ts',
        'pipeline-dashboard.css',
      ],
    });
    context.addLink({ text: 'Pipelines', path: '/' });
  },
};

function respondToRequestError(
  response: Response<PipelineErrorResponse>,
  error: unknown,
): void {
  if (error instanceof PipelineDashboardRequestError) {
    response.status(400).json({ error: error.message });
    return;
  }
  throw error;
}

export default extension;
