import type {
  PipelineErrorResponse,
  PipelineNodeSnapshot,
  PipelineNodeStatus,
  PipelinePageInfo,
  PipelineRunDetails,
  PipelineRunsResponse,
  PipelineRunSummary,
  PipelineStageNodesResponse,
  PipelineStageSummary,
} from '../pipeline.types.ts';

interface PipelineGraphColumn {
  depth: number;
  stages: PipelineStageSummary[];
}

const LIST_PAGE_SIZE = 25;
const NODE_PAGE_SIZE = 25;
const STATUS_ORDER: PipelineNodeStatus[] = [
  'FAILED',
  'RETRYING',
  'RUNNING',
  'PENDING',
  'COMPLETED',
];

(() => {
  const root = document.querySelector<HTMLElement>('#pipeline-dashboard');
  if (!root) return;

  const extensionRoot = new URL('.', globalThis.location.href);
  const boardRoot = new URL('../../', extensionRoot);
  const search = new URLSearchParams(globalThis.location.search);
  const runId = search.get('runId') || '';
  const runPage = positivePage(search.get('page'));
  const stageElements = new Map<string, HTMLElement>();
  let resizeObserver: ResizeObserver | undefined;
  let redrawEdges: (() => void) | undefined;
  let lastUpdatedAt: number | null = null;

  globalThis.addEventListener('resize', () => redrawEdges?.(), {
    passive: true,
  });

  function element<Tag extends keyof HTMLElementTagNameMap>(
    tag: Tag,
    className = '',
    text?: unknown,
  ): HTMLElementTagNameMap[Tag] {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text !== undefined) result.textContent = String(text);
    return result;
  }

  function append<Parent extends HTMLElement>(
    parent: Parent,
    ...children: Array<HTMLElement | SVGElement | null | undefined>
  ): Parent {
    parent.append(
      ...children.filter(Boolean) as Array<HTMLElement | SVGElement>,
    );
    return parent;
  }

  function positivePage(value: string | null): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
  }

  function statusBadge(status: PipelineNodeStatus): HTMLSpanElement {
    const badge = element('span', 'status', status);
    badge.dataset.status = status;
    return badge;
  }

  function formatTime(value: number | null): string {
    return value ? new Date(value).toLocaleString() : '-';
  }

  function refreshControl(): HTMLDivElement {
    const control = element('div', 'refresh-control');
    const updated = element(
      'span',
      'last-updated',
      lastUpdatedAt
        ? `Updated ${new Date(lastUpdatedAt).toLocaleTimeString()}`
        : 'Not refreshed yet',
    );
    const button = element('button', 'refresh-button', 'Refresh');
    button.type = 'button';
    button.title = 'Refresh pipeline data';
    button.addEventListener('click', () => globalThis.location.reload());
    append(control, updated, button);
    return control;
  }

  function pageActions(primary: HTMLElement): HTMLDivElement {
    return append(element('div', 'page-actions'), primary, refreshControl());
  }

  function extensionUrl(pathname: string): URL {
    return new URL(pathname.replace(/^\/+/, ''), extensionRoot);
  }

  function pipelineRunPath(id: string): string {
    const url = new URL(extensionRoot);
    url.searchParams.set('runId', id);
    return url.href;
  }

  function pipelineListPath(page: number): string {
    const url = new URL(extensionRoot);
    if (page > 1) url.searchParams.set('page', String(page));
    return url.href;
  }

  function jobPath(queueName: string, jobId: string): string {
    return new URL(
      `queue/${encodeURIComponent(queueName)}/${encodeURIComponent(jobId)}`,
      boardRoot,
    ).href;
  }

  function copyJobIdButton(jobId: string): HTMLButtonElement {
    const button = element('button', 'copy-job-id');
    button.type = 'button';
    button.title = 'Copy Job ID';
    button.setAttribute('aria-label', 'Copy Job ID');
    button.addEventListener('click', async () => {
      await navigator.clipboard.writeText(jobId);
      button.dataset.copied = 'true';
      button.title = 'Copied';
      button.setAttribute('aria-label', 'Job ID copied');
      globalThis.setTimeout(() => {
        delete button.dataset.copied;
        button.title = 'Copy Job ID';
        button.setAttribute('aria-label', 'Copy Job ID');
      }, 1_200);
    });
    return button;
  }

  async function requestJson<T>(pathname: string): Promise<T | null> {
    const response = await fetch(extensionUrl(pathname), {
      headers: { Accept: 'application/json' },
    });
    const contentType = response.headers.get('content-type') || '';

    if (response.redirected && !contentType.includes('application/json')) {
      globalThis.location.assign(response.url);
      return null;
    }

    if (!response.ok) {
      let message = `Request failed with status ${response.status}`;
      if (contentType.includes('application/json')) {
        const body = await response.json() as PipelineErrorResponse;
        if (body && body.error) message = body.error;
      }
      throw new Error(message);
    }

    return response.json() as Promise<T>;
  }

  function renderError(error: unknown): void {
    const page = element('section', 'page');
    append(
      page,
      pageActions(element('span', 'run-count', 'Pipeline data unavailable')),
      element(
        'div',
        'error',
        error instanceof Error ? error.message : String(error),
      ),
    );
    root!.replaceChildren(page);
  }

  function runTaskSummary(run: PipelineRunSummary): string {
    if (run.completedAt !== null) {
      return `${run.createdNodes} tasks${
        run.failedNodes > 0 ? ` · ${run.failedNodes} failed` : ''
      }`;
    }
    return `${run.completedNodes} completed · ${run.pendingNodes} unfinished${
      run.failedNodes > 0 ? ` · ${run.failedNodes} failed` : ''
    }`;
  }

  function pagination(
    pageInfo: PipelinePageInfo,
    pathForPage: (page: number) => string,
  ): HTMLElement {
    const nav = element('nav', 'pagination');
    nav.setAttribute('aria-label', 'Pagination');
    const previous = element('a', 'pagination-link', 'Previous');
    previous.href = pathForPage(Math.max(1, pageInfo.page - 1));
    if (!pageInfo.hasPreviousPage) {
      previous.setAttribute('aria-disabled', 'true');
      previous.tabIndex = -1;
    }
    const next = element('a', 'pagination-link', 'Next');
    next.href = pathForPage(pageInfo.page + 1);
    if (!pageInfo.hasNextPage) {
      next.setAttribute('aria-disabled', 'true');
      next.tabIndex = -1;
    }
    append(
      nav,
      previous,
      element('span', 'pagination-page', `Page ${pageInfo.page}`),
      next,
    );
    return nav;
  }

  function renderRuns(response: PipelineRunsResponse): void {
    const { runs, pageInfo } = response;
    const section = element('section', 'page');
    const header = element('header', 'page-header');
    const title = element('div');
    append(
      title,
      element('p', 'eyebrow', 'Last 24 hours'),
      element('h1', '', 'Pipeline runs'),
    );
    append(
      header,
      title,
      pageActions(element('span', 'run-count', `Page ${pageInfo.page}`)),
    );
    section.append(header);

    if (runs.length === 0) {
      section.append(
        element('div', 'empty', 'No pipeline runs reported on this page.'),
        pagination(pageInfo, pipelineListPath),
      );
      root!.replaceChildren(section);
      return;
    }

    const frame = element('div', 'table-frame');
    const table = element('table', 'runs-table');
    const head = element('thead');
    const headingRow = element('tr');
    ['Pipeline', 'Status', 'Tasks', 'Updated'].forEach((label) =>
      headingRow.append(element('th', '', label))
    );
    head.append(headingRow);

    const body = element('tbody');
    runs.forEach((run) => {
      const row = element('tr');
      const pipelineCell = element('td');
      const pipelineLink = element('a', 'pipeline-link', run.pipelineName);
      pipelineLink.href = pipelineRunPath(run.id);
      pipelineCell.append(pipelineLink);

      const statusCell = element('td');
      statusCell.append(statusBadge(run.status));

      append(
        row,
        pipelineCell,
        statusCell,
        element('td', 'task-summary', runTaskSummary(run)),
        element('td', '', formatTime(run.updatedAt)),
      );
      body.append(row);
    });

    append(table, head, body);
    frame.append(table);
    section.append(frame, pagination(pageInfo, pipelineListPath));
    root!.replaceChildren(section);
  }

  function layoutStages(stages: PipelineStageSummary[]): PipelineGraphColumn[] {
    const stagesById = new Map(stages.map((stage) => [stage.id, stage]));
    const depths = new Map<string, number>();
    const visiting = new Set<string>();

    function depthOf(stage: PipelineStageSummary): number {
      if (depths.has(stage.id)) return depths.get(stage.id)!;
      if (visiting.has(stage.id)) return 0;

      visiting.add(stage.id);
      const parents = stage.parentStageIds
        .map((parentId) => stagesById.get(parentId))
        .filter(Boolean) as PipelineStageSummary[];
      const depth = parents.length === 0
        ? 0
        : Math.max(...parents.map((parent) => depthOf(parent))) + 1;
      visiting.delete(stage.id);
      depths.set(stage.id, depth);
      return depth;
    }

    const columns = new Map<number, PipelineStageSummary[]>();
    stages.forEach((stage) => {
      const depth = depthOf(stage);
      const column = columns.get(depth) ?? [];
      column.push(stage);
      columns.set(depth, column);
    });

    return [...columns.entries()]
      .sort(([left], [right]) => left - right)
      .map(([depth, columnStages]) => ({ depth, stages: columnStages }));
  }

  function stageState(stage: PipelineStageSummary): PipelineNodeStatus {
    return STATUS_ORDER.find((status) => stage.counts[status] > 0) ?? 'PENDING';
  }

  function stageCard(
    stage: PipelineStageSummary,
    inspect: (stage: PipelineStageSummary, status: PipelineNodeStatus) => void,
  ): HTMLElement {
    const card = element('article', 'stage-card');
    card.dataset.stageId = stage.id;
    card.dataset.status = stageState(stage);
    const total = STATUS_ORDER.reduce(
      (sum, status) => sum + stage.counts[status],
      0,
    );
    append(
      card,
      append(
        element('header', 'stage-card-header'),
        append(
          element('div'),
          element('h2', '', stage.stepName),
          element('p', '', stage.pipelineName),
        ),
        element('span', 'stage-total', `${total} tasks`),
      ),
    );

    const statuses = element('div', 'stage-statuses');
    STATUS_ORDER.forEach((status) => {
      const count = stage.counts[status];
      const button = element('button', 'stage-status');
      button.type = 'button';
      button.dataset.status = status;
      button.title = `View ${status.toLowerCase()} tasks`;
      button.disabled = count === 0;
      append(
        button,
        element('strong', '', count),
        element('span', '', status.toLowerCase()),
      );
      if (count > 0) {
        button.addEventListener('click', () => inspect(stage, status));
      }
      statuses.append(button);
    });
    card.append(statuses);
    return card;
  }

  function createConnectors(): SVGSVGElement {
    const namespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(namespace, 'svg');
    svg.classList.add('connectors');
    svg.setAttribute('aria-hidden', 'true');

    const definitions = document.createElementNS(namespace, 'defs');
    const marker = document.createElementNS(namespace, 'marker');
    marker.id = 'pipeline-arrow';
    marker.setAttribute('markerHeight', '6');
    marker.setAttribute('markerWidth', '6');
    marker.setAttribute('orient', 'auto');
    marker.setAttribute('refX', '5');
    marker.setAttribute('refY', '3');
    const arrow = document.createElementNS(namespace, 'path');
    arrow.classList.add('connector-arrow');
    arrow.setAttribute('d', 'M 0 0 L 6 3 L 0 6 z');
    marker.append(arrow);
    definitions.append(marker);
    svg.append(definitions);
    return svg;
  }

  function updateEdges(
    stages: PipelineStageSummary[],
    canvas: HTMLElement,
    connectors: SVGSVGElement,
  ): void {
    connectors.querySelectorAll('.connector').forEach((edge) => edge.remove());
    const canvasRect = canvas.getBoundingClientRect();
    const namespace = 'http://www.w3.org/2000/svg';

    stages.forEach((child) => {
      const childElement = stageElements.get(child.id);
      if (!childElement) return;
      const childRect = childElement.getBoundingClientRect();

      child.parentStageIds.forEach((parentId) => {
        const parentElement = stageElements.get(parentId);
        if (!parentElement) return;
        const parentRect = parentElement.getBoundingClientRect();
        const startX = parentRect.right - canvasRect.left;
        const startY = parentRect.top + parentRect.height / 2 - canvasRect.top;
        const endX = childRect.left - canvasRect.left;
        const endY = childRect.top + childRect.height / 2 - canvasRect.top;
        const distance = endX - startX;
        const direction = distance >= 0 ? 1 : -1;
        const curve = Math.max(32, Math.abs(distance) / 2) * direction;

        const edge = document.createElementNS(namespace, 'path');
        edge.classList.add('connector');
        edge.setAttribute(
          'd',
          `M ${startX} ${startY} C ${startX + curve} ${startY}, ${
            endX - curve
          } ${endY}, ${endX} ${endY}`,
        );
        edge.setAttribute('marker-end', 'url(#pipeline-arrow)');
        connectors.append(edge);
      });
    });
  }

  function pipelineGraph(
    stages: PipelineStageSummary[],
    inspect: (stage: PipelineStageSummary, status: PipelineNodeStatus) => void,
  ): HTMLDivElement {
    stageElements.clear();
    resizeObserver?.disconnect();

    const viewport = element('div', 'graph-viewport');
    viewport.dataset.testid = 'pipeline-graph';
    const canvas = element('div', 'graph-canvas');
    const connectors = createConnectors();
    const columns = element('div', 'stage-columns');

    layoutStages(stages).forEach((column) => {
      const columnElement = element('div', 'stage-column');
      columnElement.dataset.depth = String(column.depth);
      column.stages.forEach((stage) => {
        const card = stageCard(stage, inspect);
        stageElements.set(stage.id, card);
        columnElement.append(card);
      });
      columns.append(columnElement);
    });

    append(canvas, connectors, columns);
    viewport.append(canvas);

    redrawEdges = () => updateEdges(stages, canvas, connectors);
    requestAnimationFrame(redrawEdges);
    if ('ResizeObserver' in globalThis) {
      const observer = new ResizeObserver(redrawEdges);
      resizeObserver = observer;
      observer.observe(canvas);
      stageElements.forEach((stage) => observer.observe(stage));
    }

    return viewport;
  }

  function nodeRow(node: PipelineNodeSnapshot): HTMLElement {
    const row = element('article', 'node-row');
    const status = node.status;
    row.dataset.status = status;
    row.dataset.nodeId = node.id;
    const main = element('div', 'node-row-main');
    append(
      main,
      statusBadge(status),
      element(
        'span',
        'node-attempt',
        `Attempt ${node.attempt}/${node.maxAttempts}`,
      ),
    );
    if (node.error) main.append(element('p', 'node-error', node.error));

    const actions = element('div', 'node-row-actions');
    if (node.jobId) {
      append(
        actions,
        append(
          element('div', 'job-reference'),
          append(
            element('div', 'job-reference-label'),
            element('span', '', 'Job ID'),
            copyJobIdButton(node.jobId),
          ),
          element('code', '', node.jobId),
        ),
      );
    }
    if (node.queueName && node.jobId) {
      const link = element('a', 'job-link', 'View job');
      link.href = jobPath(node.queueName, node.jobId);
      actions.append(link);
    }
    append(row, main, actions);
    return row;
  }

  async function inspectStageNodes(
    run: PipelineRunSummary,
    stage: PipelineStageSummary,
    status: PipelineNodeStatus,
    page: number,
    inspector: HTMLElement,
  ): Promise<void> {
    inspector.hidden = false;
    inspector.replaceChildren(
      element('div', 'loading-inline', `Loading ${status.toLowerCase()} tasks`),
    );
    inspector.scrollIntoView({ block: 'nearest' });

    try {
      const path = `/api/pipelines/${encodeURIComponent(run.id)}/stages/${
        encodeURIComponent(stage.id)
      }/nodes?status=${
        encodeURIComponent(status)
      }&page=${page}&pageSize=${NODE_PAGE_SIZE}`;
      const response = await requestJson<PipelineStageNodesResponse>(path);
      if (!response) return;

      const header = element('header', 'inspector-header');
      const title = element('div');
      append(
        title,
        element('p', 'eyebrow', stage.pipelineName),
        element('h2', '', `${stage.stepName} · ${status.toLowerCase()}`),
      );
      const close = element('button', 'inspector-close', '×');
      close.type = 'button';
      close.title = 'Close task list';
      close.setAttribute('aria-label', 'Close task list');
      close.addEventListener('click', () => {
        inspector.hidden = true;
        inspector.replaceChildren();
      });
      append(header, title, close);

      const list = element('div', 'node-list');
      response.nodes.forEach((node) => list.append(nodeRow(node)));
      if (response.nodes.length === 0) {
        list.append(element('div', 'empty', 'No tasks remain in this status.'));
      }

      const nodePagination = element('nav', 'pagination');
      const previous = element('button', 'pagination-link', 'Previous');
      previous.type = 'button';
      previous.disabled = !response.pageInfo.hasPreviousPage;
      previous.addEventListener(
        'click',
        () => inspectStageNodes(run, stage, status, page - 1, inspector),
      );
      const next = element('button', 'pagination-link', 'Next');
      next.type = 'button';
      next.disabled = !response.pageInfo.hasNextPage;
      next.addEventListener(
        'click',
        () => inspectStageNodes(run, stage, status, page + 1, inspector),
      );
      append(
        nodePagination,
        previous,
        element('span', 'pagination-page', `Page ${response.pageInfo.page}`),
        next,
      );
      inspector.replaceChildren(header, list, nodePagination);
    } catch (error) {
      inspector.replaceChildren(
        element(
          'div',
          'error',
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }

  function renderRun(details: PipelineRunDetails): void {
    const { run, stages } = details;
    const section = element('section', 'page');
    const header = element('header', 'page-header');
    const title = element('div');
    const back = element('a', 'back-link', 'Pipeline runs');
    back.href = extensionRoot.href;
    append(
      title,
      back,
      element('h1', '', run.pipelineName),
      element('p', 'run-id', `Run ID: ${run.id}`),
    );

    const summary = element('div', 'summary');
    append(
      summary,
      element('span', 'summary-item', runTaskSummary(run)),
      element('span', 'summary-item', `${stages.length} stages`),
      statusBadge(run.status),
    );
    append(header, title, pageActions(summary));
    section.append(header);

    if (run.error) section.append(element('div', 'run-error', run.error));
    const inspector = element('section', 'node-inspector');
    inspector.hidden = true;
    section.append(
      stages.length === 0
        ? element('div', 'empty', 'Waiting for pipeline stages.')
        : pipelineGraph(stages, (stage, status) => {
          inspectStageNodes(run, stage, status, 1, inspector);
        }),
      inspector,
    );
    root!.replaceChildren(section);
  }

  async function loadPipelineDashboard(): Promise<void> {
    try {
      if (runId) {
        const details = await requestJson<PipelineRunDetails>(
          `/api/pipelines/${encodeURIComponent(runId)}`,
        );
        if (details) {
          lastUpdatedAt = Date.now();
          renderRun(details);
        }
      } else {
        const response = await requestJson<PipelineRunsResponse>(
          `/api/pipelines?page=${runPage}&pageSize=${LIST_PAGE_SIZE}`,
        );
        if (response) {
          lastUpdatedAt = Date.now();
          renderRuns(response);
        }
      }
    } catch (error) {
      renderError(error);
    }
  }

  loadPipelineDashboard();
})();
