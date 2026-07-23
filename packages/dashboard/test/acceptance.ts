import assert from 'node:assert/strict';

const bullBoardBase = 'http://nginx/app/bull-board';
const extensionBase = `${bullBoardBase}/ext/pipeline-dashboard`;
const bullMqJobs = [
  {
    queueName: 'pipeline--social-analysis-report--report-work',
    jobId: 'report-job',
  },
  {
    queueName: 'pipeline--social-analysis-trend--generate-trend',
    jobId: 'trend-job',
  },
  {
    queueName: 'pipeline--social-analysis-crawl--crawl-source',
    jobId: 'crawl-job',
  },
];
const runSummaryKeys = [
  'completedAt',
  'createdAt',
  'error',
  'expiresAt',
  'failedNodes',
  'id',
  'name',
  'pendingNodes',
  'pipelineName',
  'status',
  'updatedAt',
];
const nodeSnapshotKeys = [
  'attempt',
  'completedAt',
  'createdAt',
  'error',
  'forkName',
  'id',
  'invocationId',
  'jobId',
  'maxAttempts',
  'name',
  'parentNodeIds',
  'pipelineName',
  'progress',
  'queueName',
  'runId',
  'scopeId',
  'stage',
  'startedAt',
  'status',
  'stepName',
  'updatedAt',
];

await waitUntilReachable(`${extensionBase}/`);

for (
  const url of [
    `${extensionBase}/`,
    `${extensionBase}/api/pipelines`,
    `${extensionBase}/api/pipelines/dashboard-e2e-run`,
  ]
) {
  const response = await request(url);
  assert.equal(response.status, 302, `unauthenticated ${url} must redirect`);
  assert.equal(
    response.headers.get('location'),
    '/app/bull-board/login',
    `unauthenticated ${url} must redirect to the proxied login page`,
  );
}

const rejectedLoginResponse = await login('wrong-password');
assert.equal(
  rejectedLoginResponse.status,
  302,
  'wrong credentials must be rejected with a redirect',
);
assert.equal(
  rejectedLoginResponse.headers.get('location'),
  '/app/bull-board/login',
  'wrong credentials must redirect back to the proxied login page',
);
assert.equal(
  rejectedLoginResponse.headers.get('set-cookie'),
  null,
  'wrong credentials must not create a session',
);

const loginResponse = await login('test-password');
assert.equal(loginResponse.status, 302, 'valid credentials must redirect');
assert.equal(loginResponse.headers.get('location'), '/app/bull-board/');
const cookie = loginResponse.headers.get('set-cookie')?.split(';', 1)[0];
assert.ok(cookie, 'valid credentials must set a session cookie');

const rootResponse = await request(`${bullBoardBase}/`, cookie);
assert.equal(
  rootResponse.status,
  200,
  'authenticated Bull Board root must load',
);
const rootPage = await rootResponse.text();
const uiConfigScript = rootPage.match(
  /<script\b[^>]*\bid=(["'])__UI_CONFIG__\1[^>]*>([\s\S]*?)<\/script>/i,
);
assert.ok(
  uiConfigScript,
  'Bull Board root must contain the __UI_CONFIG__ JSON script',
);
const uiConfig: unknown = JSON.parse(uiConfigScript[2]);
assert.ok(
  uiConfig !== null && typeof uiConfig === 'object',
  'Bull Board UI config must be an object',
);
const miscLinks = 'miscLinks' in uiConfig ? uiConfig.miscLinks : undefined;
assert.ok(
  Array.isArray(miscLinks),
  'Bull Board UI config must contain miscLinks',
);
assert.deepEqual(
  miscLinks,
  [
    {
      text: 'Pipelines',
      url: '/app/bull-board/ext/pipeline-dashboard/',
    },
  ],
  `Bull Board miscLinks must contain exactly the Pipelines extension link; received ${
    JSON.stringify(miscLinks)
  }`,
);

for (const { queueName, jobId } of bullMqJobs) {
  const jobPath = `${bullBoardBase}/queue/${encodeURIComponent(queueName)}/` +
    encodeURIComponent(jobId);
  const jobResponse = await request(jobPath, cookie);
  assert.equal(
    jobResponse.status,
    200,
    `authenticated Bull Board job path ${jobPath} must return 200`,
  );
  assert.equal(
    jobResponse.headers.get('content-type'),
    'text/html; charset=utf-8',
    `Bull Board job path ${jobPath} must serve the host page`,
  );
}

const extensionResponse = await request(`${extensionBase}/`, cookie);
assert.equal(
  extensionResponse.status,
  200,
  `authenticated pipeline dashboard must return 200, received ${extensionResponse.status}`,
);
assert.equal(
  extensionResponse.headers.get('content-type'),
  'text/html; charset=utf-8',
);
const extensionPage = await extensionResponse.text();
assert.match(extensionPage, /href=["']\.\/pipeline-dashboard\.css["']/);
assert.match(
  extensionPage,
  /<script type=["']module["'] src=["']\.\/pipeline-dashboard\.ts["']><\/script>/,
);

const queryPageResponse = await request(
  `${extensionBase}/?runId=dashboard-e2e-run`,
  cookie,
);
assert.equal(queryPageResponse.status, 200);
assert.equal(
  queryPageResponse.headers.get('content-type'),
  'text/html; charset=utf-8',
);
assert.equal(
  await queryPageResponse.text(),
  extensionPage,
  'runId query pages must serve the extension page shell',
);

const scriptResponse = await request(
  `${extensionBase}/pipeline-dashboard.ts`,
  cookie,
);
assert.equal(scriptResponse.status, 200);
assert.equal(
  scriptResponse.headers.get('content-type'),
  'text/javascript; charset=utf-8',
);
const scriptSource = await scriptResponse.text();
assert.doesNotMatch(
  scriptSource,
  /pipeline\.types|Pipeline(?:ErrorResponse|NodeSnapshot|RunDetails|RunsResponse|RunSummary)/,
  'host-compiled browser JavaScript must erase the shared DTO import',
);
assert.match(
  scriptSource,
  /`\$\{pipelineName\}\\(?:0|u0000)\$\{stepName\}`/,
  'pipeline and step grouping must preserve the collision-free upstream separator',
);
assert.match(
  scriptSource,
  /const extensionRoot = new URL\((['"])\.\1, globalThis\.location\.href\);/,
  'browser APIs and detail links must resolve from the extension root',
);
assert.match(
  scriptSource,
  /const boardRoot = new URL\((['"])\.\.\/\.\.\/\1, extensionRoot\);/,
  'BullMQ job links must resolve from the Bull Board host root',
);
assert.match(
  scriptSource,
  /return new URL\(pathname\.replace\(\/\^\\\/\+\/, (['"])\1\), extensionRoot\);/,
  'API paths must resolve relative to the mounted extension',
);
assert.match(
  scriptSource,
  /async function requestJson\(pathname\)\s*\{\s*const response = await fetch\(extensionUrl\(pathname\),/,
  'API requests must fetch through the extension-relative URL builder',
);
assert.match(
  scriptSource,
  /function pipelineRunPath\(id\)\s*\{\s*const url = new URL\(extensionRoot\);\s*url\.searchParams\.set\((['"])runId\1, id\);/,
  'detail navigation must remain on the extension query page',
);
assert.ok(
  /new URLSearchParams\(globalThis\.location\.search\)\.get\((['"])runId\1\)/
    .test(scriptSource) &&
    scriptSource.includes('pipelineLink.href = pipelineRunPath(run.id);'),
  'list links and page loading must use the runId query contract',
);
assert.ok(
  scriptSource.includes('`/api/pipelines/${encodeURIComponent(runId)}`'),
  'detail requests must use the extension-relative encoded run URL',
);
assert.match(
  scriptSource,
  /requestJson\((['"])\/api\/pipelines\1\)/,
  'list requests must use the extension-relative API',
);
assert.doesNotMatch(
  scriptSource,
  /setInterval|pollingInterval|board-settings/,
  'the dashboard must not interrupt graph inspection with automatic polling',
);
assert.ok(
  /element\(["']button["'],\s*["']refresh-button["'],\s*["']Refresh["']\)/
    .test(scriptSource) &&
    scriptSource.includes('globalThis.location.reload();'),
  'manual refresh must explicitly reload the current dashboard page',
);
assert.match(
  scriptSource,
  /if \(response\.redirected && !contentType\.includes\((['"])application\/json\1\)\) \{\s*globalThis\.location\.assign\(response\.url\);\s*return null;/,
  'expired login redirects must navigate the browser to the login response',
);
assert.ok(
  scriptSource.includes('document.createElement(tag)') &&
    scriptSource.includes('result.textContent = String(text)'),
  'dynamic dashboard content must be built with safe DOM APIs',
);
assert.doesNotMatch(
  scriptSource,
  /\binnerHTML\b/,
  'dynamic dashboard content must not use innerHTML',
);
assert.match(
  scriptSource,
  /function jobPath\(queueName, jobId\)\s*\{\s*return new URL\(\s*`queue\/\$\{encodeURIComponent\(queueName\)\}\/\$\{encodeURIComponent\(jobId\)\}`,\s*boardRoot,?\s*\)\.href;/,
  'BullMQ links must retain encoded host-root queue and job paths',
);
assert.ok(
  scriptSource.includes('link.href = jobPath(node.queueName, node.jobId);'),
  'node cards must use the host-root BullMQ job URL builder',
);

const legacyScriptResponse = await request(
  `${extensionBase}/pipeline-dashboard.js`,
  cookie,
);
assert.equal(
  legacyScriptResponse.status,
  404,
  'the legacy JavaScript browser entry must not remain mounted',
);

const stylesheetResponse = await request(
  `${extensionBase}/pipeline-dashboard.css`,
  cookie,
);
assert.equal(stylesheetResponse.status, 200);
assert.equal(
  stylesheetResponse.headers.get('content-type'),
  'text/css; charset=utf-8',
);
const stylesheet = await stylesheetResponse.text();
for (
  const status of [
    'PENDING',
    'RUNNING',
    'RETRYING',
    'COMPLETED',
    'FAILED',
  ]
) {
  assert.ok(
    stylesheet.includes(`.node[data-status='${status}']`),
    `node cards must define a distinct ${status} state`,
  );
}

const apiResponse = await request(`${extensionBase}/api/pipelines`, cookie);
assert.equal(
  apiResponse.status,
  200,
  `authenticated pipeline API must return 200, received ${apiResponse.status}`,
);
const expectedRun: RunSummary = {
  id: 'dashboard-e2e-run',
  name: 'social-analysis-report',
  pipelineName: 'social-analysis-report',
  status: 'RUNNING',
  error: '',
  pendingNodes: 1,
  failedNodes: 1,
  createdAt: 1784500000000,
  updatedAt: 1784503600000,
  completedAt: null,
  expiresAt: null,
};
const listPayload = await apiResponse.json() as { runs: RunSummary[] };
assertJsonKeys(listPayload, ['runs'], 'list response');
assert.ok(
  Array.isArray(listPayload.runs),
  'list response runs must be an array',
);
assert.equal(listPayload.runs.length, 100, 'list API must default to 100 runs');
for (const run of listPayload.runs) {
  assertJsonKeys(run, runSummaryKeys, `run summary ${run.id}`);
}

const expectedListIds = [
  'dashboard-expired-running',
  'dashboard-malformed-run',
  'dashboard-stress-run',
  'dashboard-e2e-run',
  ...Array.from(
    { length: 96 },
    (_, index) => `dashboard-bulk-${String(105 - index).padStart(3, '0')}`,
  ),
];
assert.deepEqual(
  listPayload.runs.map((run) => run.id),
  expectedListIds,
  'list API must stale-filter before applying the descending 100-run cap',
);
assert.deepEqual(
  findRun(listPayload.runs, expectedRun.id),
  expectedRun,
  'existing Report fixture must retain its list summary',
);
assert.deepEqual(
  findRun(listPayload.runs, 'dashboard-expired-running'),
  {
    id: 'dashboard-expired-running',
    name: 'expired-running',
    pipelineName: 'retention-pipeline',
    status: 'RUNNING',
    error: '',
    pendingNodes: 2,
    failedNodes: 0,
    createdAt: 100,
    updatedAt: 200,
    completedAt: null,
    expiresAt: 1,
  },
  'expired RUNNING data must remain visible',
);
const malformedRun: RunSummary = {
  id: 'dashboard-malformed-run',
  name: 'dashboard-malformed-run',
  pipelineName: 'dashboard-malformed-run',
  status: 'PENDING',
  error: '',
  pendingNodes: 0,
  failedNodes: 0,
  createdAt: null,
  updatedAt: null,
  completedAt: null,
  expiresAt: null,
};
assert.deepEqual(
  findRun(listPayload.runs, malformedRun.id),
  malformedRun,
  'malformed and empty run fields must use parsing fallbacks',
);

const detailsResponse = await request(
  `${extensionBase}/api/pipelines/dashboard-e2e-run`,
  cookie,
);
assert.equal(detailsResponse.status, 200);
const details = await detailsResponse.json() as {
  run: typeof expectedRun;
  nodes: NodeSnapshot[];
};
assertJsonKeys(details, ['nodes', 'run'], 'existing run detail response');
assertJsonKeys(details.run, runSummaryKeys, 'existing run detail summary');
for (const node of details.nodes) {
  assertJsonKeys(node, nodeSnapshotKeys, `existing node ${node.id}`);
}
assert.deepEqual(details.run, expectedRun);
assert.deepEqual(
  details.nodes.map((node) => ({
    id: node.id,
    pipelineName: node.pipelineName,
    invocationId: node.invocationId,
    scopeId: node.scopeId,
    status: node.status,
    parentNodeIds: node.parentNodeIds,
    queueName: node.queueName,
    jobId: node.jobId,
    attempt: node.attempt,
    maxAttempts: node.maxAttempts,
    progress: node.progress,
    error: node.error,
  })),
  [
    {
      id: 'report-node',
      pipelineName: 'social-analysis-report',
      invocationId: 'report-invocation',
      scopeId: 'report-scope',
      status: 'COMPLETED',
      parentNodeIds: [],
      queueName: 'pipeline--social-analysis-report--report-work',
      jobId: 'report-job',
      attempt: 1,
      maxAttempts: 1,
      progress: { records: 24 },
      error: '',
    },
    {
      id: 'trend-node',
      pipelineName: 'social-analysis-trend',
      invocationId: 'trend-invocation',
      scopeId: 'trend-scope',
      status: 'COMPLETED',
      parentNodeIds: ['report-node'],
      queueName: 'pipeline--social-analysis-trend--generate-trend',
      jobId: 'trend-job',
      attempt: 2,
      maxAttempts: 3,
      progress: { records: 12 },
      error: '',
    },
    {
      id: 'crawl-node',
      pipelineName: 'social-analysis-crawl',
      invocationId: 'crawl-invocation',
      scopeId: 'crawl-scope',
      status: 'FAILED',
      parentNodeIds: ['report-node'],
      queueName: 'pipeline--social-analysis-crawl--crawl-source',
      jobId: 'crawl-job',
      attempt: 3,
      maxAttempts: 3,
      progress: { pages: 4 },
      error: 'provider failed',
    },
  ],
);

const malformedDetailsResponse = await request(
  `${extensionBase}/api/pipelines/${malformedRun.id}`,
  cookie,
);
assert.equal(malformedDetailsResponse.status, 200);
const malformedDetails = await malformedDetailsResponse.json() as {
  run: RunSummary;
  nodes: NodeSnapshot[];
};
assertJsonKeys(malformedDetails, ['nodes', 'run'], 'malformed detail response');
assert.deepEqual(malformedDetails.run, malformedRun);
assert.deepEqual(malformedDetails.nodes, [
  {
    id: 'invalid-json-node',
    runId: '',
    pipelineName: 'dashboard-malformed-run',
    invocationId: '',
    scopeId: '',
    name: 'invalid-json-node',
    stepName: 'invalid-json-node',
    stage: 'invalid-json-node',
    status: 'PENDING',
    parentNodeIds: [],
    queueName: '',
    jobId: '',
    attempt: 0,
    maxAttempts: 1,
    progress: {},
    forkName: '',
    error: '',
    createdAt: null,
    updatedAt: null,
    startedAt: null,
    completedAt: null,
  },
  {
    id: 'wrong-type-node',
    runId: '',
    pipelineName: 'dashboard-malformed-run',
    invocationId: '',
    scopeId: '',
    name: 'fallback-stage',
    stepName: 'fallback-stage',
    stage: 'fallback-stage',
    status: 'PENDING',
    parentNodeIds: [],
    queueName: '',
    jobId: '',
    attempt: 0,
    maxAttempts: 1,
    progress: {},
    forkName: '',
    error: '',
    createdAt: null,
    updatedAt: null,
    startedAt: null,
    completedAt: null,
  },
]);
for (const node of malformedDetails.nodes) {
  assertJsonKeys(node, nodeSnapshotKeys, `malformed node ${node.id}`);
}
assert.ok(
  malformedDetails.nodes.every((node) => node.id !== 'missing-node-hash'),
  'an indexed node whose hash is missing must be omitted',
);

const stressDetailsResponse = await request(
  `${extensionBase}/api/pipelines/dashboard-stress-run`,
  cookie,
);
assert.equal(stressDetailsResponse.status, 200);
const stressDetails = await stressDetailsResponse.json() as {
  run: RunSummary;
  nodes: NodeSnapshot[];
};
assertJsonKeys(stressDetails, ['nodes', 'run'], 'stress detail response');
assert.deepEqual(stressDetails.run, {
  id: 'dashboard-stress-run',
  name: 'stress-pipeline',
  pipelineName: 'stress-pipeline',
  status: 'RUNNING',
  error: '',
  pendingNodes: 180,
  failedNodes: 0,
  createdAt: 300,
  updatedAt: 400,
  completedAt: null,
  expiresAt: null,
});
assert.equal(
  stressDetails.nodes.length,
  200,
  'stress detail must have 200 nodes',
);
for (const node of stressDetails.nodes) {
  assertJsonKeys(node, nodeSnapshotKeys, `stress node ${node.id}`);
}
const expectedStressNodeIds = Array.from(
  { length: 10 },
  (_, depth) =>
    Array.from(
      { length: 20 },
      (_, index) => stressNodeId(depth, index),
    ),
).flat();
assert.deepEqual(
  stressDetails.nodes.map((node) => node.id),
  expectedStressNodeIds,
  'stress nodes must retain deterministic index order',
);
assert.equal(
  new Set(stressDetails.nodes.map((node) => node.id)).size,
  200,
  'stress detail must have 200 unique indexed node IDs',
);
const stressNodesById = new Map(
  stressDetails.nodes.map((node) => [node.id, node]),
);
const declaredEdges = stressDetails.nodes.reduce(
  (total, node) => total + node.parentNodeIds.length,
  0,
);
assert.equal(declaredEdges, 180, 'stress detail must declare 180 parent edges');
const depthCounts = new Map<number, number>();
for (const node of stressDetails.nodes) {
  const depth = stressDepth(node, stressNodesById);
  depthCounts.set(depth, (depthCounts.get(depth) ?? 0) + 1);
}
assert.deepEqual(
  [...depthCounts.entries()].sort(([left], [right]) => left - right),
  Array.from({ length: 10 }, (_, depth) => [depth, 20]),
  'stress dependency graph must contain exactly 20 nodes at each of 10 depths',
);

const missingResponse = await request(
  `${extensionBase}/api/pipelines/missing-run`,
  cookie,
);
assert.equal(missingResponse.status, 404);
assert.deepEqual(await missingResponse.json(), {
  error: 'Pipeline run missing-run not found',
});

console.log(
  'pipeline dashboard authentication, real job links, edge fixtures, stress graph, browser contracts, and 404 passed',
);

interface RunSummary extends Record<string, unknown> {
  id: string;
  name: string;
  pipelineName: string;
  status: string;
  error: string;
  pendingNodes: number;
  failedNodes: number;
  createdAt: number | null;
  updatedAt: number | null;
  completedAt: number | null;
  expiresAt: number | null;
}

interface NodeSnapshot extends Record<string, unknown> {
  id: string;
  parentNodeIds: string[];
}

function login(password: string): Promise<Response> {
  return fetch(`${bullBoardBase}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'test-user', password }),
  });
}

function assertJsonKeys(
  value: Record<string, unknown>,
  expectedKeys: string[],
  description: string,
): void {
  assert.deepEqual(
    Object.keys(value).sort(),
    [...expectedKeys].sort(),
    `${description} must have the exact JSON shape`,
  );
}

function findRun(runs: RunSummary[], id: string): RunSummary | undefined {
  return runs.find((run) => run.id === id);
}

function stressNodeId(depth: number, index: number): string {
  return `stress-d${String(depth).padStart(2, '0')}-n${
    String(index).padStart(2, '0')
  }`;
}

function stressDepth(
  node: NodeSnapshot,
  nodesById: Map<string, NodeSnapshot>,
  visiting = new Set<string>(),
): number {
  assert.ok(!visiting.has(node.id), `stress graph cycle at ${node.id}`);
  if (node.parentNodeIds.length === 0) return 0;

  visiting.add(node.id);
  const parents = node.parentNodeIds.map((parentId) => {
    const parent = nodesById.get(parentId);
    assert.ok(parent, `stress parent ${parentId} must exist`);
    return parent;
  });
  const depth = Math.max(
    ...parents.map((parent) => stressDepth(parent, nodesById, visiting)),
  ) + 1;
  visiting.delete(node.id);
  return depth;
}

function request(url: string, cookie?: string): Promise<Response> {
  return fetch(url, {
    redirect: 'manual',
    headers: cookie ? { cookie } : undefined,
  });
}

async function waitUntilReachable(url: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await request(url);
      if (![502, 503, 504].includes(response.status)) return;
      lastError = new Error(`received HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}: ${String(lastError)}`);
}
