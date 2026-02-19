import { test, expect, type Page } from '@playwright/test';

const STORAGE_KEY = 'botool-projects';

// Dev server API routes can be slow under concurrent load; use generous timeouts.
test.setTimeout(60_000);

/**
 * Seed a project into localStorage so useProjectValidation does not redirect.
 * Must be called BEFORE page.goto() — addInitScript runs before page JS.
 */
async function seedProject(page: Page, stage: number) {
  const now = Date.now();
  const storageValue = {
    version: 1,
    activeProjectId: 'e2e-test',
    projects: {
      'e2e-test': {
        id: 'e2e-test',
        name: 'E2E Test',
        currentStage: stage,
        prdId: 'e2e-test',
        branchName: 'botool/e2e-test',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
    },
  };

  await page.addInitScript(
    ({ key, value }) => {
      localStorage.setItem(key, JSON.stringify(value));
    },
    { key: STORAGE_KEY, value: storageValue },
  );
}

/** Navigate and wait only for DOM — avoids slow API blocking the load event. */
async function gotoPage(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
}

// === Dashboard ===
test.describe('Dashboard', () => {
  test('loads and shows requirement list', async ({ page }) => {
    await gotoPage(page, '/');
    await expect(page).toHaveTitle(/Botool/i);
    await expect(page.getByText('我的需求')).toBeVisible({ timeout: 15000 });
  });

  test('requirement cards or empty state visible', async ({ page }) => {
    await gotoPage(page, '/');
    const requirementCards = page.locator('[class*="cursor-pointer"]');
    const emptyState = page.getByText('暂无需求');
    await expect(requirementCards.first().or(emptyState)).toBeVisible({ timeout: 15000 });
  });
});

// === Stage 3 (Coding) ===
test.describe('Stage 3 - Coding', () => {
  test('loads without errors', async ({ page }) => {
    await seedProject(page, 3);
    await gotoPage(page, '/stage3');
    await expect(page.locator('body')).toBeVisible();
    await expect(page.getByText('自动开发')).toBeVisible({ timeout: 15000 });
  });

  test('supports projectId query param', async ({ page }) => {
    await seedProject(page, 3);
    await gotoPage(page, '/stage3?projectId=test-project');
    await expect(page.locator('body')).toBeVisible();
  });
});

// === Stage 4 (Testing) ===
test.describe('Stage 4 - Testing', () => {
  test('loads and shows Start Testing button', async ({ page }) => {
    await seedProject(page, 4);
    await gotoPage(page, '/stage4');
    await expect(page.getByText('6-Layer Verification Pipeline')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Start Testing' })).toBeVisible({ timeout: 15000 });
  });

  test('Proceed to Finalize is disabled initially', async ({ page }) => {
    await seedProject(page, 4);
    await gotoPage(page, '/stage4');
    const proceedBtn = page.getByText('Proceed to Finalize');
    await expect(proceedBtn).toBeVisible({ timeout: 15000 });
    await expect(proceedBtn).toBeDisabled();
  });

  test('supports projectId query param', async ({ page }) => {
    await seedProject(page, 4);
    await gotoPage(page, '/stage4?projectId=test-project');
    await expect(page.getByRole('button', { name: 'Start Testing' })).toBeVisible({ timeout: 15000 });
  });
});

// === Stage 5 (Finalize) ===
test.describe('Stage 5 - Finalize', () => {
  test('loads and shows Pull Request panel', async ({ page }) => {
    await seedProject(page, 5);
    await gotoPage(page, '/stage5');
    await expect(page.getByText('Pull Request')).toBeVisible({ timeout: 15000 });
  });

  test('shows Testing Report Summary section', async ({ page }) => {
    await seedProject(page, 5);
    await gotoPage(page, '/stage5');
    // TestingReportSummary renders one of: loading, error, empty, or report
    const reportLoading = page.getByText('Loading testing report...');
    const reportError = page.getByText('Failed to load testing report.');
    const reportEmpty = page.getByText('No testing report available yet.');
    await expect(
      reportLoading.or(reportError).or(reportEmpty)
    ).toBeVisible({ timeout: 15000 });
  });

  test('Merge button exists and is disabled without PR', async ({ page }) => {
    await seedProject(page, 5);
    await gotoPage(page, '/stage5');
    const mergeBtn = page.getByRole('button', { name: /Merge to main/i });
    await expect(mergeBtn).toBeVisible({ timeout: 15000 });
    await expect(mergeBtn).toBeDisabled();
  });

  test('supports projectId query param', async ({ page }) => {
    await seedProject(page, 5);
    await gotoPage(page, '/stage5?projectId=test-project');
    await expect(page.getByText('Pull Request')).toBeVisible({ timeout: 15000 });
  });
});

// === API Routes ===
test.describe('API Routes', () => {
  test('GET /api/registry returns valid JSON', async ({ request }) => {
    const response = await request.get('/api/registry');
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toHaveProperty('version');
    expect(data).toHaveProperty('projects');
  });

  test('GET /api/agent/status returns status map without projectId', async ({ request }) => {
    const response = await request.get('/api/agent/status');
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    // Without projectId, returns Record<string, Status> (may be empty object)
    expect(typeof data).toBe('object');
  });

  test('GET /api/agent/status supports projectId param', async ({ request }) => {
    const response = await request.get('/api/agent/status?projectId=test-project');
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toHaveProperty('status');
  });

  test('GET /api/review-summary returns data or error gracefully', async ({ request }) => {
    const response = await request.get('/api/review-summary');
    expect(response.status()).not.toBe(500);
  });

  test('GET /api/review-summary supports projectId param', async ({ request }) => {
    const response = await request.get('/api/review-summary?projectId=test-project');
    expect(response.status()).not.toBe(500);
  });

  test('GET /api/prd returns PRD list', async ({ request }) => {
    const response = await request.get('/api/prd');
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toHaveProperty('prds');
    expect(Array.isArray(data.prds)).toBeTruthy();
  });
});
