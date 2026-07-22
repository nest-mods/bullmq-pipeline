import type { BullBoardExtension } from 'bull-board-docker/extensions';
import type { Request, Response } from 'express';
import { parsePipelineDashboardOptions } from './pipeline-dashboard.options.ts';
import type {
  PipelineErrorResponse,
  PipelineRunDetails,
  PipelineRunsResponse,
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
      async (_request: Request, response: Response<PipelineRunsResponse>) => {
        response.json({ runs: await repository.listRuns() });
      },
    );

    context.router.get(
      '/api/pipelines/:runId',
      async (
        request: Request,
        response: Response<PipelineRunDetails | PipelineErrorResponse>,
      ) => {
        const details = await repository.getRun(request.params.runId);
        if (!details) {
          response.status(404).json({
            error: `Pipeline run ${request.params.runId} not found`,
          });
          return;
        }
        response.json(details);
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

export default extension;
