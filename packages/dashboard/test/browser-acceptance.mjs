import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const bullBoardBase = 'http://nginx/app/bull-board';
const extensionBase = `${bullBoardBase}/ext/pipeline-dashboard`;
const listApiPath = '/app/bull-board/ext/pipeline-dashboard/api/pipelines';
const jobFixtures = [
  {
    nodeId: 'report-node',
    queueName: 'pipeline--social-analysis-report--report-work',
    jobId: 'report-job',
    status: 'COMPLETED',
    attempt: 'Attempt 1/1',
    progress: ['records: 24'],
    error: null,
  },
  {
    nodeId: 'trend-node',
    queueName: 'pipeline--social-analysis-trend--generate-trend',
    jobId: 'trend-job',
    status: 'COMPLETED',
    attempt: 'Attempt 2/3',
    progress: ['records: 12'],
    error: null,
  },
  {
    nodeId: 'crawl-node',
    queueName: 'pipeline--social-analysis-crawl--crawl-source',
    jobId: 'crawl-job',
    status: 'FAILED',
    attempt: 'Attempt 3/3',
    progress: ['pages: 4'],
    error: 'provider failed',
  },
];

const browser = await puppeteer.launch({
  headless: true,
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  let listRequestTimes = [];
  const browserErrors = [];
  page.on('request', (request) => {
    const url = request.url();
    if (request.method() === 'GET' && new URL(url).pathname === listApiPath) {
      listRequestTimes.push(Date.now());
    }
  });
  page.on('pageerror', (error) => {
    browserErrors.push(`pageerror: ${error.stack || error.message || error}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      browserErrors.push(`console.error: ${message.text()}`);
    }
  });

  await login(page);
  await page.evaluate(() => localStorage.removeItem('board-settings'));

  listRequestTimes = [];
  await openList(page);
  const listSnapshot = await page.$eval('.runs-table', (table) => {
    const rows = [...table.querySelectorAll('tbody tr')];
    const selectedRun = rows.find((row) =>
      row.querySelector('code')?.textContent?.trim() === 'dashboard-e2e-run'
    );
    const status = selectedRun?.querySelector('.status');
    return {
      rows: rows.length,
      selectedStatus: status
        ? {
          text: status.textContent?.trim(),
          value: status.dataset.status,
        }
        : null,
      text: table.textContent || '',
    };
  });
  assert.ok(listSnapshot.rows > 0, 'the real run list must render rows');
  assert.match(listSnapshot.text, /dashboard-e2e-run/);
  assert.deepEqual(
    listSnapshot.selectedStatus,
    { text: 'RUNNING', value: 'RUNNING' },
    'the selected run must render its RUNNING status badge',
  );

  await waitFor(
    () => listRequestTimes.length >= 2,
    9_000,
    'a second list API request from the default five-second poll',
  );
  const pollingDelay = listRequestTimes[1] - listRequestTimes[0];
  assert.ok(
    pollingDelay >= 4_500 && pollingDelay <= 8_500,
    `expected the next list API request after five seconds, observed ${pollingDelay}ms`,
  );

  await clickLinkByTextAndWaitForNavigation(
    page,
    '.pipeline-link',
    'social-analysis-report',
  );
  assert.equal(
    new URL(page.url()).searchParams.get('runId'),
    'dashboard-e2e-run',
    'list navigation must retain the selected run ID',
  );
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.node').length === 3 &&
      document.querySelectorAll('.connector').length === 2,
  );
  const detailCounts = await page.$eval(
    '[data-testid="pipeline-graph"]',
    (graph) => ({
      connectors: graph.querySelectorAll('.connector').length,
      nodes: graph.querySelectorAll('.node').length,
    }),
  );
  assert.deepEqual(detailCounts, { connectors: 2, nodes: 3 });

  for (const fixture of jobFixtures) {
    const nodeSnapshot = await page.$eval(
      `[data-node-id="${fixture.nodeId}"]`,
      (node) => ({
        attempt: node.querySelector('.node-meta span')?.textContent?.trim(),
        error: node.querySelector('.node-error')?.textContent?.trim() ?? null,
        progress: [...node.querySelectorAll('.progress span')].map((entry) =>
          entry.textContent?.trim()
        ),
        status: node.dataset.status,
      }),
    );
    assert.deepEqual(
      nodeSnapshot,
      {
        attempt: fixture.attempt,
        error: fixture.error,
        progress: fixture.progress,
        status: fixture.status,
      },
      `${fixture.nodeId} must render its real status, attempt, progress, and error`,
    );

    const expectedJobUrl = jobUrl(fixture.queueName, fixture.jobId);
    const renderedJobUrl = await page.$eval(
      `[data-node-id="${fixture.nodeId}"] .job-link`,
      (link) => link.href,
    );
    assert.equal(
      renderedJobUrl,
      expectedJobUrl,
      `${fixture.nodeId} must link from the proxied Bull Board queue root`,
    );
    assert.ok(
      new URL(renderedJobUrl).pathname.startsWith('/app/bull-board/queue/'),
      `unexpected host queue path for ${fixture.nodeId}: ${renderedJobUrl}`,
    );
  }

  const expectedJobUrl = jobUrl(
    jobFixtures[0].queueName,
    jobFixtures[0].jobId,
  );
  const expectedJobApiPath = jobApiPath(
    jobFixtures[0].queueName,
    jobFixtures[0].jobId,
  );
  const jobApiResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'GET' &&
    new URL(response.url()).pathname === expectedJobApiPath
  );
  const jobResponse = await clickSelectorAndWaitForNavigation(
    page,
    '[data-node-id="report-node"] .job-link',
  );
  const jobApiResponse = await jobApiResponsePromise;
  assert.equal(
    jobResponse?.status(),
    200,
    'the real BullMQ job page must open',
  );
  assert.equal(
    jobApiResponse.status(),
    200,
    `the job-specific Bull Board API must succeed: ${expectedJobApiPath}`,
  );
  assert.equal(page.url(), expectedJobUrl);
  await page.waitForFunction(
    ({ queueName, jobId }) => {
      const text = document.body.textContent || '';
      return text.includes(queueName) && text.includes(jobId);
    },
    { timeout: 10_000 },
    jobFixtures[0],
  );
  const jobPageText = await page.$eval('body', (body) => body.textContent || '');
  assert.match(jobPageText, new RegExp(escapeRegex(jobFixtures[0].queueName)));
  assert.match(jobPageText, new RegExp(escapeRegex(jobFixtures[0].jobId)));
  assert.doesNotMatch(
    jobPageText,
    /job not found|failed to load (?:the )?job|unable to (?:find|load) (?:the )?job|loading job/i,
    'the rendered job page must not remain in a loading or not-found state',
  );

  await page.goto(`${extensionBase}/?runId=dashboard-stress-run`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(
    () => document.querySelectorAll('.node').length === 200,
    { timeout: 15_000 },
  );
  await page.waitForFunction(
    () => document.querySelectorAll('.connector').length === 180,
    { timeout: 15_000 },
  );
  const graph = await page.$eval(
    '[data-testid="pipeline-graph"]',
    (element) => {
      const rectangle = element.getBoundingClientRect();
      return {
        connectors: element.querySelectorAll('.connector').length,
        nodes: element.querySelectorAll('.node').length,
        width: rectangle.width,
        height: rectangle.height,
      };
    },
  );
  assert.deepEqual(
    { connectors: graph.connectors, nodes: graph.nodes },
    { connectors: 180, nodes: 200 },
  );
  assert.ok(
    graph.width > 0 && graph.height > 0,
    'stress graph must be visible',
  );

  await page.setViewport({ width: 390, height: 844 });
  await page.emulateMediaFeatures([
    { name: 'prefers-color-scheme', value: 'dark' },
    { name: 'prefers-reduced-motion', value: 'reduce' },
  ]);
  const responsiveState = await page.evaluate(() => {
    const brandLabel = document.querySelector('.brand > span:last-child');
    const graphViewport = document.querySelector(
      '[data-testid="pipeline-graph"]',
    );
    assertElement(brandLabel, 'brand label');
    assertElement(graphViewport, 'pipeline graph');

    const motionProbe = document.createElement('span');
    motionProbe.className = 'loading-bar';
    document.body.append(motionProbe);
    const loadingAnimation = getComputedStyle(
      motionProbe,
      '::after',
    ).animationName;
    motionProbe.remove();

    return {
      brandLabelDisplay: getComputedStyle(brandLabel).display,
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      dark: matchMedia('(prefers-color-scheme: dark)').matches,
      graphHeight: graphViewport.getBoundingClientRect().height,
      graphWidth: graphViewport.getBoundingClientRect().width,
      loadingAnimation,
      pageBackground: getComputedStyle(document.documentElement)
        .getPropertyValue('--page-bg')
        .trim(),
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      viewportHeight: innerHeight,
      viewportWidth: innerWidth,
    };

    function assertElement(element, description) {
      if (!element) throw new Error(`Missing ${description}`);
    }
  });
  assert.deepEqual(
    {
      height: responsiveState.viewportHeight,
      width: responsiveState.viewportWidth,
    },
    { height: 844, width: 390 },
  );
  assert.equal(responsiveState.brandLabelDisplay, 'none');
  assert.equal(responsiveState.dark, true);
  assert.equal(responsiveState.colorScheme, 'dark');
  assert.equal(responsiveState.pageBackground, '#172025');
  assert.equal(responsiveState.reducedMotion, true);
  assert.equal(responsiveState.loadingAnimation, 'none');
  assert.ok(
    responsiveState.graphWidth > 0 && responsiveState.graphWidth <= 390 &&
      responsiveState.graphHeight > 0,
    `mobile stress graph must remain visible: ${
      JSON.stringify(responsiveState)
    }`,
  );

  listRequestTimes = [];
  await openList(page);
  const initialRequestAt = listRequestTimes.at(-1);
  assert.ok(initialRequestAt, 'list page must issue its initial API request');
  const invalidatedAt = Date.now();
  const loginNavigation = page.waitForNavigation({
    timeout: 10_000,
    waitUntil: 'domcontentloaded',
  });
  const cookies = await page.cookies();
  const sessionCookies = cookies.filter((cookie) =>
    cookie.session || cookie.expires === -1
  );
  assert.ok(sessionCookies.length > 0, 'login must create a session cookie');
  await page.deleteCookie(...sessionCookies);
  const loginResponse = await loginNavigation;
  assert.ok(loginResponse, 'session expiry must trigger a document navigation');
  assert.ok(
    [200, 304].includes(loginResponse.status()),
    `unexpected cached login response ${loginResponse.status()}`,
  );
  assert.equal(
    new URL(page.url()).pathname,
    '/app/bull-board/login',
    'the next poll after session invalidation must navigate to the proxied login',
  );
  const expiredSessionPoll = listRequestTimes.find((time) =>
    time >= invalidatedAt
  );
  assert.ok(
    expiredSessionPoll,
    'session invalidation must be detected by a subsequent list API poll',
  );
  assert.ok(
    expiredSessionPoll - initialRequestAt >= 4_500,
    'session expiry navigation must be driven by the next five-second poll',
  );
  assert.deepEqual(
    browserErrors,
    [],
    `browser emitted errors:\n${browserErrors.join('\n')}`,
  );

  console.log(
    `real Chromium dashboard acceptance passed: polling=${pollingDelay}ms, ` +
      `detail=${detailCounts.nodes} nodes/${detailCounts.connectors} connectors, ` +
      `stress=${graph.nodes} nodes/${graph.connectors} connectors`,
  );
} finally {
  await browser.close();
}

function jobUrl(queueName, jobId) {
  return `${bullBoardBase}/queue/${encodeURIComponent(queueName)}/${
    encodeURIComponent(jobId)
  }`;
}

function jobApiPath(queueName, jobId) {
  return `${new URL(bullBoardBase).pathname}/api/queues/${
    encodeURIComponent(queueName)
  }/${encodeURIComponent(jobId)}`;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function login(page) {
  await page.goto(`${extensionBase}/`, { waitUntil: 'domcontentloaded' });
  assert.equal(
    new URL(page.url()).pathname,
    '/app/bull-board/login',
    'unauthenticated browser navigation must reach the proxied login page',
  );
  await page.waitForSelector('input[name="username"]');
  await page.waitForSelector('input[name="password"]');
  await page.type('input[name="username"]', 'test-user');
  await page.type('input[name="password"]', 'test-password');
  const submit = await page.$(
    '.login-form button, .login-form input[type="submit"]',
  );
  assert.ok(submit, 'login page must expose a submit control');
  const response = await clickAndWaitForNavigation(page, submit);
  assert.equal(response?.status(), 200);
  assert.equal(new URL(page.url()).pathname, '/app/bull-board/');
}

async function openList(page) {
  await page.goto(`${extensionBase}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.querySelectorAll('.runs-table tbody tr').length > 0,
    { timeout: 10_000 },
  );
}

async function clickLinkByTextAndWaitForNavigation(page, selector, text) {
  const [navigation] = await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.evaluate(({ selector, text }) => {
      const link = [...document.querySelectorAll(selector)].find((element) =>
        element.textContent?.trim() === text
      );
      if (!(link instanceof HTMLElement)) {
        throw new Error(
          `Unable to find ${selector} with text ${JSON.stringify(text)}`,
        );
      }
      link.click();
    }, { selector, text }),
  ]);
  return navigation;
}

async function clickSelectorAndWaitForNavigation(page, selector) {
  const [navigation] = await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.evaluate((selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) {
        throw new Error(`Unable to find ${selector}`);
      }
      element.click();
    }, selector),
  ]);
  return navigation;
}

async function clickAndWaitForNavigation(page, element) {
  const [navigation] = await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    element.click(),
  ]);
  return navigation;
}

async function waitFor(predicate, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${description}`);
}
