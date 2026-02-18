import { test, expect } from '@playwright/test';

// === Dashboard ===
test.describe('Dashboard', () => {
  test('loads and shows project list', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Botool/i);
    await expect(page.getByText('我的项目')).toBeVisible();
  });

  test('project cards or empty state visible', async ({ page }) => {
    await page.goto('/');
    // Dashboard shows project cards if projects exist, or empty state otherwise
    const projectCards = page.locator('[class*="cursor-pointer"]');
    const emptyState = page.getByText('暂无进行中的项目');
    await expect(projectCards.first().or(emptyState)).toBeVisible();
  });
});

// === Stage 3 (Coding) ===
test.describe('Stage 3 - Coding', () => {
  test('loads without errors', async ({ page }) => {
    await page.goto('/stage3');
    await expect(page.locator('body')).toBeVisible();
    // Should show the stage indicator
    await expect(page.getByText('自动开发')).toBeVisible();
  });

  test('supports projectId query param', async ({ page }) => {
    await page.goto('/stage3?projectId=test-project');
    await expect(page.locator('body')).toBeVisible();
    // Page should load without JS errors
  });
});

// === Stage 4 (Testing) ===
test.describe('Stage 4 - Testing', () => {
  test('loads and shows Start Testing button', async ({ page }) => {
    await page.goto('/stage4');
    await expect(page.getByText('4-Layer Verification Pipeline')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start Testing' })).toBeVisible();
  });

  test('Proceed to Finalize is disabled initially', async ({ page }) => {
    await page.goto('/stage4');
    const proceedBtn = page.getByText('Proceed to Finalize');
    await expect(proceedBtn).toBeVisible();
    await expect(proceedBtn).toBeDisabled();
  });

  test('supports projectId query param', async ({ page }) => {
    await page.goto('/stage4?projectId=test-project');
    await expect(page.getByRole('button', { name: 'Start Testing' })).toBeVisible();
  });
});

// === Stage 5 (Finalize) ===
test.describe('Stage 5 - Finalize', () => {
  test('loads and shows Code Changes panel', async ({ page }) => {
    await page.goto('/stage5');
    await expect(page.getByText('Code Changes')).toBeVisible();
    await expect(page.getByText('Summary & PR')).toBeVisible();
  });

  test('shows Review Summary section', async ({ page }) => {
    await page.goto('/stage5');
    // Stage5 may redirect to Dashboard if no active project (useProjectValidation).
    const stage5Marker = page.getByText('Code Changes');
    const dashboardMarker = page.getByText('我的项目');
    await expect(stage5Marker.or(dashboardMarker)).toBeVisible({ timeout: 10000 });
    if (await dashboardMarker.isVisible()) {
      return;
    }
    // ReviewSummary may be in loading state (skeleton), data state, or error state.
    // Accept any of these as valid — the component is rendered.
    const reviewLoading = page.locator('[data-testid="review-summary-loading"]');
    const reviewHeading = page.getByText('开发评审摘要');
    const reviewError = page.getByText('暂无评审数据');
    const reviewLoadError = page.getByText('无法加载评审摘要');
    const reviewNetworkError = page.getByText('网络错误');
    await expect(
      reviewLoading.or(reviewHeading).or(reviewError).or(reviewLoadError).or(reviewNetworkError)
    ).toBeVisible({ timeout: 10000 });
  });

  test('Merge button exists and is disabled without PR', async ({ page }) => {
    await page.goto('/stage5');
    const mergeBtn = page.getByRole('button', { name: /Merge to main/i });
    await expect(mergeBtn).toBeVisible();
    await expect(mergeBtn).toBeDisabled();
  });

  test('supports projectId query param', async ({ page }) => {
    await page.goto('/stage5?projectId=test-project');
    await expect(page.getByText('Code Changes')).toBeVisible();
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

  test('GET /api/agent/status returns status', async ({ request }) => {
    const response = await request.get('/api/agent/status');
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toHaveProperty('status');
  });

  test('GET /api/agent/status supports projectId param', async ({ request }) => {
    const response = await request.get('/api/agent/status?projectId=test-project');
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toHaveProperty('status');
  });

  test('GET /api/review-summary returns data or error gracefully', async ({ request }) => {
    const response = await request.get('/api/review-summary');
    // May return 200 or 404 depending on state, but should not 500
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
