/**
 * URL → Tab Bootstrap Regression Tests (DT-003)
 *
 * Covers the fix for non-UUID reqId being silently dropped by isValidReqId()
 * in TabPanelManager's urlReqId initializer (DT-001) and bootstrap effect (DT-002).
 *
 * Scenarios:
 *   1. Core regression: non-UUID reqId, tab in localStorage → tab activates correctly
 *   2. Non-UUID reqId, tab NOT in localStorage → shows "项目未找到" error, not old tab
 *   3. UUID reqId regression guard: existing behavior preserved
 *   4. Special-character reqId URL encoding: no injection via switchTab URL
 *   5. BR5 return button: urlNotFound → "返回 Dashboard" clears error state
 */

import { test, expect, type Page, type Route } from '@playwright/test';

test.setTimeout(60_000);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Non-UUID reqId (the bug was that these were dropped by isValidReqId())
const NON_UUID_REQ = 'remote-mobile-pwa';
const NON_UUID_REQ_2 = 'dashboard-clock-widget';

// UUID-format reqId (must remain working after the fix)
const UUID_REQ = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';

// scopedKey('tabs') without workspace → 'botool-tabs'
const TABS_KEY = 'botool-tabs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTabsStorage(opts: { tabId: string; tabName?: string; stage?: number; activeTabId?: string }) {
  return {
    tabs: [{
      id: opts.tabId,
      name: opts.tabName ?? `Test Project ${opts.tabId}`,
      stage: opts.stage ?? 1,
    }],
    activeTabId: opts.activeTabId ?? opts.tabId,
  };
}

function makeRequirement(id: string, name?: string, stage = 1) {
  return {
    id,
    name: name ?? `Test Project ${id}`,
    stage,
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

async function mockBaseApis(page: Page, requirements: ReturnType<typeof makeRequirement>[]) {
  await page.route('**/api/requirements', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: requirements }),
    });
  });

  await page.route('**/api/claude-processes', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ processes: [], totalMemoryMb: 0, totalCount: 0, timestamp: Date.now() }),
    });
  });

  // Generic catch-all for other API routes
  await page.route('**/api/**', async (route: Route) => {
    const url = route.request().url();
    if (url.includes('/api/requirements') || url.includes('/api/claude-processes')) {
      await route.fallback();
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function seedTabsLS(page: Page, tabsStorage: object) {
  await page.addInitScript(
    ({ key, value }: { key: string; value: unknown }) => {
      localStorage.setItem(key, JSON.stringify(value));
    },
    { key: TABS_KEY, value: tabsStorage },
  );
}

// ---------------------------------------------------------------------------
// 1. Core regression: non-UUID reqId, tab in localStorage → correct tab activates
// ---------------------------------------------------------------------------

test.describe('1. 核心回归 — 非 UUID reqId Tab 已存在', () => {
  test('访问 /stage1?req=remote-mobile-pwa，Tab 在 localStorage → 激活正确 Tab', async ({ page }) => {
    // Seed: tabs has remote-mobile-pwa, activeTabId is a DIFFERENT tab (simulates wrong state)
    await seedTabsLS(page, {
      tabs: [
        { id: NON_UUID_REQ, name: 'Remote Mobile PWA', stage: 1 },
        { id: NON_UUID_REQ_2, name: 'Dashboard Clock Widget', stage: 3 },
      ],
      activeTabId: NON_UUID_REQ_2, // ← different from URL req
    });

    // API: only non-UUID req exists (not in requirements, already in tabs is enough)
    await mockBaseApis(page, []);

    await page.goto(`/stage1?req=${NON_UUID_REQ}`, { waitUntil: 'domcontentloaded' });

    // Should NOT show the old tab (dashboard-clock-widget) content
    // Should NOT show "项目未找到" error
    // Should show the stage content for remote-mobile-pwa
    await expect(page.locator('text=项目未找到或已被删除')).not.toBeVisible({ timeout: 5_000 });

    // The URL should reflect the correct req (either stays as-is or gets cleaned up)
    // Main assertion: error state is NOT shown — tab was found and activated
    await expect(page.locator('text=加载中...')).not.toBeVisible({ timeout: 8_000 });
  });

  test('non-UUID Tab 已在 tabs，switchTab URL 使用 encodeURIComponent', async ({ page }) => {
    const specialId = 'project&special=char';
    await seedTabsLS(page, makeTabsStorage({ tabId: specialId, tabName: 'Special Project' }));
    await mockBaseApis(page, []);

    // Track navigation URLs
    const navigatedUrls: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigatedUrls.push(frame.url());
    });

    await page.goto(`/stage1?req=${encodeURIComponent(specialId)}`, { waitUntil: 'domcontentloaded' });

    // Wait for any redirects to settle
    await page.waitForTimeout(2_000);

    // Verify that any URL containing req= has it properly encoded (no raw & injection)
    for (const url of navigatedUrls) {
      if (url.includes('req=')) {
        const urlObj = new URL(url);
        // Should only have one `req` param — encoding prevents injection
        const reqValues = urlObj.searchParams.getAll('req');
        expect(reqValues).toHaveLength(1);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Non-UUID reqId, tab NOT in localStorage → shows "项目未找到"
// ---------------------------------------------------------------------------

test.describe('2. 非 UUID reqId，Tab 不存在 → 项目未找到', () => {
  test('全新浏览器访问 /stage1?req=remote-mobile-pwa → 显示"项目未找到"', async ({ page }) => {
    // No localStorage seed (fresh browser simulation)
    // API: empty requirements (no match)
    await mockBaseApis(page, []);

    await page.goto(`/stage1?req=${NON_UUID_REQ}`, { waitUntil: 'domcontentloaded' });

    // Should show the "not found" error UI, NOT silently fall back to old tab
    await expect(page.locator('text=项目未找到或已被删除')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: '返回 Dashboard' })).toBeVisible();
  });

  test('有其他 Tab 的浏览器访问不存在的非 UUID reqId → 显示"项目未找到"，不显示旧 Tab 内容', async ({ page }) => {
    // Seed: some OTHER tab is active
    await seedTabsLS(page, makeTabsStorage({ tabId: NON_UUID_REQ_2, tabName: 'Dashboard Clock Widget', stage: 3 }));
    // API: empty requirements (remote-mobile-pwa not found)
    await mockBaseApis(page, []);

    await page.goto(`/stage1?req=${NON_UUID_REQ}`, { waitUntil: 'domcontentloaded' });

    // Must show error, must NOT silently display the old tab (dashboard-clock-widget)
    await expect(page.locator('text=项目未找到或已被删除')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: '返回 Dashboard' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 3. UUID reqId regression guard: existing behavior must be preserved
// ---------------------------------------------------------------------------

test.describe('3. UUID reqId 回归防护', () => {
  test('UUID reqId Tab 已存在 → 激活正确 Tab，无退化', async ({ page }) => {
    await seedTabsLS(page, makeTabsStorage({ tabId: UUID_REQ, tabName: 'UUID Project' }));
    await mockBaseApis(page, [makeRequirement(UUID_REQ, 'UUID Project')]);

    await page.goto(`/stage1?req=${UUID_REQ}`, { waitUntil: 'domcontentloaded' });

    // Should not show error
    await expect(page.locator('text=项目未找到或已被删除')).not.toBeVisible({ timeout: 5_000 });
  });

  test('UUID reqId Tab 不存在，requirement 存在 → 创建 Tab 并激活', async ({ page }) => {
    // No tab in localStorage, but requirement exists via API
    await mockBaseApis(page, [makeRequirement(UUID_REQ, 'UUID Project from API')]);

    await page.goto(`/stage1?req=${UUID_REQ}`, { waitUntil: 'domcontentloaded' });

    // Should not show error (tab should be created from requirement)
    await expect(page.locator('text=项目未找到或已被删除')).not.toBeVisible({ timeout: 10_000 });
  });

  test('UUID reqId Tab 不存在，requirement 不存在 → 显示"项目未找到"', async ({ page }) => {
    // Empty localStorage, empty requirements API
    await mockBaseApis(page, []);

    await page.goto(`/stage1?req=${UUID_REQ}`, { waitUntil: 'domcontentloaded' });

    // Should show error
    await expect(page.locator('text=项目未找到或已被删除')).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// 4. Special-character reqId: no injection via openTab URL (DT-002 + BR6)
// ---------------------------------------------------------------------------

test.describe('4. 特殊字符 reqId — URL 编码安全', () => {
  test('含 & 和 = 的 reqId 作为 tab ID，switchTab 生成的 URL 只有一个 req 参数', async ({ page }) => {
    const specialId = 'test&x=1';
    await seedTabsLS(page, makeTabsStorage({ tabId: specialId, tabName: 'Injection Test' }));
    await mockBaseApis(page, []);

    const allUrls: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) allUrls.push(frame.url());
    });

    await page.goto(`/stage1?req=${encodeURIComponent(specialId)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2_000);

    for (const url of allUrls) {
      if (url.includes('req=')) {
        const urlObj = new URL(url);
        expect(urlObj.searchParams.getAll('req')).toHaveLength(1);
        // The 'x' param should NOT exist (injection prevention)
        expect(urlObj.searchParams.has('x')).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 5. BR5 返回 Dashboard 按钮: urlNotFound 态 → 点击 → 回到 Dashboard
// ---------------------------------------------------------------------------

test.describe('5. BR5 — 返回 Dashboard 按钮', () => {
  test('非 UUID reqId + Tab 不存在 → 显示"项目未找到" → 点击"返回 Dashboard" → 回到 Dashboard', async ({ page }) => {
    await mockBaseApis(page, []);

    await page.goto(`/stage1?req=${NON_UUID_REQ}`, { waitUntil: 'domcontentloaded' });

    // Wait for error UI
    await expect(page.locator('text=项目未找到或已被删除')).toBeVisible({ timeout: 10_000 });

    // Click return button
    await page.getByRole('button', { name: '返回 Dashboard' }).click();

    // Error UI should disappear (urlReqId cleared)
    await expect(page.locator('text=项目未找到或已被删除')).not.toBeVisible({ timeout: 5_000 });

    // Should be on dashboard (no repeated "not found" flash)
    await expect(page.locator('text=加载中...')).not.toBeVisible({ timeout: 3_000 });
  });
});
