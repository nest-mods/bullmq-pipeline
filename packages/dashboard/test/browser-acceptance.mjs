import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const bullBoardBase = 'http://nginx/app/bull-board';
const extensionBase = bullBoardBase + '/ext/pipeline-dashboard';
const listApiPath = '/app/bull-board/ext/pipeline-dashboard/api/pipelines';
const browser = await puppeteer.launch({ headless: true });

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const browserErrors = [];
  let listRequestCount = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'GET' &&
      new URL(request.url()).pathname === listApiPath
    ) {
      listRequestCount++;
    }
  });
  page.on('pageerror', (error) => {
    browserErrors.push('pageerror: ' + (error.stack || error.message || error));
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      browserErrors.push('console.error: ' + message.text());
    }
  });

  await login(page);
  listRequestCount = 0;
  await openList(page);
  const listSnapshot = await page.$eval('.runs-table', (table) => {
    const rows = [...table.querySelectorAll('tbody tr')];
    const selectedRun = rows.find((row) =>
      row.querySelector('.pipeline-link')?.textContent?.trim() ===
        'social-analysis-report'
    );
    return {
      headers: [...table.querySelectorAll('thead th')].map((heading) =>
        heading.textContent?.trim()
      ),
      rows: rows.length,
      selectedText: selectedRun?.textContent || '',
      text: table.textContent || '',
    };
  });
  assert.deepEqual(listSnapshot.headers, [
    'Pipeline',
    'Status',
    'Tasks',
    'Updated',
  ]);
  assert.equal(listSnapshot.rows, 25);
  assert.match(
    listSnapshot.selectedText,
    /2 completed\s*·\s*1 unfinished\s*·\s*1 failed/,
  );
  assert.doesNotMatch(listSnapshot.text, /dashboard-e2e-run/);
  assert.equal(listRequestCount, 1);

  await new Promise((resolve) => setTimeout(resolve, 5_500));
  assert.equal(
    listRequestCount,
    1,
    'the list must not refresh while an operator is reading it',
  );
  await clickRefreshAndWaitForNavigation(page);
  await page.waitForSelector('.runs-table');
  assert.equal(listRequestCount, 2);

  await clickLinkByTextAndWaitForNavigation(
    page,
    '.pipeline-link',
    'social-analysis-report',
  );
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.stage-card').length === 4 &&
      document.querySelectorAll('.connector').length === 4,
  );
  const detail = await page.$eval(
    '[data-testid="pipeline-graph"]',
    (graph) => ({
      cards: graph.querySelectorAll('.stage-card').length,
      connectors: graph.querySelectorAll('.connector').length,
      nodeRows: document.querySelectorAll('.node-row').length,
      text: graph.textContent || '',
    }),
  );
  assert.deepEqual(
    { cards: detail.cards, connectors: detail.connectors, nodeRows: detail.nodeRows },
    { cards: 4, connectors: 4, nodeRows: 0 },
  );
  assert.doesNotMatch(detail.text, /report-node|invocation|scope|parent/i);
  assert.match(detail.text, /complete-report-generation/);

  const completedStyle = await stageStatusStyle(page, 'report-stage', 'COMPLETED');
  const failedStyle = await stageStatusStyle(page, 'crawl-stage', 'FAILED');
  assert.notEqual(completedStyle.color, failedStyle.color);
  assert.notEqual(completedStyle.cardBorder, failedStyle.cardBorder);

  await page.click(
    '[data-stage-id="crawl-stage"] .stage-status[data-status="FAILED"]',
  );
  await page.waitForSelector('.node-inspector .node-row');
  const failedNode = await page.$eval('.node-inspector .node-row', (node) => ({
    attempt: node.querySelector('.node-attempt')?.textContent?.trim(),
    error: node.querySelector('.node-error')?.textContent?.trim(),
    jobId: node.querySelector('.job-reference code')?.textContent?.trim(),
    copyLabel: node.querySelector('.copy-job-id')?.getAttribute('aria-label'),
    jobLabel: node.querySelector('.job-link')?.textContent?.trim(),
    status: node.dataset.status,
  }));
  assert.deepEqual(failedNode, {
    attempt: 'Attempt 3/3',
    error: 'provider failed',
    jobId: 'crawl-job',
    copyLabel: 'Copy Job ID',
    jobLabel: 'View job',
    status: 'FAILED',
  });
  const crawlJobUrl = jobUrl(
    'pipeline--social-analysis-crawl--crawl-source',
    'crawl-job',
  );
  const crawlJobResponse = await clickSelectorAndWaitForNavigation(
    page,
    '.node-inspector .job-link',
  );
  assert.equal(crawlJobResponse?.status(), 200);
  assert.equal(page.url(), crawlJobUrl);

  await page.goto(extensionBase + '/?runId=dashboard-stress-run', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.stage-card').length === 10 &&
      document.querySelectorAll('.connector').length === 9,
    { timeout: 15_000 },
  );
  const stressGraph = await page.$eval(
    '[data-testid="pipeline-graph"]',
    (graph) => ({
      cards: graph.querySelectorAll('.stage-card').length,
      connectors: graph.querySelectorAll('.connector').length,
      nodeRows: document.querySelectorAll('.node-row').length,
      totals: [...graph.querySelectorAll('.stage-total')].map((item) =>
        item.textContent?.trim()
      ),
      width: graph.getBoundingClientRect().width,
      height: graph.getBoundingClientRect().height,
    }),
  );
  assert.deepEqual(
    {
      cards: stressGraph.cards,
      connectors: stressGraph.connectors,
      nodeRows: stressGraph.nodeRows,
    },
    { cards: 10, connectors: 9, nodeRows: 0 },
  );
  assert.ok(stressGraph.totals.every((total) => total === '500 tasks'));
  assert.ok(stressGraph.width > 0 && stressGraph.height > 0);

  await page.click(
    '[data-stage-id="stress-stage-09"] .stage-status[data-status="FAILED"]',
  );
  await page.waitForFunction(
    () => document.querySelectorAll('.node-inspector .node-row').length === 25,
  );
  assert.deepEqual(
    await page.$eval('.node-inspector', (inspector) => ({
      page: inspector.querySelector('.pagination-page')?.textContent?.trim(),
      rows: inspector.querySelectorAll('.node-row').length,
      stageCards: document.querySelectorAll('.stage-card').length,
    })),
    { page: 'Page 1', rows: 25, stageCards: 10 },
  );
  await page.click('.node-inspector .pagination-link:last-child');
  await page.waitForFunction(
    () =>
      document.querySelector('.node-inspector .pagination-page')?.textContent
        ?.trim() === 'Page 2',
  );

  const scrolledDistance = await page.$eval(
    '[data-testid="pipeline-graph"]',
    (viewport) => {
      viewport.scrollLeft = Math.min(
        640,
        viewport.scrollWidth - viewport.clientWidth,
      );
      return viewport.scrollLeft;
    },
  );
  assert.ok(scrolledDistance > 0, 'the Stage graph must scroll horizontally');
  await clickRefreshAndWaitForNavigation(page);
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="pipeline-graph"]')?.scrollLeft === 0,
  );

  await page.setViewport({ width: 390, height: 844 });
  await page.emulateMediaFeatures([
    { name: 'prefers-color-scheme', value: 'dark' },
    { name: 'prefers-reduced-motion', value: 'reduce' },
  ]);
  const responsive = await page.$eval(
    '[data-testid="pipeline-graph"]',
    (graph) => ({
      bodyWidth: document.body.scrollWidth,
      graphHeight: graph.getBoundingClientRect().height,
      graphWidth: graph.getBoundingClientRect().width,
      pageWidth: innerWidth,
      stageCards: graph.querySelectorAll('.stage-card').length,
    }),
  );
  assert.equal(responsive.pageWidth, 390);
  assert.equal(responsive.stageCards, 10);
  assert.ok(responsive.graphWidth <= 390 && responsive.graphHeight > 0);
  assert.ok(responsive.bodyWidth <= 390, 'the page shell must not overflow');

  assert.deepEqual(
    browserErrors,
    [],
    'browser emitted errors:\n' + browserErrors.join('\n'),
  );
  console.log(
    'Chromium dashboard acceptance passed: 4-stage real Job detail and ' +
      '10-stage/5000-Node folded graph',
  );
} finally {
  await browser.close();
}

function jobUrl(queueName, jobId) {
  return bullBoardBase + '/queue/' + encodeURIComponent(queueName) + '/' +
    encodeURIComponent(jobId);
}

async function stageStatusStyle(page, stageId, status) {
  return await page.$eval(
    '[data-stage-id="' + stageId + '"]',
    (card, selectedStatus) => {
      const statusButton = card.querySelector(
        '.stage-status[data-status="' + selectedStatus + '"]',
      );
      if (!statusButton) throw new Error('Missing Stage status');
      return {
        cardBorder: getComputedStyle(card).borderLeftColor,
        color: getComputedStyle(statusButton).color,
      };
    },
    status,
  );
}

async function login(page) {
  await page.goto(extensionBase + '/', { waitUntil: 'domcontentloaded' });
  assert.equal(new URL(page.url()).pathname, '/app/bull-board/login');
  await page.type('input[name="username"]', 'test-user');
  await page.type('input[name="password"]', 'test-password');
  const submit = await page.$(
    '.login-form button, .login-form input[type="submit"]',
  );
  assert.ok(submit, 'login page must expose a submit control');
  const response = await clickAndWaitForNavigation(page, submit);
  assert.equal(response?.status(), 200);
}

async function openList(page) {
  await page.goto(extensionBase + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.querySelectorAll('.runs-table tbody tr').length > 0,
    { timeout: 10_000 },
  );
}

async function clickLinkByTextAndWaitForNavigation(
  page,
  selector,
  expectedText,
) {
  const links = await page.$$(selector);
  let match;
  for (const link of links) {
    const text = await link.evaluate((element) => element.textContent?.trim());
    if (text === expectedText) {
      match = link;
      break;
    }
  }
  assert.ok(match, 'Missing link ' + expectedText);
  return await clickAndWaitForNavigation(page, match);
}

async function clickSelectorAndWaitForNavigation(page, selector) {
  const element = await page.$(selector);
  assert.ok(element, 'Missing selector ' + selector);
  return await clickAndWaitForNavigation(page, element);
}

async function clickRefreshAndWaitForNavigation(page) {
  const navigation = page.waitForNavigation({
    timeout: 10_000,
    waitUntil: 'domcontentloaded',
  });
  await page.evaluate(() => {
    const button = document.querySelector('.refresh-button');
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('Missing refresh button');
    }
    button.click();
  });
  return await navigation;
}

async function clickAndWaitForNavigation(page, element) {
  const navigation = page.waitForNavigation({
    timeout: 10_000,
    waitUntil: 'domcontentloaded',
  });
  await element.click();
  return await navigation;
}
