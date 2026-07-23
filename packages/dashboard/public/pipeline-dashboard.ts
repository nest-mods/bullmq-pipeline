import type {
  PipelineErrorResponse,
  PipelineNodeSnapshot,
  PipelineRunDetails,
  PipelineRunsResponse,
  PipelineRunSummary,
} from '../pipeline.types.ts';

interface PipelineGraphGroup {
  pipelineName: string;
  stepName: string;
  nodes: PipelineNodeSnapshot[];
}

interface PipelineGraphColumn {
  depth: number;
  groups: PipelineGraphGroup[];
}

(() => {
  const root = document.querySelector<HTMLElement>('#pipeline-dashboard');
  if (!root) return;

  const extensionRoot = new URL('.', globalThis.location.href);
  const boardRoot = new URL('../../', extensionRoot);
  const runId = new URLSearchParams(globalThis.location.search).get('runId') ||
    '';
  const nodeElements = new Map<string, HTMLElement>();
  let resizeObserver: ResizeObserver | undefined;
  let redrawEdges: (() => void) | undefined;

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

  function normalizeStatus(value: unknown): string {
    return String(value || 'PENDING').toUpperCase();
  }

  function statusBadge(value: unknown): HTMLSpanElement {
    const status = normalizeStatus(value);
    const badge = element('span', 'status', status);
    badge.dataset.status = status;
    return badge;
  }

  function formatTime(value: number | null): string {
    return value ? new Date(value).toLocaleString() : '-';
  }

  function extensionUrl(pathname: string): URL {
    return new URL(pathname.replace(/^\/+/, ''), extensionRoot);
  }

  function pipelineRunPath(id: string): string {
    const url = new URL(extensionRoot);
    url.searchParams.set('runId', id);
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
    root!.replaceChildren(
      element(
        'div',
        'error',
        error instanceof Error ? error.message : String(error),
      ),
    );
  }

  function renderRuns(runs: PipelineRunSummary[]): void {
    const section = element('section', 'page');
    const header = element('header', 'page-header');
    const title = element('div');
    append(
      title,
      element('p', 'eyebrow', 'Last 24 hours'),
      element('h1', '', 'Pipeline runs'),
    );
    append(header, title, element('span', 'run-count', `${runs.length} runs`));
    section.append(header);

    if (runs.length === 0) {
      section.append(
        element('div', 'empty', 'No pipeline runs have reported progress yet.'),
      );
      root!.replaceChildren(section);
      return;
    }

    const frame = element('div', 'table-frame');
    const table = element('table', 'runs-table');
    const head = element('thead');
    const headingRow = element('tr');
    ['Pipeline', 'Status', 'Pending / Failed', 'Updated'].forEach((label) =>
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
        element(
          'td',
          '',
          `${run.pendingNodes} pending / ${run.failedNodes} failed`,
        ),
        element('td', '', formatTime(run.updatedAt)),
      );
      body.append(row);
    });

    append(table, head, body);
    frame.append(table);
    section.append(frame);
    root!.replaceChildren(section);
  }

  function layoutNodes(nodes: PipelineNodeSnapshot[]): PipelineGraphColumn[] {
    const nodesById = new Map<string, PipelineNodeSnapshot>(
      nodes.map((node) => [node.id, node]),
    );
    const depths = new Map<string, number>();
    const visiting = new Set<string>();

    function depthOf(node: PipelineNodeSnapshot): number {
      if (depths.has(node.id)) return depths.get(node.id)!;
      if (visiting.has(node.id)) return 0;

      visiting.add(node.id);
      const parents = (node.parentNodeIds || [])
        .map((parentId) => nodesById.get(parentId))
        .filter(Boolean) as PipelineNodeSnapshot[];
      const depth = parents.length === 0
        ? 0
        : Math.max(...parents.map((parent) => depthOf(parent))) + 1;
      visiting.delete(node.id);
      depths.set(node.id, depth);
      return depth;
    }

    const columns = new Map<number, Map<string, PipelineGraphGroup>>();
    nodes.forEach((node) => {
      const depth = depthOf(node);
      if (!columns.has(depth)) columns.set(depth, new Map());
      const pipelineName = node.pipelineName || 'pipeline';
      const stepName = node.stepName || node.stage || node.name || 'unassigned';
      const key = `${pipelineName}\u0000${stepName}`;
      const groups = columns.get(depth)!;
      if (!groups.has(key)) {
        groups.set(key, { pipelineName, stepName, nodes: [] });
      }
      groups.get(key)!.nodes.push(node);
    });

    return [...columns.entries()]
      .sort(([left], [right]) => left - right)
      .map(([depth, groups]) => ({ depth, groups: [...groups.values()] }));
  }

  function nodeCard(
    node: PipelineNodeSnapshot,
    executionIndex?: number,
  ): HTMLElement {
    const card = element('article', 'node');
    const status = normalizeStatus(node.status);
    card.dataset.status = status;
    card.dataset.nodeId = node.id;

    const header = element('div', 'node-header');
    if (executionIndex !== undefined) {
      header.append(
        element('span', 'execution-label', `Execution ${executionIndex}`),
      );
    }
    header.append(element('span', 'node-status', status));
    card.append(header);

    const attempt = Number(node.attempt);
    if (status === 'FAILED' || status === 'RETRYING' || attempt > 1) {
      card.append(
        element(
          'div',
          'node-meta',
          `Attempt ${node.attempt}/${node.maxAttempts}`,
        ),
      );
    }

    if (node.error) card.append(element('div', 'node-error', node.error));

    if (node.queueName && node.jobId) {
      const reference = element('div', 'job-reference');
      reference.title = `Job ID: ${node.jobId}`;
      append(
        reference,
        append(
          element('div', 'job-reference-label'),
          element('span', '', 'Job ID'),
          copyJobIdButton(node.jobId),
        ),
        element('code', '', node.jobId),
      );
      const link = element('a', 'job-link', 'View job');
      link.href = jobPath(node.queueName, node.jobId);
      append(card, append(element('footer', 'node-footer'), reference, link));
    }

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
    nodes: PipelineNodeSnapshot[],
    canvas: HTMLElement,
    connectors: SVGSVGElement,
  ): void {
    connectors.querySelectorAll('.connector').forEach((edge) => edge.remove());
    const canvasRect = canvas.getBoundingClientRect();
    const namespace = 'http://www.w3.org/2000/svg';

    nodes.forEach((child) => {
      const childElement = nodeElements.get(child.id);
      if (!childElement) return;
      const childRect = childElement.getBoundingClientRect();

      (child.parentNodeIds || []).forEach((parentId) => {
        const parentElement = nodeElements.get(parentId);
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

  function pipelineGraph(nodes: PipelineNodeSnapshot[]): HTMLDivElement {
    nodeElements.clear();
    resizeObserver?.disconnect();

    const viewport = element('div', 'graph-viewport');
    viewport.dataset.testid = 'pipeline-graph';
    const canvas = element('div', 'graph-canvas');
    const connectors = createConnectors();
    const stages = element('div', 'stages');

    layoutNodes(nodes).forEach((column) => {
      const stage = element('div', 'stage');
      column.groups.forEach((group) => {
        const step = element('section', 'step');
        const header = element('header', 'step-header');
        const title = element('div');
        append(
          title,
          element('h2', '', group.stepName),
          element(
            'p',
            '',
            group.nodes.length === 1
              ? group.pipelineName
              : `${group.pipelineName} · ${group.nodes.length} executions`,
          ),
        );
        header.append(title);

        const nodeList = element('div', 'nodes');
        group.nodes.forEach((node, nodeIndex) => {
          const card = nodeCard(
            node,
            group.nodes.length > 1 ? nodeIndex + 1 : undefined,
          );
          nodeElements.set(node.id, card);
          nodeList.append(card);
        });
        append(step, header, nodeList);
        stage.append(step);
      });
      stages.append(stage);
    });

    append(canvas, connectors, stages);
    viewport.append(canvas);

    redrawEdges = () => updateEdges(nodes, canvas, connectors);
    requestAnimationFrame(redrawEdges);
    if ('ResizeObserver' in globalThis) {
      const observer = new ResizeObserver(redrawEdges);
      resizeObserver = observer;
      observer.observe(canvas);
      nodeElements.forEach((node) => observer.observe(node));
    }

    return viewport;
  }

  function renderRun(details: PipelineRunDetails): void {
    const { run, nodes } = details;
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
      element('span', 'summary-item', `${run.pendingNodes} pending`),
      element('span', 'summary-item', `${nodes.length} executions`),
      statusBadge(run.status),
    );
    append(header, title, summary);
    section.append(header);

    if (run.error) section.append(element('div', 'run-error', run.error));
    section.append(
      nodes.length === 0
        ? element('div', 'empty', 'Waiting for pipeline executions.')
        : pipelineGraph(nodes),
    );
    root!.replaceChildren(section);
  }

  async function loadPipelineDashboard(): Promise<void> {
    try {
      if (runId) {
        const details = await requestJson<PipelineRunDetails>(
          `/api/pipelines/${encodeURIComponent(runId)}`,
        );
        if (details) renderRun(details);
      } else {
        const response = await requestJson<PipelineRunsResponse>(
          '/api/pipelines',
        );
        if (response) renderRuns(response.runs || []);
      }
    } catch (error) {
      renderError(error);
    }
  }

  function pollingInterval(): number {
    try {
      const settings = JSON.parse(
        localStorage.getItem('board-settings') || '{}',
      ) as { state?: { pollingInterval?: unknown } };
      const value = Number(settings?.state?.pollingInterval);
      return Number.isFinite(value) ? value : 5;
    } catch {
      return 5;
    }
  }

  loadPipelineDashboard();
  const interval = pollingInterval();
  if (interval > 0) {
    globalThis.setInterval(loadPipelineDashboard, interval * 1_000);
  }
})();
