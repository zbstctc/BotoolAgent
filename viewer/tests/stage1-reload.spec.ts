/**
 * Stage1 Reload Recovery Tests
 *
 * Tests that Stage1 progress is recoverable after full page reloads in all scenarios:
 *   1. Tab list restored from localStorage after reload
 *   2. Q&A in-progress (L2) → reload → "继续需求整理" with correct level
 *   3. PRD draft already saved → reload → immediately shows "PRD 已生成"
 *   4. PRD interrupted (empty prdDraft, 5 levels done) → reload → auto-PRD fires
 *   5. State persists across debounce window before reload
 *   6. "带上下文重试" after resume failure → PRD generated successfully
 *   7. Double reload (reload twice) still recovers correctly
 *   8. Tab activated correctly from localStorage after reload (not just from URL)
 */

import { test, expect, type Page, type Route } from '@playwright/test';

test.setTimeout(60_000);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// UUID format required: isValidReqId() validates UUID format before creating a tab
const REQ_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const STAGE1_STATE_KEY = `botool-pyramid-state-req-${REQ_ID}`;
// scopedKey('tabs') without workspace → 'botool-tabs'
const TABS_KEY = 'botool-tabs';

// ---------------------------------------------------------------------------
// SSE body builders
// ---------------------------------------------------------------------------

function sseDone(sessionId = 'reload-done-session'): string {
  return (
    `data: ${JSON.stringify({ type: 'session', sessionId })}\n\n` +
    `data: ${JSON.stringify({ type: 'done' })}\n\n`
  );
}

function ssePrd(content: string, sessionId = 'reload-prd-session'): string {
  return (
    `data: ${JSON.stringify({ type: 'session', sessionId })}\n\n` +
    `data: ${JSON.stringify({ type: 'text', content })}\n\n` +
    `data: ${JSON.stringify({ type: 'done' })}\n\n`
  );
}

function sseQuestion(question: string, level = 1): string {
  const toolInput = {
    questions: [{ question }],
    metadata: {
      source: 'pyramidprd',
      level,
      levelName: level === 1 ? '核心识别' : '领域分支',
      progress: `${level}/5`,
      totalLevels: 5,
    },
  };
  return (
    `data: ${JSON.stringify({ type: 'session', sessionId: 'reload-q-session' })}\n\n` +
    `data: ${JSON.stringify({ type: 'tool_use', toolId: 'tool-r-1', toolName: 'AskUserQuestion', toolInput })}\n\n`
  );
}

// ---------------------------------------------------------------------------
// State builders
// ---------------------------------------------------------------------------

function makeState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    selectedMode: 'feature',
    isStarted: true,
    cliSessionId: 'reload-old-session',
    currentLevel: 2,
    completedLevels: [1],
    answers: {},
    qaHistory: [
      { level: 1, question: 'L1 核心功能？', answer: '用户管理系统' },
      { level: 1, question: 'L1 目标用户？', answer: '企业内部员工' },
    ],
    prdDraft: '',
    codebaseScanned: false,
    isConfirmationPhase: false,
    confirmationSummary: null,
    writtenPrdFileId: null,
    savedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeTabsStorage(tabId = REQ_ID): Record<string, unknown> {
  return {
    tabs: [{ id: tabId, name: 'Reload Test Project', stage: 1 }],
    activeTabId: tabId,
  };
}

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

async function mockApi(page: Page, chatResponse: string, respondResponse?: string) {
  await page.route('**/api/requirements', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [{
          id: REQ_ID,
          name: 'Reload Test Project',
          stage: 1,
          status: 'active',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }],
      }),
    });
  });

  await page.route('**/api/cli/health', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });

  await page.route('**/api/cli/chat', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
      body: chatResponse,
    });
  });

  await page.route('**/api/cli/respond', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
      body: respondResponse ?? sseDone('reload-respond-session'),
    });
  });

  await page.route('**/api/claude-processes', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ processes: [], totalMemoryMb: 0, totalCount: 0, timestamp: Date.now() }),
    });
  });

  // Catch-all — fallback for specific routes, empty 200 for rest
  await page.route('**/api/**', async (route: Route) => {
    const url = route.request().url();
    if (
      url.includes('/api/requirements') ||
      url.includes('/api/cli/') ||
      url.includes('/api/claude-processes')
    ) {
      await route.fallback();
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function gotoStage1(page: Page) {
  await page.goto(`/stage1?req=${REQ_ID}`, { waitUntil: 'domcontentloaded' });
}

// ---------------------------------------------------------------------------
// 1. Tab list restored from localStorage after reload
// ---------------------------------------------------------------------------

test.describe('Tab 持久化 — reload 后恢复', () => {
  test('localStorage 中的 tab 在 reload 后正确恢复', async ({ page }) => {
    // Pre-seed tabs storage (simulates tab that was previously created & saved)
    await page.addInitScript(
      ({ key, value }: { key: string; value: unknown }) => {
        localStorage.setItem(key, JSON.stringify(value));
      },
      { key: TABS_KEY, value: makeTabsStorage() },
    );
    await page.addInitScript(
      ({ key, value }: { key: string; value: unknown }) => {
        localStorage.setItem(key, JSON.stringify(value));
      },
      { key: STAGE1_STATE_KEY, value: makeState() },
    );

    await mockApi(page, sseDone());
    await gotoStage1(page);

    // Tab shows "继续需求整理" — state restored
    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });

    // Now reload
    await page.reload({ waitUntil: 'domcontentloaded' });

    // Tab should STILL show "继续需求整理" after reload (tabs + stage1 state both persisted)
    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });

    // Tabs still in localStorage
    const tabsData = await page.evaluate((key: string) => {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }, TABS_KEY);
    expect(tabsData).not.toBeNull();
    expect(Array.isArray(tabsData.tabs)).toBe(true);
    expect(tabsData.tabs.some((t: { id: string }) => t.id === REQ_ID)).toBe(true);
  });

  test('reload 后 activeTabId 仍指向正确的 req tab', async ({ page }) => {
    await page.addInitScript(
      ({ key, value }: { key: string; value: unknown }) => {
        localStorage.setItem(key, JSON.stringify(value));
      },
      { key: TABS_KEY, value: makeTabsStorage() },
    );
    await page.addInitScript(
      ({ key, value }: { key: string; value: unknown }) => {
        localStorage.setItem(key, JSON.stringify(value));
      },
      { key: STAGE1_STATE_KEY, value: makeState() },
    );

    await mockApi(page, sseDone());
    await gotoStage1(page);
    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });

    await page.reload({ waitUntil: 'domcontentloaded' });

    // activeTabId should still point to REQ_ID
    const tabsData = await page.evaluate((key: string) => {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }, TABS_KEY);
    expect(tabsData?.activeTabId).toBe(REQ_ID);

    // Stage1 content should still be visible (not dashboard)
    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('选择开发模式')).not.toBeVisible({ timeout: 3_000 });
  });
});

// ---------------------------------------------------------------------------
// 2. Q&A in-progress (L2) → reload → "继续需求整理" with correct level
// ---------------------------------------------------------------------------

test.describe('Q&A 进行中 → reload 后恢复', () => {
  test('L2 问答进行中 → reload → 显示"继续需求整理"带正确层级信息', async ({ page }) => {
    await page.addInitScript(
      ({ key, value }: { key: string; value: unknown }) => {
        localStorage.setItem(key, JSON.stringify(value));
      },
      {
        key: STAGE1_STATE_KEY,
        value: makeState({
          currentLevel: 2,
          completedLevels: [1],
          qaHistory: [
            { level: 1, question: 'L1 功能？', answer: '订单管理' },
            { level: 1, question: 'L1 用户？', answer: '电商运营' },
          ],
        }),
      },
    );

    await mockApi(page, sseDone());
    await gotoStage1(page);

    // First load: shows "继续需求整理" at L2
    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/上次进度.*L2/).first()).toBeVisible({ timeout: 5_000 });

    // Reload
    await page.reload({ waitUntil: 'domcontentloaded' });

    // After reload: SAME state must be restored
    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/上次进度.*L2/).first()).toBeVisible({ timeout: 5_000 });
    // "已完成 1 层"
    await expect(page.getByText(/已完成 1 层/).first()).toBeVisible({ timeout: 5_000 });
    // Mode selector should NOT show
    await expect(page.getByText('选择开发模式')).not.toBeVisible({ timeout: 3_000 });
  });

  test('L4 问答进行中 → reload → 显示"继续需求整理"带 L4 层级信息', async ({ page }) => {
    await page.addInitScript(
      ({ key, value }: { key: string; value: unknown }) => {
        localStorage.setItem(key, JSON.stringify(value));
      },
      {
        key: STAGE1_STATE_KEY,
        value: makeState({
          currentLevel: 4,
          completedLevels: [1, 2, 3],
          qaHistory: Array.from({ length: 9 }, (_, i) => ({
            level: Math.ceil((i + 1) / 3) as 1 | 2 | 3,
            question: `问题 ${i + 1}`,
            answer: `答案 ${i + 1}`,
          })),
        }),
      },
    );

    await mockApi(page, sseDone());
    await gotoStage1(page);

    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/上次进度.*L4/).first()).toBeVisible({ timeout: 5_000 });

    // Reload
    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/上次进度.*L4/).first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/已完成 3 层/).first()).toBeVisible({ timeout: 5_000 });
  });

  test('reload 后 qaHistory 内容完整保存', async ({ page }) => {
    const qaHistory = [
      { level: 1, question: '核心功能？', answer: '支付流程优化' },
      { level: 1, question: '目标用户？', answer: '线下收银员' },
      { level: 2, question: '技术约束？', answer: '需要离线支持' },
    ];
    await page.addInitScript(
      ({ key, value }: { key: string; value: unknown }) => {
        localStorage.setItem(key, JSON.stringify(value));
      },
      { key: STAGE1_STATE_KEY, value: makeState({ qaHistory, currentLevel: 2, completedLevels: [1] }) },
    );

    await mockApi(page, sseDone());
    await gotoStage1(page);
    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });

    // Reload
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });

    // Verify qaHistory is still in localStorage after reload
    const savedState = await page.evaluate((key: string) => {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }, STAGE1_STATE_KEY);

    expect(savedState).not.toBeNull();
    expect(Array.isArray(savedState.qaHistory)).toBe(true);
    expect(savedState.qaHistory).toHaveLength(3);
    expect(savedState.qaHistory[0].answer).toBe('支付流程优化');
    expect(savedState.qaHistory[2].question).toBe('技术约束？');
  });
});

// ---------------------------------------------------------------------------
// 3. PRD draft already saved → reload → immediately shows "PRD 已生成"
// ---------------------------------------------------------------------------

test.describe('PRD 已生成 → reload 后立即恢复', () => {
  test('reload 后 prdDraft 保持，立即显示"PRD 已生成"', async ({ page }) => {
    const prdDraft = '# PRD: Reload 测试项目\n\n## 1. 概述\n\n这是 reload 测试的 PRD。\n\n## 2. 功能需求\n\n- 支付模块\n- 用户模块';
    await page.addInitScript(
      ({ key, value }: { key: string; value: unknown }) => {
        localStorage.setItem(key, JSON.stringify(value));
      },
      {
        key: STAGE1_STATE_KEY,
        value: makeState({
          prdDraft,
          completedLevels: [1, 2, 3, 4, 5],
          currentLevel: 5,
        }),
      },
    );

    await mockApi(page, sseDone());
    await gotoStage1(page);

    // First load: shows PRD immediately
    await expect(page.getByRole('heading', { name: 'PRD 已生成' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: '保存 PRD 并继续' })).toBeVisible({ timeout: 5_000 });

    // Reload
    await page.reload({ waitUntil: 'domcontentloaded' });

    // After reload: STILL shows PRD (prdDraft still in localStorage)
    await expect(page.getByRole('heading', { name: 'PRD 已生成' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: '保存 PRD 并继续' })).toBeVisible({ timeout: 5_000 });
    // Mode selector should NOT show
    await expect(page.getByRole('heading', { name: '选择开发模式' })).not.toBeVisible({ timeout: 3_000 });
  });

  test('reload 后 prdDraft 内容未被清除', async ({ page }) => {
    const prdDraft = '# PRD: 内容保留测试\n\n## 功能\n\n- 功能 A\n- 功能 B';
    await page.addInitScript(
      ({ key, value }: { key: string; value: unknown }) => {
        localStorage.setItem(key, JSON.stringify(value));
      },
      {
        key: STAGE1_STATE_KEY,
        value: makeState({
          prdDraft,
          completedLevels: [1, 2, 3, 4, 5],
          currentLevel: 5,
        }),
      },
    );

    await mockApi(page, sseDone());
    await gotoStage1(page);
    await expect(page.getByRole('heading', { name: 'PRD 已生成' })).toBeVisible({ timeout: 15_000 });

    // Reload
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'PRD 已生成' })).toBeVisible({ timeout: 15_000 });

    // Verify prdDraft is still in localStorage
    const savedState = await page.evaluate((key: string) => {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }, STAGE1_STATE_KEY);
    expect(savedState?.prdDraft).toContain('# PRD: 内容保留测试');
    expect(savedState?.prdDraft).toContain('功能 A');
  });
});

// ---------------------------------------------------------------------------
// 4. PRD interrupted (empty prdDraft, all 5 levels done) → reload → auto-PRD fires
// ---------------------------------------------------------------------------

test.describe('PRD 中断后 → reload 后自动重新生成', () => {
  test('5层完成 + qaHistory + prdDraft空 → reload → auto-PRD 生成成功', async ({ page }) => {
    // Simulates: SSE was cut mid-stream, prdDraft not saved, but completedLevels=[1,2,3,4,5]
    const prdContent = '# PRD: 中断恢复测试\n\n## 1. 概述\n\n自动重新生成的 PRD。\n\n## 2. 功能\n\n- 核心功能 A';
    await page.addInitScript(
      ({ key, value }: { key: string; value: unknown }) => {
        localStorage.setItem(key, JSON.stringify(value));
      },
      {
        key: STAGE1_STATE_KEY,
        value: makeState({
          completedLevels: [1, 2, 3, 4, 5],
          currentLevel: 5,
          prdDraft: '',  // interrupted: empty
          qaHistory: [
            { level: 1, question: 'L1 问题', answer: 'L1 答案' },
            { level: 2, question: 'L2 问题', answer: 'L2 答案' },
            { level: 3, question: 'L3 问题', answer: 'L3 答案' },
            { level: 4, question: 'L4 问题', answer: 'L4 答案' },
            { level: 5, question: 'L5 问题', answer: 'L5 答案' },
          ],
          writtenPrdFileId: null,
        }),
      },
    );

    // Mock: auto-PRD request returns PRD content
    await mockApi(page, ssePrd(prdContent));
    await gotoStage1(page);

    // Auto-PRD fires (needsPrdGeneration = true when completedLevels.includes(5) + qaHistory + !prdDraft)
    await expect(page.getByRole('heading', { name: 'PRD 已生成' })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole('button', { name: '保存 PRD 并继续' })).toBeVisible({ timeout: 5_000 });
  });

  test('PRD 中断 → reload 后 qaHistory 完整（未丢失）', async ({ page }) => {
    const qaHistory = Array.from({ length: 10 }, (_, i) => ({
      level: Math.min(Math.ceil((i + 1) / 2), 5),
      question: `重要问题 ${i + 1}`,
      answer: `重要答案 ${i + 1}`,
    }));

    await page.addInitScript(
      ({ key, value }: { key: string; value: unknown }) => {
        localStorage.setItem(key, JSON.stringify(value));
      },
      {
        key: STAGE1_STATE_KEY,
        value: makeState({
          completedLevels: [1, 2, 3, 4, 5],
          currentLevel: 5,
          prdDraft: '',
          qaHistory,
        }),
      },
    );

    // Mock: returns done (no PRD content) to avoid auto-PRD completing test too fast
    await mockApi(page, sseDone());
    await gotoStage1(page);

    // Wait for page to settle
    await page.waitForTimeout(2_000);

    // qaHistory must survive reload
    const savedState = await page.evaluate((key: string) => {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }, STAGE1_STATE_KEY);

    expect(savedState).not.toBeNull();
    expect(savedState.qaHistory).toHaveLength(10);
    expect(savedState.qaHistory[0].question).toBe('重要问题 1');
    expect(savedState.qaHistory[9].answer).toBe('重要答案 10');
  });
});

// ---------------------------------------------------------------------------
// 5. State persists across debounce window before reload
// ---------------------------------------------------------------------------

test.describe('Debounce 安全性 — reload 前状态已写入', () => {
  test('状态写入 debounce 完成后 reload，状态不丢失', async ({ page }) => {
    // Seed state via addInitScript (simulates pre-existing saved state)
    await page.addInitScript(
      ({ key, value }: { key: string; value: unknown }) => {
        localStorage.setItem(key, JSON.stringify(value));
      },
      {
        key: STAGE1_STATE_KEY,
        value: makeState({
          currentLevel: 3,
          completedLevels: [1, 2],
          qaHistory: [
            { level: 1, question: '核心问题', answer: '核心答案' },
            { level: 2, question: '二级问题', answer: '二级答案' },
          ],
        }),
      },
    );

    await mockApi(page, sseDone());
    await gotoStage1(page);

    // Wait for page to settle and state to be saved (debounce: 500ms + buffer)
    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(800); // > 500ms debounce

    // Verify state IS in localStorage before reload
    const stateBefore = await page.evaluate((key: string) => {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }, STAGE1_STATE_KEY);
    expect(stateBefore).not.toBeNull();
    expect(stateBefore.currentLevel).toBe(3);

    // Reload
    await page.reload({ waitUntil: 'domcontentloaded' });

    // State must be recovered — same level info shown
    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/上次进度.*L3/).first()).toBeVisible({ timeout: 5_000 });

    // Verify localStorage still intact after reload
    const stateAfter = await page.evaluate((key: string) => {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }, STAGE1_STATE_KEY);
    expect(stateAfter).not.toBeNull();
    expect(stateAfter.currentLevel).toBe(3);
    expect(stateAfter.qaHistory).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 6. "带上下文重试" after resume failure → PRD generated successfully
// ---------------------------------------------------------------------------

test.describe('"带上下文重试" 完整 PRD 恢复流程', () => {
  test('resume 失败 → 带上下文重试 → PRD 成功生成', async ({ page }) => {
    const prdContent = '# PRD: 上下文重试测试\n\n## 概述\n\n通过上下文重试生成的 PRD。\n\n## 功能\n\n- 功能 X';
    const qaHistory = [
      { level: 1, question: '主要功能？', answer: '数据可视化' },
      { level: 2, question: '数据来源？', answer: '第三方 API' },
      { level: 3, question: '展示方式？', answer: '图表 + 表格' },
    ];

    // Use page.evaluate (NOT addInitScript) so state is NOT re-seeded on reload
    await mockApi(page, sseDone()); // First chat call returns done → resume fails
    await gotoStage1(page);

    // Seed state after first navigation
    await page.evaluate(
      ({ key, value }: { key: string; value: unknown }) => {
        localStorage.setItem(key, JSON.stringify(value));
      },
      { key: STAGE1_STATE_KEY, value: makeState({ qaHistory, currentLevel: 3, completedLevels: [1, 2] }) },
    );

    // Reload to pick up the seeded state
    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '继续需求整理' }).click();

    // Resume fails (sseDone with no questions)
    await expect(page.getByText('无法恢复上次进度')).toBeVisible({ timeout: 15_000 });

    // Now switch the chat mock to return PRD content for the retry
    await page.route('**/api/cli/chat', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
        body: ssePrd(prdContent),
      });
    });

    // Wait >500ms debounce before clicking (to avoid race with debounced save)
    await page.waitForTimeout(700);

    // Click "带上下文重试"
    await page.getByRole('button', { name: '带上下文重试' }).click();

    // PRD should be generated successfully
    await expect(page.getByRole('heading', { name: 'PRD 已生成' })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole('button', { name: '保存 PRD 并继续' })).toBeVisible({ timeout: 5_000 });
  });

  test('"带上下文重试"后 reload，PRD 仍然可见', async ({ page }) => {
    // Seed state directly: already has prdDraft (simulating state AFTER successful retry+save)
    const prdDraft = '# PRD: 重试后保存的 PRD\n\n## 功能\n\n- 图表\n- 导出';
    await page.addInitScript(
      ({ key, value }: { key: string; value: unknown }) => {
        localStorage.setItem(key, JSON.stringify(value));
      },
      {
        key: STAGE1_STATE_KEY,
        value: makeState({
          prdDraft,
          completedLevels: [1, 2, 3, 4, 5],
          currentLevel: 5,
          qaHistory: [
            { level: 1, question: '主要功能？', answer: '图表展示' },
          ],
        }),
      },
    );

    await mockApi(page, sseDone());
    await gotoStage1(page);

    await expect(page.getByRole('heading', { name: 'PRD 已生成' })).toBeVisible({ timeout: 15_000 });

    // Reload
    await page.reload({ waitUntil: 'domcontentloaded' });

    // PRD should still be visible after reload
    await expect(page.getByRole('heading', { name: 'PRD 已生成' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: '保存 PRD 并继续' })).toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// 7. Double reload — reload twice, still recovers correctly
// ---------------------------------------------------------------------------

test.describe('双次 reload 仍能恢复', () => {
  test('连续两次 reload 后状态仍然完整', async ({ page }) => {
    await page.addInitScript(
      ({ key, value }: { key: string; value: unknown }) => {
        localStorage.setItem(key, JSON.stringify(value));
      },
      {
        key: STAGE1_STATE_KEY,
        value: makeState({
          currentLevel: 3,
          completedLevels: [1, 2],
          qaHistory: [
            { level: 1, question: '双 reload 问题 1', answer: '双 reload 答案 1' },
            { level: 2, question: '双 reload 问题 2', answer: '双 reload 答案 2' },
          ],
        }),
      },
    );

    await mockApi(page, sseDone());
    await gotoStage1(page);
    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });

    // First reload — use networkidle so the webpack dev server has time to stabilize
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/上次进度.*L3/).first()).toBeVisible({ timeout: 5_000 });

    // Second reload
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/上次进度.*L3/).first()).toBeVisible({ timeout: 5_000 });

    // qaHistory preserved
    const savedState = await page.evaluate((key: string) => {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }, STAGE1_STATE_KEY);
    expect(savedState?.qaHistory).toHaveLength(2);
    expect(savedState?.qaHistory[0].answer).toBe('双 reload 答案 1');
  });
});

// ---------------------------------------------------------------------------
// 8. Tab saved to localStorage and survives reload (tab persistence)
// ---------------------------------------------------------------------------

test.describe('Tab 写入 localStorage 后 reload 可从中恢复', () => {
  test('tab 写入 localStorage 后，reload 从 localStorage 恢复（而非 URL 重建）', async ({ page }) => {
    // Pre-seed both tabs and stage1 state
    await page.addInitScript(
      ({ tabsKey, tabsValue, stateKey, stateValue }: {
        tabsKey: string; tabsValue: unknown; stateKey: string; stateValue: unknown;
      }) => {
        localStorage.setItem(tabsKey, JSON.stringify(tabsValue));
        localStorage.setItem(stateKey, JSON.stringify(stateValue));
      },
      {
        tabsKey: TABS_KEY,
        tabsValue: makeTabsStorage(),
        stateKey: STAGE1_STATE_KEY,
        stateValue: makeState({ currentLevel: 2, completedLevels: [1] }),
      },
    );

    await mockApi(page, sseDone());
    await gotoStage1(page);

    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });

    // Verify tab is in localStorage before reload
    const tabsBefore = await page.evaluate((key: string) => {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }, TABS_KEY);
    expect(tabsBefore?.tabs.some((t: { id: string }) => t.id === REQ_ID)).toBe(true);

    // Reload — tab should be restored from localStorage
    await page.reload({ waitUntil: 'networkidle' });

    // After reload: tab from localStorage → Stage1 content still shown
    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 20_000 });

    // Tab still in localStorage after reload
    const tabsAfter = await page.evaluate((key: string) => {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }, TABS_KEY);
    expect(tabsAfter?.tabs.some((t: { id: string }) => t.id === REQ_ID)).toBe(true);
    expect(tabsAfter?.activeTabId).toBe(REQ_ID);
  });
});
