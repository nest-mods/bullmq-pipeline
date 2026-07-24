import assert from 'node:assert/strict';

import type {
  PipelineRunDetails,
  PipelineRunsResponse,
  PipelineStageNodesResponse,
  PipelineStageSummary,
} from '../pipeline.types.ts';

const bullBoardBase = 'http://nginx/app/bull-board';
const extensionBase = bullBoardBase + '/ext/pipeline-dashboard';
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

await waitUntilReachable(extensionBase + '/');

for (
  const url of [
    extensionBase + '/',
    extensionBase + '/api/pipelines',
    extensionBase + '/api/pipelines/dashboard-e2e-run',
    extensionBase +
    '/api/pipelines/dashboard-e2e-run/stages/crawl-stage/nodes?status=FAILED',
  ]
) {
  const response = await request(url);
  assert.equal(response.status, 302, 'unauthenticated request must redirect');
  assert.equal(response.headers.get('location'), '/app/bull-board/login');
}

const rejectedLoginResponse = await login('wrong-password');
assert.equal(rejectedLoginResponse.status, 302);
assert.equal(rejectedLoginResponse.headers.get('set-cookie'), null);

const loginResponse = await login('test-password');
assert.equal(loginResponse.status, 302);
assert.equal(loginResponse.headers.get('location'), '/app/bull-board/');
const cookie = loginResponse.headers.get('set-cookie')?.split(';', 1)[0];
assert.ok(cookie, 'valid credentials must set a session cookie');

const rootResponse = await request(bullBoardBase + '/', cookie);
assert.equal(rootResponse.status, 200);
const rootPage = await rootResponse.text();
const uiConfigScript = rootPage.match(
  /<script\b[^>]*\bid=(["'])__UI_CONFIG__\1[^>]*>([\s\S]*?)<\/script>/i,
);
assert.ok(uiConfigScript, 'Bull Board root must expose its UI config');
const uiConfig = JSON.parse(uiConfigScript[2]) as {
  miscLinks?: Array<{ text: string; url: string }>;
};
assert.deepEqual(uiConfig.miscLinks, [
  {
    text: 'Pipelines',
    url: '/app/bull-board/ext/pipeline-dashboard/',
  },
]);

for (const { queueName, jobId } of bullMqJobs) {
  const jobPath = bullBoardBase + '/queue/' + encodeURIComponent(queueName) +
    '/' + encodeURIComponent(jobId);
  assert.equal((await request(jobPath, cookie)).status, 200);
}

const extensionResponse = await request(extensionBase + '/', cookie);
assert.equal(extensionResponse.status, 200);
assert.equal(
  extensionResponse.headers.get('content-type'),
  'text/html; charset=utf-8',
);
const extensionPage = await extensionResponse.text();
assert.match(extensionPage, /href=["']\.\/pipeline-dashboard\.css["']/);
assert.match(extensionPage, /src=["']\.\/pipeline-dashboard\.ts["']/);

const scriptResponse = await request(
  extensionBase + '/pipeline-dashboard.ts',
  cookie,
);
assert.equal(scriptResponse.status, 200);
const scriptSource = await scriptResponse.text();
assert.doesNotMatch(scriptSource, /setInterval|pollingInterval|board-settings/);
assert.doesNotMatch(scriptSource, /\binnerHTML\b/);
assert.ok(scriptSource.includes('result.textContent = String(text)'));
assert.ok(scriptSource.includes('globalThis.location.reload()'));
assert.ok(scriptSource.includes('stage.parentStageIds'));
assert.ok(scriptSource.includes('/nodes?status='));
assert.ok(
  scriptSource.includes('link.href = jobPath(node.queueName, node.jobId)'),
);

const stylesheetResponse = await request(
  extensionBase + '/pipeline-dashboard.css',
  cookie,
);
assert.equal(stylesheetResponse.status, 200);
const stylesheet = await stylesheetResponse.text();
for (const status of ['RUNNING', 'RETRYING', 'COMPLETED', 'FAILED']) {
  assert.ok(
    stylesheet.includes(".stage-status[data-status='" + status + "']"),
    'Stage summaries must style ' + status,
  );
}

const listResponse = await request(
  extensionBase + '/api/pipelines?page=1&pageSize=25',
  cookie,
);
assert.equal(listResponse.status, 200);
const list = await listResponse.json() as PipelineRunsResponse;
assert.deepEqual(list.pageInfo, {
  page: 1,
  pageSize: 25,
  hasPreviousPage: false,
  hasNextPage: true,
});
assert.equal(list.runs.length, 25);
assert.ok(findRun(list, 'dashboard-e2e-run'));
assert.ok(findRun(list, 'dashboard-stress-run'));
assert.equal(findRun(list, 'missing-run'), undefined);

const e2eRun = findRun(list, 'dashboard-e2e-run');
assert.deepEqual(e2eRun, {
  id: 'dashboard-e2e-run',
  pipelineName: 'social-analysis-report',
  status: 'RUNNING',
  error: '',
  createdNodes: 4,
  completedNodes: 2,
  pendingNodes: 1,
  failedNodes: 1,
  createdAt: 1784500000000,
  updatedAt: 1784503600000,
  completedAt: null,
  expiresAt: null,
});

const secondPage = await getJson<PipelineRunsResponse>(
  extensionBase + '/api/pipelines?page=2&pageSize=25',
  cookie,
);
assert.deepEqual(secondPage.pageInfo, {
  page: 2,
  pageSize: 25,
  hasPreviousPage: true,
  hasNextPage: true,
});

for (
  const path of [
    '/api/pipelines?page=0',
    '/api/pipelines?pageSize=101',
    '/api/pipelines/bad%3Arun',
  ]
) {
  assert.equal((await request(extensionBase + path, cookie)).status, 400);
}

const details = await getJson<PipelineRunDetails>(
  extensionBase + '/api/pipelines/dashboard-e2e-run',
  cookie,
);
assert.equal(details.stages.length, 4);
assert.deepEqual(
  details.stages.map((current) => current.id),
  ['report-stage', 'trend-stage', 'crawl-stage', 'finalize-stage'],
);
assert.deepEqual(stage(details.stages, 'trend-stage').parentStageIds, [
  'report-stage',
]);
assert.deepEqual(stage(details.stages, 'finalize-stage').parentStageIds, [
  'crawl-stage',
  'trend-stage',
]);
assert.deepEqual(stage(details.stages, 'crawl-stage').counts, {
  PENDING: 0,
  RUNNING: 0,
  RETRYING: 0,
  COMPLETED: 0,
  FAILED: 1,
});

const failedNodes = await getJson<PipelineStageNodesResponse>(
  extensionBase +
    '/api/pipelines/dashboard-e2e-run/stages/crawl-stage/nodes' +
    '?status=FAILED&page=1&pageSize=25',
  cookie,
);
assert.equal(failedNodes.nodes.length, 1);
assert.equal(failedNodes.nodes[0].id, 'crawl-node');
assert.equal(failedNodes.nodes[0].stageId, 'crawl-stage');
assert.equal(failedNodes.nodes[0].jobId, 'crawl-job');
assert.equal(failedNodes.nodes[0].error, 'provider failed');
assert.deepEqual(failedNodes.pageInfo, {
  page: 1,
  pageSize: 25,
  hasPreviousPage: false,
  hasNextPage: false,
});

const stressDetails = await getJson<PipelineRunDetails>(
  extensionBase + '/api/pipelines/dashboard-stress-run',
  cookie,
);
assert.equal(stressDetails.run.createdNodes, 5_000);
assert.equal(stressDetails.stages.length, 10);
assert.equal(
  stressDetails.stages.reduce(
    (total, current) =>
      total +
      Object.values(current.counts).reduce((sum, count) => sum + count, 0),
    0,
  ),
  5_000,
);
assert.equal(
  stressDetails.stages.reduce(
    (total, current) => total + current.parentStageIds.length,
    0,
  ),
  9,
);

const stressFailedPage = await getJson<PipelineStageNodesResponse>(
  extensionBase +
    '/api/pipelines/dashboard-stress-run/stages/stress-stage-09/nodes' +
    '?status=FAILED&page=1&pageSize=25',
  cookie,
);
assert.equal(stressFailedPage.nodes.length, 25);
assert.equal(stressFailedPage.pageInfo.hasNextPage, true);
assert.ok(stressFailedPage.nodes.every((node) => node.status === 'FAILED'));
assert.ok(
  stressFailedPage.nodes.every((node) => node.stageId === 'stress-stage-09'),
);

const fourthStressPage = await getJson<PipelineStageNodesResponse>(
  extensionBase +
    '/api/pipelines/dashboard-stress-run/stages/stress-stage-09/nodes' +
    '?status=FAILED&page=4&pageSize=25',
  cookie,
);
assert.equal(fourthStressPage.nodes.length, 25);
assert.equal(fourthStressPage.pageInfo.hasNextPage, false);

assert.equal(
  (
    await request(
      extensionBase +
        '/api/pipelines/dashboard-stress-run/stages/stress-stage-09/nodes' +
        '?status=failed',
      cookie,
    )
  ).status,
  400,
);
assert.equal(
  (await request(extensionBase + '/api/pipelines/missing-run', cookie)).status,
  404,
);
assert.equal(
  (
    await request(
      extensionBase +
        '/api/pipelines/dashboard-e2e-run/stages/missing/nodes?status=FAILED',
      cookie,
    )
  ).status,
  404,
);

console.log(
  'pipeline dashboard authentication, bounded pages, Stage topology, ' +
    '5000-Node summaries, and Job links passed',
);

function login(password: string): Promise<Response> {
  return fetch(bullBoardBase + '/login', {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'test-user', password }),
  });
}

function request(url: string, cookie?: string): Promise<Response> {
  return fetch(url, {
    redirect: 'manual',
    headers: cookie ? { cookie } : undefined,
  });
}

async function getJson<T>(url: string, cookie: string): Promise<T> {
  const response = await request(url, cookie);
  assert.equal(response.status, 200, url + ' must return 200');
  return await response.json() as T;
}

function findRun(
  response: PipelineRunsResponse,
  id: string,
): PipelineRunsResponse['runs'][number] | undefined {
  return response.runs.find((run) => run.id === id);
}

function stage(
  stages: PipelineStageSummary[],
  id: string,
): PipelineStageSummary {
  const result = stages.find((current) => current.id === id);
  assert.ok(result, 'Stage ' + id + ' must exist');
  return result;
}

async function waitUntilReachable(url: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await request(url);
      if (![502, 503, 504].includes(response.status)) return;
      lastError = new Error('received HTTP ' + response.status);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Timed out waiting for ' + url + ': ' + String(lastError));
}
