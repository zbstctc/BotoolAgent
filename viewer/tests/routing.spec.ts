import { test, expect, type Page, type Route } from '@playwright/test';

// Generous timeout — dev server API can be slow.
test.setTimeout(60_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockRequirement {
  id: string;
  name: string;
  stage: 0 | 1 | 2 | 3 | 4 | 5;
  status: 'active' | 'completed';
  createdAt: number;
  updatedAt: number;
  taskCount: number;
  tasksCompleted: number;
  branchName: string;
}

function makeRequirement(stage: 0 | 1 | 2 | 3 | 4 | 5): MockRequirement {
  return {
    id: `test-stage-${stage}`,
    name: `Test Stage ${stage}`,
    stage,
    status: stage === 5 ? 'completed' : 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    taskCount: 8,
    tasksCompleted: stage >= 5 ? 8 : stage >= 3 ? 4 : 0,
    branchName: `botool/test-stage-${stage}`,
  };
}

/** Expected navigation target for each requirement stage. */
const STAGE_TARGET: Record<number, number> = {
  0: 1,
  1: 1,
  2: 3,
  3: 3,
  4: 4,
  5: 5,
};

/**
 * Intercept /api/requirements and return a controlled list of requirements.
 * Also intercepts other API calls to avoid 500 errors on stage pages.
 */
async function mockApi(page: Page, requirements: MockRequirement[]) {
  // Use full glob patterns — Playwright needs '**' prefix to match full URLs.
  await page.route('**/api/requirements', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: requirements }),
    });
  });

  // Mock claude-processes to avoid runtime errors in ClaudeProcesses component.
  await page.route('**/api/claude-processes', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        processes: [],
        totalMemoryMb: 0,
        totalCount: 0,
        timestamp: Date.now(),
      }),
    });
  });

  // Catch-all for other API routes to avoid 500s on stage pages.
  await page.route('**/api/**', async (route: Route) => {
    const url = route.request().url();
    // Let specifically-mocked routes through.
    if (url.includes('/api/requirements') || url.includes('/api/claude-processes')) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });
}

/** Navigate and wait only for DOM — avoids slow API blocking the load event. */
async function gotoPage(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
}

// ---------------------------------------------------------------------------
// 1. Dashboard card action button routing
// ---------------------------------------------------------------------------

test.describe('Dashboard card action button routing', () => {
  for (const stage of [0, 1, 2, 3, 4, 5] as const) {
    const target = STAGE_TARGET[stage];
    const reqId = `test-stage-${stage}`;

    test(`Stage ${stage} card button navigates to /stage${target}`, async ({ page }) => {
      const req = makeRequirement(stage);
      await mockApi(page, [req]);
      await gotoPage(page, '/');

      // Wait for card to appear
      await expect(page.getByText(req.name)).toBeVisible({ timeout: 15_000 });

      // Get the action button text based on stage (exact match to avoid card div)
      const buttonText = stage === 0 ? '开始 →' : stage === 5 ? '查看' : '继续 →';
      const actionButton = page.getByRole('button', { name: buttonText, exact: true });
      await expect(actionButton).toBeVisible({ timeout: 5_000 });

      await actionButton.click();
      await page.waitForURL(`**/stage${target}?req=${reqId}`, { timeout: 10_000 });
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Dashboard drawer stage action button routing
// ---------------------------------------------------------------------------

test.describe('Dashboard drawer stage action button routing', () => {
  const STAGE_ACTION_LABELS: Record<number, string> = {
    0: '开始 PRD',
    1: '继续生成',
    2: '开始开发',
    3: '查看开发',
    4: '查看测试',
    5: '合并代码',
  };

  for (const stage of [0, 1, 2, 3, 4, 5] as const) {
    const target = STAGE_TARGET[stage];
    const reqId = `test-stage-${stage}`;

    test(`Stage ${stage} drawer button navigates to /stage${target}`, async ({ page }) => {
      // Use status 'active' so the StageTimeline shows the action button
      // (status 'completed' at stage 5 means "merged" — no action button shown)
      const req = { ...makeRequirement(stage), status: 'active' as const };
      await mockApi(page, [req]);
      await gotoPage(page, '/');

      // Wait for card to appear, then click it to open drawer
      const card = page.getByText(req.name);
      await expect(card).toBeVisible({ timeout: 15_000 });
      await card.click();

      // Wait for drawer to open (StageTimeline should be visible)
      await expect(page.getByText('阶段进度')).toBeVisible({ timeout: 5_000 });

      // Click the stage action button inside the drawer
      const actionLabel = STAGE_ACTION_LABELS[stage];
      const drawerBtn = page.getByRole('button', { name: actionLabel });
      await expect(drawerBtn).toBeVisible({ timeout: 5_000 });
      await drawerBtn.click();

      await page.waitForURL(`**/stage${target}?req=${reqId}`, { timeout: 10_000 });
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Dashboard "规范" button
// ---------------------------------------------------------------------------

test.describe('Dashboard header buttons', () => {
  test('"规范" button navigates to /rules', async ({ page }) => {
    await mockApi(page, []);
    await gotoPage(page, '/');

    // Wait for full hydration: empty state means React finished rendering
    await expect(page.getByText('暂无需求')).toBeVisible({ timeout: 15_000 });

    const rulesBtn = page.getByRole('button', { name: '规范' });
    await rulesBtn.click();

    // Next.js SPA navigation — use polling-based URL check
    await expect(page).toHaveURL(/\/rules/, { timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// 4. TabBar Dashboard tab navigates to /
// ---------------------------------------------------------------------------

test.describe('TabBar Dashboard tab', () => {
  test('clicking Dashboard tab from stage page navigates to /', async ({ page }) => {
    // Use stage 1 (minimal API deps) — navigate via card button to create a tab
    const req = makeRequirement(1);
    await mockApi(page, [req]);
    await gotoPage(page, '/');

    // Click card action to navigate to stage1 (creating a tab)
    await expect(page.getByText(req.name)).toBeVisible({ timeout: 15_000 });
    const actionBtn = page.getByRole('button', { name: '继续 →', exact: true });
    await actionBtn.click();
    await page.waitForURL(`**/stage1?req=${req.id}`, { timeout: 10_000 });

    // Wait for stage1 to render some content
    await expect(page.locator('body')).toBeVisible();

    // Click the Dashboard tab in TabBar
    const dashboardTab = page.getByRole('button', { name: 'Dashboard' });
    await expect(dashboardTab).toBeVisible({ timeout: 5_000 });
    await dashboardTab.click();

    // Next.js SPA navigation — use polling-based URL check
    await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/$/, { timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// 5. Stage pages load without redirect (smoke)
// ---------------------------------------------------------------------------

test.describe('Stage page smoke tests', () => {
  for (const stagePage of [3, 4, 5] as const) {
    test(`/stage${stagePage} loads and stays`, async ({ page }) => {
      const req = makeRequirement(stagePage);
      await mockApi(page, [req]);

      // Seed localStorage with tab data so stage pages have context
      await page.addInitScript(
        ({ reqId, stagePage: sp }) => {
          const tabData = {
            tabs: [{ id: reqId, name: `Test Stage ${sp}`, stage: sp }],
            activeTabId: reqId,
          };
          localStorage.setItem('botool-tabs', JSON.stringify(tabData));
        },
        { reqId: req.id, stagePage },
      );

      await gotoPage(page, `/stage${stagePage}?req=${req.id}`);
      // Verify we stay on the same page (no redirect)
      expect(page.url()).toContain(`/stage${stagePage}`);
      await expect(page.locator('body')).toBeVisible();
    });
  }
});
