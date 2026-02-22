/**
 * Stage1 UX Stress Tests
 *
 * Tests error paths, edge cases, and UX resilience under adverse conditions:
 *   1. CLI timeout error → shows basic ErrorRecovery (no "带上下文重试")
 *   2. Resume with immediate done → "无法恢复上次进度" shown
 *   3. "带上下文重试" with qaHistory → sends context msg with history
 *   4. "带上下文重试" without qaHistory → sends fresh start (no history)
 *   5. Large qaHistory (20 items) restores correctly
 *   6. All 5 levels done + qaHistory → auto-PRD fires without user click
 *   7. Old savedAt (48h ago) → no staleness warning (known UX limitation)
 *   8. cliError technical message exposed to user (UX documentation)
 *   9. AskUserQuestion "其他" option → submit disabled until text filled
 *  10. Confirmation phase (isConfirmationPhase) → ConfirmationCard shown
 */

import { test, expect, type Page, type Route } from '@playwright/test';

test.setTimeout(45_000);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// UUID format required: isValidReqId() validates UUID format before creating a tab
const REQ_ID = 'ffffffff-ffff-4fff-ffff-ffffffffffff';
const STAGE1_STATE_KEY = `botool-pyramid-state-req-${REQ_ID}`;

// ---------------------------------------------------------------------------
// SSE body builders
// ---------------------------------------------------------------------------

function sseError(msg: string): string {
  return `data: ${JSON.stringify({ type: 'error', error: msg })}\n\ndata: ${JSON.stringify({ type: 'done' })}\n\n`;
}

function sseDone(sessionId = 'stress-new-session'): string {
  return `data: ${JSON.stringify({ type: 'session', sessionId })}\n\ndata: ${JSON.stringify({ type: 'done' })}\n\n`;
}

function sseAskQuestion(
  questions: Array<{ question: string; options?: Array<{ label: string; description?: string }>; multiSelect?: boolean }>,
  level = 1,
): string {
  const toolInput = {
    questions,
    metadata: {
      source: 'pyramidprd',
      level,
      levelName: level === 1 ? '核心识别' : '领域分支',
      progress: `${level}/5`,
      totalLevels: 5,
    },
  };
  return (
    `data: ${JSON.stringify({ type: 'session', sessionId: 'stress-session-q' })}\n\n` +
    `data: ${JSON.stringify({ type: 'tool_use', toolId: 'tool-stress-1', toolName: 'AskUserQuestion', toolInput })}\n\n`
  );
}

function ssePrd(content: string): string {
  return (
    `data: ${JSON.stringify({ type: 'session', sessionId: 'stress-prd-session' })}\n\n` +
    `data: ${JSON.stringify({ type: 'text', content })}\n\n` +
    `data: ${JSON.stringify({ type: 'done' })}\n\n`
  );
}

// ---------------------------------------------------------------------------
// State builders
// ---------------------------------------------------------------------------

function makeStressState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    selectedMode: 'feature',
    isStarted: true,
    cliSessionId: 'old-session-abc',
    currentLevel: 2,
    completedLevels: [1],
    answers: {},
    qaHistory: [
      { level: 1, question: '主要功能是什么？', answer: '用户管理' },
      { level: 1, question: '目标用户群体？', answer: '企业用户' },
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

function makeLargeQaHistory(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    level: Math.min(Math.ceil((i + 1) / 4), 5),
    question: `测试问题 ${i + 1}`,
    answer: `测试答案 ${i + 1}`,
  }));
}

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Set up API mocks for stress tests.
 * chatResponse: the raw SSE body to return for /api/cli/chat calls
 */
async function mockStressApi(
  page: Page,
  chatResponse: string,
  respondResponse?: string,
) {
  await page.route('**/api/requirements', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [{
          id: REQ_ID,
          name: 'Stress Test Project',
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
      body: respondResponse ?? sseDone('stress-respond-session'),
    });
  });

  await page.route('**/api/claude-processes', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ processes: [], totalMemoryMb: 0, totalCount: 0, timestamp: Date.now() }),
    });
  });

  // Catch-all
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

async function seedState(page: Page, state: Record<string, unknown>) {
  await page.addInitScript(
    ({ key, value }: { key: string; value: unknown }) => {
      localStorage.setItem(key, JSON.stringify(value));
    },
    { key: STAGE1_STATE_KEY, value: state },
  );
}

async function gotoStage1(page: Page) {
  await page.goto(`/stage1?req=${REQ_ID}`, { waitUntil: 'domcontentloaded' });
}

// ---------------------------------------------------------------------------
// 1. CLI Timeout Error → basic ErrorRecovery (no "带上下文重试")
// ---------------------------------------------------------------------------

test.describe('Stage1 Stress — CLI 超时错误路径', () => {
  test('CLI 超时后显示 ErrorRecovery，只有"重新开始"和"返回首页"', async ({ page }) => {
    await seedState(page, makeStressState());
    await mockStressApi(page, sseError('CLI process timed out'));
    await gotoStage1(page);

    // State restored → "继续需求整理" button shows
    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '继续需求整理' }).click();

    // After CLI error fires, shows ErrorRecovery
    await expect(page.getByText('CLI process timed out')).toBeVisible({ timeout: 15_000 });

    // Should have "重新开始" button
    await expect(page.getByRole('button', { name: '重新开始' })).toBeVisible({ timeout: 5_000 });

    // Should have "返回首页" button
    await expect(page.getByRole('button', { name: '返回首页' })).toBeVisible({ timeout: 5_000 });

    // Should NOT have "带上下文重试" button (UX gap: timeout uses basic recovery)
    await expect(page.getByRole('button', { name: '带上下文重试' })).not.toBeVisible({ timeout: 3_000 });
  });

  test('CLI 超时后 localStorage 状态仍然保留（不丢失 qaHistory）', async ({ page }) => {
    await seedState(page, makeStressState());
    await mockStressApi(page, sseError('CLI process timed out'));
    await gotoStage1(page);

    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '继续需求整理' }).click();
    await expect(page.getByText('CLI process timed out')).toBeVisible({ timeout: 15_000 });

    // State should still be in localStorage (not cleared by timeout error)
    const saved = await page.evaluate(
      (key: string) => { const r = localStorage.getItem(key); return r ? JSON.parse(r) : null; },
      STAGE1_STATE_KEY,
    );
    expect(saved).not.toBeNull();
    expect(saved.isStarted).toBe(true);
    expect(Array.isArray(saved.qaHistory)).toBe(true);
    expect(saved.qaHistory.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// 2. Resume with immediate done → "无法恢复上次进度"
// ---------------------------------------------------------------------------

test.describe('Stage1 Stress — 简历失败路径', () => {
  test('Resume 无 questions 返回 → 显示"无法恢复上次进度"', async ({ page }) => {
    await seedState(page, makeStressState());
    // Mock: SSE returns done immediately with no tool_use (no questions)
    await mockStressApi(page, sseDone());
    await gotoStage1(page);

    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '继续需求整理' }).click();

    // After resume returns done with no questions → "无法恢复上次进度"
    await expect(page.getByText('无法恢复上次进度')).toBeVisible({ timeout: 15_000 });
  });

  test('Resume 失败后显示"带上下文重试"和"重新开始"两个按钮', async ({ page }) => {
    await seedState(page, makeStressState());
    await mockStressApi(page, sseDone());
    await gotoStage1(page);

    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '继续需求整理' }).click();
    await expect(page.getByText('无法恢复上次进度')).toBeVisible({ timeout: 15_000 });

    await expect(page.getByRole('button', { name: '带上下文重试' })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: '重新开始' })).toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// 3. "带上下文重试" sends qaHistory context
// ---------------------------------------------------------------------------

test.describe('Stage1 Stress — 带上下文重试', () => {
  test('带上下文重试：发出的消息包含 qaHistory 和[恢复会话]标记', async ({ page }) => {
    await seedState(page, makeStressState({
      qaHistory: [
        { level: 1, question: '主要功能是什么？', answer: '用户管理' },
        { level: 1, question: '目标用户？', answer: '企业用户' },
        { level: 2, question: '技术栈？', answer: 'React + Node.js' },
      ],
    }));
    await mockStressApi(page, sseDone());
    await gotoStage1(page);

    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '继续需求整理' }).click();
    await expect(page.getByText('无法恢复上次进度')).toBeVisible({ timeout: 15_000 });

    // Capture the next CLI chat request body
    let capturedBody: string | null = null;
    await page.route('**/api/cli/chat', async (route: Route) => {
      capturedBody = route.request().postData();
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sseDone('retry-session'),
      });
    });

    await page.getByRole('button', { name: '带上下文重试' }).click();

    // Wait for the request to fire
    await page.waitForTimeout(2_000);

    expect(capturedBody).not.toBeNull();
    const parsed = JSON.parse(capturedBody!);
    expect(parsed.message).toContain('恢复会话');
    expect(parsed.message).toContain('主要功能是什么？');
    expect(parsed.message).toContain('用户管理');
    expect(parsed.message).toContain('React + Node.js');
  });

  test('带上下文重试：无 qaHistory 时不包含[恢复会话]，直接重新开始', async ({ page }) => {
    await seedState(page, makeStressState({ qaHistory: [] }));
    await mockStressApi(page, sseDone());
    await gotoStage1(page);

    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '继续需求整理' }).click();
    await expect(page.getByText('无法恢复上次进度')).toBeVisible({ timeout: 15_000 });

    let capturedBody: string | null = null;
    await page.route('**/api/cli/chat', async (route: Route) => {
      capturedBody = route.request().postData();
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sseDone('fresh-session'),
      });
    });

    await page.getByRole('button', { name: '带上下文重试' }).click();
    await page.waitForTimeout(2_000);

    expect(capturedBody).not.toBeNull();
    const parsed = JSON.parse(capturedBody!);
    // Without qaHistory, should NOT include "恢复会话" — should be a fresh start message
    expect(parsed.message).not.toContain('恢复会话');
    // Should still include pyramidprd skill invocation
    expect(parsed.message).toContain('/botoolagent-pyramidprd');
  });
});

// ---------------------------------------------------------------------------
// 4. Large qaHistory (20 items) restores correctly
// ---------------------------------------------------------------------------

test.describe('Stage1 Stress — 大量 Q&A 历史', () => {
  test('20 条 qaHistory 正确恢复，显示继续按钮和正确层级', async ({ page }) => {
    const largeHistory = makeLargeQaHistory(20);
    await seedState(page, makeStressState({
      qaHistory: largeHistory,
      currentLevel: 5,
      completedLevels: [1, 2, 3, 4],
    }));
    await mockStressApi(page, sseDone());
    await gotoStage1(page);

    // Should show "继续需求整理" with correct level info
    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });
    // Shows "L5" current level — use .first() since TabPanelManager dual-renders Stage1Content
    await expect(page.getByText(/上次进度.*L5/).first()).toBeVisible({ timeout: 5_000 });
    // Shows "已完成 4 层"
    await expect(page.getByText(/已完成 4 层/).first()).toBeVisible({ timeout: 5_000 });
  });

  test('20 条 qaHistory 的带上下文重试消息包含完整历史', async ({ page }) => {
    const largeHistory = makeLargeQaHistory(20);
    await seedState(page, makeStressState({
      qaHistory: largeHistory,
      currentLevel: 5,
      completedLevels: [1, 2, 3, 4],
    }));
    await mockStressApi(page, sseDone());
    await gotoStage1(page);

    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '继续需求整理' }).click();
    await expect(page.getByText('无法恢复上次进度')).toBeVisible({ timeout: 15_000 });

    let capturedBody: string | null = null;
    await page.route('**/api/cli/chat', async (route: Route) => {
      capturedBody = route.request().postData();
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sseDone('large-history-session'),
      });
    });

    await page.getByRole('button', { name: '带上下文重试' }).click();
    await page.waitForTimeout(2_000);

    expect(capturedBody).not.toBeNull();
    const parsed = JSON.parse(capturedBody!);
    // All 20 history items should be in the context message
    for (let i = 1; i <= 20; i++) {
      expect(parsed.message).toContain(`测试问题 ${i}`);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. All 5 levels done + qaHistory → auto-PRD fires without click
// ---------------------------------------------------------------------------

test.describe('Stage1 Stress — 自动生成 PRD（全5层完成）', () => {
  test('全5层完成 + qaHistory → 页面加载后自动请求 PRD 生成', async ({ page }) => {
    const prdContent = '# PRD: 自动生成测试\n\n## 1. 项目概述\n这是自动生成的 PRD 内容。\n\n## 2. 功能需求\n- 功能 A\n- 功能 B';
    await seedState(page, makeStressState({
      completedLevels: [1, 2, 3, 4, 5],
      currentLevel: 5,
      qaHistory: makeLargeQaHistory(10),
      prdDraft: '',
      writtenPrdFileId: null,
    }));
    await mockStressApi(page, ssePrd(prdContent));
    await gotoStage1(page);

    // PRD auto-generation should fire without user needing to click anything
    // (needsPrdGeneration fires when completedLevels.includes(5) + qaHistory.length > 0)
    // Use getByRole (ARIA-aware) to avoid strict mode violation from TabPanelManager dual rendering
    await expect(page.getByRole('heading', { name: 'PRD 已生成' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: '保存 PRD 并继续' })).toBeVisible({ timeout: 5_000 });
    // Mode selector should NOT show
    await expect(page.getByRole('heading', { name: '选择开发模式' })).not.toBeVisible({ timeout: 3_000 });
  });

  test('全5层完成但 qaHistory 为空 → PRD 自动生成不触发，显示继续按钮', async ({ page }) => {
    // needsPrdGeneration requires qaHistory.length > 0 to auto-trigger
    await seedState(page, makeStressState({
      completedLevels: [1, 2, 3, 4, 5],
      currentLevel: 5,
      qaHistory: [],  // no history → auto-PRD won't fire
      prdDraft: '',
    }));
    await mockStressApi(page, sseDone());
    await gotoStage1(page);

    // Without qaHistory, auto-PRD doesn't fire → shows "继续需求整理"
    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('PRD 已生成')).not.toBeVisible({ timeout: 3_000 });
  });
});

// ---------------------------------------------------------------------------
// 6. Old savedAt (48h ago) → no staleness warning
// ---------------------------------------------------------------------------

test.describe('Stage1 Stress — 旧会话无过期提示（已知限制）', () => {
  test('savedAt 48 小时前的会话仍显示"继续需求整理"，不显示过期警告', async ({ page }) => {
    const staleDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    await seedState(page, makeStressState({ savedAt: staleDate }));
    await mockStressApi(page, sseDone());
    await gotoStage1(page);

    // Shows "继续需求整理" button (state restored from localStorage)
    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });

    // Known limitation: no staleness warning is shown
    // If this test FAILS in future, it means a staleness warning was added (good improvement!)
    await expect(page.getByText(/过期/)).not.toBeVisible({ timeout: 3_000 });
    await expect(page.getByText(/48 小时/)).not.toBeVisible({ timeout: 3_000 });
    await expect(page.getByText(/会话已旧/)).not.toBeVisible({ timeout: 3_000 });
  });
});

// ---------------------------------------------------------------------------
// 7. cliError: technical message exposed to user
// ---------------------------------------------------------------------------

test.describe('Stage1 Stress — CLI 错误消息', () => {
  test('CLI 超时错误消息原文显示给用户（技术性消息暴露问题）', async ({ page }) => {
    await seedState(page, makeStressState());
    await mockStressApi(page, sseError('CLI process timed out'));
    await gotoStage1(page);

    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '继续需求整理' }).click();

    // Known issue: the raw technical error string is shown to user
    // If this test FAILS in future, it means error messages were made user-friendly (good!)
    await expect(page.getByText('CLI process timed out')).toBeVisible({ timeout: 15_000 });
  });

  test('网络错误时 cliError 信息显示在错误恢复卡中', async ({ page }) => {
    await seedState(page, makeStressState());
    await mockStressApi(page, sseError('连接失败'));
    await gotoStage1(page);

    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '继续需求整理' }).click();

    // Error recovery card appears
    await expect(page.getByText('连接失败')).toBeVisible({ timeout: 15_000 });
    // Both recovery actions available
    await expect(page.getByRole('button', { name: '重新开始' })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: '返回首页' })).toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// 8. AskUserQuestion: "其他" option → submit disabled until text filled
// ---------------------------------------------------------------------------

test.describe('Stage1 Stress — 问答交互', () => {
  test('问题有选项：选择"其他"后 textarea 为空时提交按钮禁用', async ({ page }) => {
    // Mock: CLI returns AskUserQuestion with options
    // Do NOT include an option named "其他" to avoid 2 ambiguous buttons.
    // Stage1Content always appends a special "其他 (输入自定义答案)" button;
    // if an option is also named "其他", there would be 2 buttons with that label.
    const questionSse = sseAskQuestion([{
      question: '你的主要功能需求是什么？',
      options: [
        { label: '用户管理', description: '管理用户账号和权限' },
        { label: '数据分析', description: '统计和可视化数据' },
      ],
    }], 1);

    await seedState(page, makeStressState({ isStarted: false, completedLevels: [], currentLevel: 1 }));
    await mockStressApi(page, questionSse);
    await gotoStage1(page);

    // Wait for mode selector or start button
    const startVisible = await page.getByRole('button', { name: '启动 AI 需求整理' }).isVisible().catch(() => false);
    if (!startVisible) {
      // State has isStarted: false, may show mode selector if no selectedMode
      // In this case selectedMode IS in state (makeStressState has selectedMode: 'feature')
      await expect(page.getByRole('button', { name: '启动 AI 需求整理' })).toBeVisible({ timeout: 15_000 });
    }

    await page.getByRole('button', { name: '启动 AI 需求整理' }).click();

    // Questions should appear (CLI chat mock returns AskUserQuestion SSE)
    await expect(page.getByText('你的主要功能需求是什么？')).toBeVisible({ timeout: 15_000 });

    // Submit button should be disabled (no answer selected yet)
    const submitBtn = page.getByRole('button', { name: /继续下一层|确认并生成 PRD/i });
    await expect(submitBtn).toBeDisabled({ timeout: 5_000 });

    // Click the special "其他" button (always appended by Stage1Content after the option list)
    await page.getByRole('button', { name: /其他/ }).click();

    // Submit still disabled (Other selected but textarea empty)
    await expect(submitBtn).toBeDisabled({ timeout: 3_000 });

    // Fill in the custom answer
    await page.getByPlaceholder('请输入你的答案...').fill('自定义功能需求');

    // Now submit should be enabled
    await expect(submitBtn).toBeEnabled({ timeout: 3_000 });
  });

  test('问题有选项：正常选择一个选项后提交按钮启用', async ({ page }) => {
    const questionSse = sseAskQuestion([{
      question: '目标用户群体是什么？',
      options: [
        { label: '消费者', description: 'B2C 用户' },
        { label: '企业客户', description: 'B2B 用户' },
      ],
    }], 1);

    await seedState(page, makeStressState({ isStarted: false, completedLevels: [], currentLevel: 1 }));
    await mockStressApi(page, questionSse);
    await gotoStage1(page);

    await expect(page.getByRole('button', { name: '启动 AI 需求整理' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '启动 AI 需求整理' }).click();

    await expect(page.getByText('目标用户群体是什么？')).toBeVisible({ timeout: 15_000 });

    const submitBtn = page.getByRole('button', { name: /继续下一层/i });
    await expect(submitBtn).toBeDisabled({ timeout: 5_000 });

    // Select "消费者"
    await page.getByRole('button', { name: /消费者/ }).click();
    await expect(submitBtn).toBeEnabled({ timeout: 3_000 });
  });

  test('文本输入型问题：空内容时提交禁用，填写后启用', async ({ page }) => {
    // Text input question (no options)
    const questionSse = sseAskQuestion([{
      question: '请描述你的核心业务流程',
      // No options → renders as textarea
    }], 1);

    await seedState(page, makeStressState({ isStarted: false, completedLevels: [], currentLevel: 1 }));
    await mockStressApi(page, questionSse);
    await gotoStage1(page);

    await expect(page.getByRole('button', { name: '启动 AI 需求整理' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '启动 AI 需求整理' }).click();

    await expect(page.getByText('请描述你的核心业务流程')).toBeVisible({ timeout: 15_000 });

    const submitBtn = page.getByRole('button', { name: /继续下一层/i });
    await expect(submitBtn).toBeDisabled({ timeout: 5_000 });

    // Fill in the textarea
    await page.getByPlaceholder('请输入...').fill('用户注册登录 → 浏览商品 → 加入购物车 → 下单支付');
    await expect(submitBtn).toBeEnabled({ timeout: 3_000 });
  });
});

// ---------------------------------------------------------------------------
// 9. PRD 已保存状态 — 刷新后立即显示 PRD
// ---------------------------------------------------------------------------

test.describe('Stage1 Stress — PRD 保存状态恢复', () => {
  test('有 prdDraft 的保存状态恢复后立即显示 PRD 内容', async ({ page }) => {
    const prdContent = '# PRD: 之前生成的项目\n\n## 1. 概述\n已保存的 PRD 内容。\n\n## 2. 功能\n- 功能列表';
    await seedState(page, makeStressState({
      prdDraft: prdContent,
      completedLevels: [1, 2, 3, 4, 5],
      currentLevel: 5,
    }));
    await mockStressApi(page, sseDone());
    await gotoStage1(page);

    // Should show PRD immediately (prdDraft is saved)
    // Use getByRole (ARIA-aware) to avoid strict mode violation from TabPanelManager dual rendering
    await expect(page.getByRole('heading', { name: 'PRD 已生成' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: '保存 PRD 并继续' })).toBeVisible({ timeout: 5_000 });
    // Mode selector should NOT show
    await expect(page.getByRole('heading', { name: '选择开发模式' })).not.toBeVisible({ timeout: 3_000 });
  });

  test('PRD 已保存时不触发 needsPrdGeneration（不发出额外 CLI 请求）', async ({ page }) => {
    const prdContent = '# PRD: 测试\n\n## 功能\n- A';
    await seedState(page, makeStressState({
      prdDraft: prdContent,
      completedLevels: [1, 2, 3, 4, 5],
      currentLevel: 5,
    }));

    let chatCalled = false;
    await page.route('**/api/requirements', async (route: Route) => {
      // Must include REQ_ID: TabPanelManager.find(r => r.id === urlReqId) fails on empty array → tab never opens
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: REQ_ID, name: 'Stress Test Project', stage: 1, status: 'active', createdAt: Date.now(), updatedAt: Date.now() }] }) });
    });
    await page.route('**/api/cli/health', async (route: Route) => {
      await route.fulfill({ status: 200, body: '{"ok":true}' });
    });
    await page.route('**/api/cli/chat', async (route: Route) => {
      chatCalled = true;
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sseDone() });
    });
    await page.route('**/api/**', async (route: Route) => {
      await route.fallback();
    });

    await gotoStage1(page);
    // Use getByRole (ARIA-aware) to avoid strict mode violation from TabPanelManager dual rendering
    await expect(page.getByRole('heading', { name: 'PRD 已生成' })).toBeVisible({ timeout: 15_000 });

    // Wait to ensure no delayed CLI request fires
    await page.waitForTimeout(2_000);

    // needsPrdGeneration should be false (prdDraft is set) → no CLI chat
    expect(chatCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 10. 连接状态 UI 校验
// ---------------------------------------------------------------------------

test.describe('Stage1 Stress — 连接断开后的恢复流程', () => {
  test('"重新开始"后状态清除，跳转后显示模式选择', async ({ page }) => {
    // Use sseDone so resume fails → "无法恢复上次进度" whose "重新开始" actually clears localStorage.
    // Use page.evaluate (NOT addInitScript) to seed state so it is NOT re-seeded on page.reload().
    await mockStressApi(page, sseDone());
    await gotoStage1(page);

    // Seed state after first navigation (not via addInitScript, so won't re-run on reload)
    await page.evaluate(
      ({ key, value }: { key: string; value: unknown }) => { localStorage.setItem(key, JSON.stringify(value)); },
      { key: STAGE1_STATE_KEY, value: makeStressState() },
    );

    // Reload to pick up the seeded state
    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '继续需求整理' }).click();
    await expect(page.getByText('无法恢复上次进度')).toBeVisible({ timeout: 15_000 });

    // Wait >500ms for Stage1Content's debounced save effect to flush any pending write.
    // Without this, a 500ms debounce triggered by the cliSessionId change (from sseDone)
    // can fire AFTER removeItem, writing state back before the reload completes.
    await page.waitForTimeout(700);

    // "重新开始" in resume-failure context: localStorage.removeItem(key) + resetSession() + reload
    const navPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.getByRole('button', { name: '重新开始' }).click();
    await navPromise;

    // After reload with no addInitScript re-seeding, state should be cleared
    const saved = await page.evaluate(
      (key: string) => localStorage.getItem(key),
      STAGE1_STATE_KEY,
    );
    expect(saved).toBeNull();

    // Shows mode selector (no saved state → initial visit)
    await expect(page.getByRole('heading', { name: '选择开发模式' })).toBeVisible({ timeout: 10_000 });
  });
});
