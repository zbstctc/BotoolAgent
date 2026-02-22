/**
 * Stage1 E2E Tests — Comprehensive
 *
 * Covers all Stage1 scenarios:
 *   1. Initial load (no saved state)  → mode selector shown
 *   2. Mode selection (2-step: card click + "确认选择")
 *   3. Quick fix / transform / feature / full mode UIs
 *   4. Progress restoration via reqId-based localStorage key (the key fix)
 *   5. RequirementContext: prdSessionId preserved after API overwrites
 *   6. State saved to correct key after user starts session
 *   7. PRD draft restoration shows "PRD 已生成"
 */

import { test, expect, type Page, type Route } from '@playwright/test';

test.setTimeout(45_000);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REQ_ID = 'e2e-stage1-test';
const STAGE1_STATE_KEY = `botool-pyramid-state-req-${REQ_ID}`;
// RequirementContext uses scopedKey('requirements-v1') → 'botool-requirements-v1' (no workspace in tests)
const REQUIREMENTS_KEY = 'botool-requirements-v1';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MockRequirement {
  id: string;
  name: string;
  stage: 0 | 1 | 2 | 3 | 4 | 5;
  status: 'active' | 'completed';
  createdAt: number;
  updatedAt: number;
  prdSessionId?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(overrides: Partial<MockRequirement> = {}): MockRequirement {
  return {
    id: REQ_ID,
    name: 'E2E Stage1 Test Project',
    stage: 1,
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

/**
 * Mock all necessary API routes for Stage1 tests.
 * - /api/requirements → return controlled list
 * - /api/cli/health   → 200 OK
 * - /api/cli/chat     → empty SSE stream (silent, avoids network errors)
 * - everything else   → empty 200
 */
async function mockApi(page: Page, requirements: MockRequirement[]) {
  await page.route('**/api/requirements', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: requirements }),
    });
  });

  await page.route('**/api/cli/health', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });

  // Silent SSE stream — keeps useCliChat happy without sending any events
  await page.route('**/api/cli/chat', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
      body: '',
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

/** Seed Stage1 localStorage state before page load */
async function seedStage1State(page: Page, state: Record<string, unknown>) {
  await page.addInitScript(
    ({ key, value }: { key: string; value: unknown }) => {
      localStorage.setItem(key, JSON.stringify(value));
    },
    { key: STAGE1_STATE_KEY, value: state },
  );
}

/** Seed RequirementContext localStorage */
async function seedRequirements(page: Page, reqs: MockRequirement[]) {
  const record: Record<string, MockRequirement> = {};
  for (const r of reqs) record[r.id] = r;
  await page.addInitScript(
    ({ key, value }: { key: string; value: unknown }) => {
      localStorage.setItem(key, JSON.stringify(value));
    },
    { key: REQUIREMENTS_KEY, value: record },
  );
}

async function gotoStage1(page: Page, query = `?req=${REQ_ID}`) {
  await page.goto(`/stage1${query}`, { waitUntil: 'domcontentloaded' });
}

/**
 * Select a mode card AND click "确认选择" (two-step ModeSelector flow).
 * Mode cards are <button> elements whose accessible name includes all card text
 * (name + time + suitable + flow), so we locate by the h3 heading inside.
 */
async function selectMode(page: Page, modeName: string) {
  // Click the card that contains an h3 with the mode name
  await page.locator(`button:has(h3:text-is("${modeName}"))`).click();
  await page.getByRole('button', { name: '确认选择' }).click();
}

// ---------------------------------------------------------------------------
// 1. Initial load — mode selector shown
// ---------------------------------------------------------------------------

test.describe('Stage1 — 初始加载', () => {
  test('首次访问（无保存状态）显示模式选择界面', async ({ page }) => {
    await mockApi(page, [makeReq()]);
    await gotoStage1(page);

    await expect(page.getByText('选择开发模式')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('快速修复')).toBeVisible();
    await expect(page.getByText('功能开发')).toBeVisible();
    await expect(page.getByText('完整规划')).toBeVisible();
    await expect(page.getByText('PRD 导入')).toBeVisible();
    // Confirm button is disabled until a card is selected
    await expect(page.getByRole('button', { name: '请选择一个模式' })).toBeDisabled();
  });

  test('无 req/session 参数直接访问显示跳转提示', async ({ page }) => {
    await mockApi(page, []);
    await gotoStage1(page, ''); // no query params
    // Either shows "正在跳转..." text or redirects to /
    const redirectText = page.getByText('正在跳转...');
    const redirectedToHome = async () => {
      try { await page.waitForURL(/\/$/, { timeout: 5_000 }); return true; }
      catch { return false; }
    };
    const homeRedirected = await redirectedToHome();
    if (!homeRedirected) {
      // If URL didn't change, the component should show "正在跳转..."
      await expect(redirectText).toBeVisible({ timeout: 8_000 });
    }
  });

  test('有 req 参数时 stage1 不跳转，停留在 /stage1', async ({ page }) => {
    await mockApi(page, [makeReq()]);
    await gotoStage1(page);
    await expect(page.getByText('需求收集')).toBeVisible({ timeout: 10_000 });
    expect(page.url()).toContain('/stage1');
    expect(page.url()).toContain(`req=${REQ_ID}`);
  });

  test('模式卡片点击后"确认选择"按钮可用', async ({ page }) => {
    await mockApi(page, [makeReq()]);
    await gotoStage1(page);
    await expect(page.getByText('选择开发模式')).toBeVisible({ timeout: 10_000 });

    // Before clicking any card — confirm button disabled
    await expect(page.getByRole('button', { name: '请选择一个模式' })).toBeDisabled();

    // Click a card — button changes to "确认选择" and becomes enabled
    await page.locator('button:has(h3:text-is("功能开发"))').click();
    await expect(page.getByRole('button', { name: '确认选择' })).toBeEnabled({ timeout: 3_000 });
  });
});

// ---------------------------------------------------------------------------
// 2. Mode selection — each of the 4 modes
// ---------------------------------------------------------------------------

test.describe('Stage1 — 模式选择 (2步流程)', () => {
  test('选择"功能开发"→确认→显示"启动 AI 需求整理"按钮', async ({ page }) => {
    await mockApi(page, [makeReq()]);
    await gotoStage1(page);
    // Use 20s here — this test runs in parallel with others sharing the same dev server,
    // so hydration can be slower under load.
    await expect(page.getByText('选择开发模式')).toBeVisible({ timeout: 20_000 });

    await selectMode(page, '功能开发');

    // After confirming, should show the start button (isStarted=false, no questions)
    await expect(page.getByRole('button', { name: '启动 AI 需求整理' })).toBeVisible({ timeout: 5_000 });
    // Pyramid navigation should be visible
    await expect(page.getByText('需求收集')).toBeVisible({ timeout: 5_000 });
  });

  test('选择"完整规划"→确认→显示"启动 AI 需求整理"按钮', async ({ page }) => {
    await mockApi(page, [makeReq()]);
    await gotoStage1(page);
    await expect(page.getByText('选择开发模式')).toBeVisible({ timeout: 10_000 });

    await selectMode(page, '完整规划');

    await expect(page.getByRole('button', { name: '启动 AI 需求整理' })).toBeVisible({ timeout: 5_000 });
  });

  test('选择"快速修复"（有项目名→跳过描述输入）→显示启动按钮', async ({ page }) => {
    // When requirement has a name, initialDescription is set → quick fix skips textarea
    await mockApi(page, [makeReq()]);
    await gotoStage1(page);
    await expect(page.getByText('选择开发模式')).toBeVisible({ timeout: 10_000 });

    await selectMode(page, '快速修复');

    // With initialDescription set from requirement name, shows start button directly
    await expect(page.getByRole('button', { name: '启动 AI 需求整理' })).toBeVisible({ timeout: 5_000 });
  });

  test('选择"快速修复"（无项目名→显示描述输入框）', async ({ page }) => {
    // When requirement has NO name, initialDescription is empty → quick fix shows textarea
    await mockApi(page, [makeReq({ name: '' })]);
    await gotoStage1(page);
    await expect(page.getByText('选择开发模式')).toBeVisible({ timeout: 10_000 });

    await selectMode(page, '快速修复');

    // Without initialDescription, should show the description textarea
    await expect(page.getByText('描述你要修复的问题')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByPlaceholder(/修复登录页面/)).toBeVisible();
  });

  test('选择"PRD 导入"（无项目名→显示文件路径输入框）', async ({ page }) => {
    await mockApi(page, [makeReq({ name: '' })]);
    await gotoStage1(page);
    await expect(page.getByText('选择开发模式')).toBeVisible({ timeout: 10_000 });

    await selectMode(page, 'PRD 导入');

    await expect(page.getByText('输入现有 PRD 文件路径')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByPlaceholder(/tasks\/my-project-prd\.md/)).toBeVisible();
  });

  test('快速修复输入框：空内容时"开始快速修复"按钮禁用，填写后启用', async ({ page }) => {
    await mockApi(page, [makeReq({ name: '' })]);
    await gotoStage1(page);
    await expect(page.getByText('选择开发模式')).toBeVisible({ timeout: 10_000 });

    await selectMode(page, '快速修复');
    await expect(page.getByPlaceholder(/修复登录页面/)).toBeVisible({ timeout: 5_000 });

    const startBtn = page.getByRole('button', { name: '开始快速修复' });
    await expect(startBtn).toBeDisabled();

    await page.getByPlaceholder(/修复登录页面/).fill('修复登录按钮在移动端溢出问题');
    await expect(startBtn).toBeEnabled();
  });

  test('"返回选择"按钮（快速修复描述页）回到模式选择', async ({ page }) => {
    await mockApi(page, [makeReq({ name: '' })]);
    await gotoStage1(page);
    await expect(page.getByText('选择开发模式')).toBeVisible({ timeout: 10_000 });

    await selectMode(page, '快速修复');
    await expect(page.getByText('描述你要修复的问题')).toBeVisible({ timeout: 5_000 });

    await page.getByRole('button', { name: '返回选择' }).click();
    await expect(page.getByText('选择开发模式')).toBeVisible({ timeout: 5_000 });
  });

  test('"返回选择"按钮（PRD 导入路径页）回到模式选择', async ({ page }) => {
    await mockApi(page, [makeReq({ name: '' })]);
    await gotoStage1(page);
    await expect(page.getByText('选择开发模式')).toBeVisible({ timeout: 10_000 });

    await selectMode(page, 'PRD 导入');
    await expect(page.getByText('输入现有 PRD 文件路径')).toBeVisible({ timeout: 5_000 });

    await page.getByRole('button', { name: '返回选择' }).click();
    await expect(page.getByText('选择开发模式')).toBeVisible({ timeout: 5_000 });
  });

  test('"返回选择模式"链接（启动前）回到模式选择', async ({ page }) => {
    await mockApi(page, [makeReq()]);
    await gotoStage1(page);
    await expect(page.getByText('选择开发模式')).toBeVisible({ timeout: 10_000 });

    await selectMode(page, '功能开发');
    await expect(page.getByRole('button', { name: '启动 AI 需求整理' })).toBeVisible({ timeout: 5_000 });

    // Click the "返回选择模式" link
    await page.getByText('返回选择模式').click();
    await expect(page.getByText('选择开发模式')).toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// 3. Progress restoration — core fix validation
// ---------------------------------------------------------------------------

test.describe('Stage1 — 进度恢复 (reqId-based storageKey)', () => {
  test('页面重载后恢复 feature 模式的进行中状态（不显示模式选择）', async ({ page }) => {
    // Seed Stage1 state using the NEW reqId-based key
    await seedStage1State(page, {
      selectedMode: 'feature',
      isStarted: true,
      cliSessionId: 'fake-session-abc123',
      currentLevel: 2,
      completedLevels: [1],
      answers: {},
      qaHistory: [
        { level: 1, question: '主要功能是什么？', answer: '用户管理' },
        { level: 1, question: '目标用户？', answer: '企业用户' },
      ],
      prdDraft: '',
      codebaseScanned: false,
      isConfirmationPhase: false,
      confirmationSummary: null,
      writtenPrdFileId: null,
      savedAt: new Date().toISOString(),
    });

    await mockApi(page, [makeReq()]); // API does NOT return prdSessionId
    await gotoStage1(page);

    // Should NOT show mode selector — state restored from reqId-based key
    await expect(page.getByText('选择开发模式')).not.toBeVisible({ timeout: 8_000 });
    // Pyramid navigation should be visible
    await expect(page.getByText('需求收集')).toBeVisible({ timeout: 8_000 });
    // Should show "继续需求整理" button (isStarted=true, no questions from stream yet)
    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 5_000 });
  });

  test('页面重载后恢复 full 模式（完整规划）进行中状态', async ({ page }) => {
    await seedStage1State(page, {
      selectedMode: 'full',
      isStarted: true,
      cliSessionId: 'fake-session-xyz789',
      currentLevel: 3,
      completedLevels: [1, 2],
      answers: {},
      qaHistory: Array.from({ length: 8 }, (_, i) => ({
        level: Math.ceil((i + 1) / 2) as 1 | 2 | 3 | 4 | 5,
        question: `问题 ${i + 1}`,
        answer: `答案 ${i + 1}`,
      })),
      prdDraft: '',
      codebaseScanned: true,
      isConfirmationPhase: false,
      confirmationSummary: null,
      writtenPrdFileId: null,
      savedAt: new Date().toISOString(),
    });

    await mockApi(page, [makeReq()]);
    await gotoStage1(page);

    await expect(page.getByText('选择开发模式')).not.toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('需求收集')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 5_000 });
  });

  test('API 覆盖 prdSessionId 后，仍能通过 reqId key 恢复状态（原 bug 场景）', async ({ page }) => {
    // Simulate the original bug: local has prdSessionId, API overwrites without it
    await seedRequirements(page, [{ ...makeReq(), prdSessionId: 'old-session-id' }]);

    await seedStage1State(page, {
      selectedMode: 'feature',
      isStarted: true,
      cliSessionId: 'old-session-id',
      currentLevel: 2,
      completedLevels: [1],
      answers: {},
      qaHistory: [{ level: 1, question: 'Q1', answer: 'A1' }],
      prdDraft: '',
      codebaseScanned: false,
      isConfirmationPhase: false,
      confirmationSummary: null,
      writtenPrdFileId: null,
      savedAt: new Date().toISOString(),
    });

    // API returns WITHOUT prdSessionId — old bug would make storageKey null
    await mockApi(page, [makeReq({ prdSessionId: undefined })]);
    await gotoStage1(page);

    // FIX: reqId-based key survives the API overwrite
    await expect(page.getByText('选择开发模式')).not.toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('需求收集')).toBeVisible({ timeout: 8_000 });
  });

  test('有 PRD 草稿时恢复后显示"PRD 已生成"而非模式选择', async ({ page }) => {
    const fakePrd = `# PRD: E2E Test Project\n\n## 1. 项目概述\n测试内容\n\n## 2. 功能需求\n- 功能 A`;

    await seedStage1State(page, {
      selectedMode: 'full',
      isStarted: true,
      cliSessionId: 'session-with-prd',
      currentLevel: 5,
      completedLevels: [1, 2, 3, 4, 5],
      answers: {},
      qaHistory: [],
      prdDraft: fakePrd,
      codebaseScanned: true,
      isConfirmationPhase: false,
      confirmationSummary: null,
      writtenPrdFileId: null,
      savedAt: new Date().toISOString(),
    });

    await mockApi(page, [makeReq()]);
    await gotoStage1(page);

    // Should show PRD generated UI
    await expect(page.getByText('选择开发模式')).not.toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('PRD 已生成')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole('button', { name: '保存 PRD 并继续' })).toBeVisible({ timeout: 5_000 });
  });

  test('无保存状态时始终显示模式选择', async ({ page }) => {
    // No localStorage seeded — fresh start
    await mockApi(page, [makeReq()]);
    await gotoStage1(page);

    await expect(page.getByText('选择开发模式')).toBeVisible({ timeout: 10_000 });
  });

  test('不同项目的 key 互不干扰（隔离性验证）', async ({ page }) => {
    const OTHER_REQ_ID = 'other-project-abc';

    // Seed state for a DIFFERENT project only
    await page.addInitScript(
      ({ key, value }: { key: string; value: unknown }) => {
        localStorage.setItem(key, JSON.stringify(value));
      },
      {
        key: `botool-pyramid-state-req-${OTHER_REQ_ID}`,
        value: {
          selectedMode: 'full',
          isStarted: true,
          cliSessionId: 'other-session',
          currentLevel: 2,
          completedLevels: [1],
          answers: {},
          qaHistory: [],
          prdDraft: '',
          codebaseScanned: false,
          isConfirmationPhase: false,
          confirmationSummary: null,
          writtenPrdFileId: null,
        },
      },
    );

    await mockApi(page, [makeReq()]);
    // Access REQ_ID page (no state for REQ_ID)
    await gotoStage1(page);

    // Should show mode selector (other project's state doesn't bleed over)
    await expect(page.getByText('选择开发模式')).toBeVisible({ timeout: 8_000 });
  });
});

// ---------------------------------------------------------------------------
// 4. RequirementContext — prdSessionId preservation
// ---------------------------------------------------------------------------

test.describe('RequirementContext — prdSessionId 在 API 覆盖后保留', () => {
  test('API 返回的数据不含 prdSessionId 时，本地 prdSessionId 被保留', async ({ page }) => {
    // Seed requirements with prdSessionId
    await seedRequirements(page, [
      { ...makeReq(), prdSessionId: 'preserved-session-id-xyz' },
    ]);

    // API returns same requirement WITHOUT prdSessionId
    await mockApi(page, [makeReq({ prdSessionId: undefined })]);
    await gotoStage1(page);

    // Wait for API fetch + RequirementContext state update
    await page.waitForTimeout(3_000);

    const storedReqs = await page.evaluate((key: string) => {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    }, REQUIREMENTS_KEY);

    expect(storedReqs).not.toBeNull();
    const reqEntry = (storedReqs as Record<string, MockRequirement>)[REQ_ID];
    expect(reqEntry).toBeDefined();
    // The fix: mergeRequirements preserves local prdSessionId
    expect(reqEntry.prdSessionId).toBe('preserved-session-id-xyz');
  });

  test('没有本地 prdSessionId 时，正常合并 API 数据', async ({ page }) => {
    // Local entry has NO prdSessionId
    await seedRequirements(page, [makeReq()]);

    // API returns without prdSessionId either
    await mockApi(page, [makeReq()]);
    await gotoStage1(page);
    await page.waitForTimeout(2_000);

    const storedReqs = await page.evaluate((key: string) => {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    }, REQUIREMENTS_KEY);

    // prdSessionId should be undefined (not set)
    const reqEntry = (storedReqs as Record<string, MockRequirement> | null)?.[REQ_ID];
    expect(reqEntry?.prdSessionId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. State persistence — saved to correct localStorage key
// ---------------------------------------------------------------------------

test.describe('Stage1 — 状态持久化', () => {
  test('选择功能开发并点击启动后，状态保存到 reqId-based key', async ({ page }) => {
    await mockApi(page, [makeReq()]);
    await gotoStage1(page);
    await expect(page.getByText('选择开发模式')).toBeVisible({ timeout: 10_000 });

    // 2-step mode selection
    await selectMode(page, '功能开发');
    await expect(page.getByRole('button', { name: '启动 AI 需求整理' })).toBeVisible({ timeout: 5_000 });

    // Click start → triggers startPyramid, sets isStarted=true, kicks off CLI chat
    await page.getByRole('button', { name: '启动 AI 需求整理' }).click();

    // Wait for state save debounce (500ms) + buffer
    await page.waitForTimeout(1_500);

    const savedState = await page.evaluate((key: string) => {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    }, STAGE1_STATE_KEY);

    expect(savedState).not.toBeNull();
    expect(savedState.selectedMode).toBe('feature');
    expect(savedState.isStarted).toBe(true);
  });

  test('快速修复提交描述后，状态保存到 reqId-based key', async ({ page }) => {
    await mockApi(page, [makeReq({ name: '' })]);
    await gotoStage1(page);
    await expect(page.getByText('选择开发模式')).toBeVisible({ timeout: 10_000 });

    await selectMode(page, '快速修复');
    await expect(page.getByPlaceholder(/修复登录页面/)).toBeVisible({ timeout: 5_000 });

    await page.getByPlaceholder(/修复登录页面/).fill('修复移动端布局溢出');
    await page.getByRole('button', { name: '开始快速修复' }).click();

    await page.waitForTimeout(1_500);

    const savedState = await page.evaluate((key: string) => {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    }, STAGE1_STATE_KEY);

    expect(savedState).not.toBeNull();
    expect(savedState.selectedMode).toBe('quick');
    expect(savedState.isStarted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. UI structure & regression checks
// ---------------------------------------------------------------------------

test.describe('Stage1 — UI 结构校验', () => {
  test('Stage 指示器"需求收集"始终可见', async ({ page }) => {
    await mockApi(page, [makeReq()]);
    await gotoStage1(page);
    await expect(page.getByText('需求收集')).toBeVisible({ timeout: 10_000 });
  });

  test('不显示运行时报错', async ({ page }) => {
    await mockApi(page, [makeReq()]);
    await gotoStage1(page);
    await expect(page.getByText('选择开发模式')).toBeVisible({ timeout: 10_000 });
    // No JS error dialogs
    await expect(page.getByText(/Unhandled Runtime Error/i)).not.toBeVisible({ timeout: 3_000 });
  });

  test('恢复状态后"当前层级"信息显示在进度上', async ({ page }) => {
    await seedStage1State(page, {
      selectedMode: 'full',
      isStarted: true,
      cliSessionId: 'sess-level-3',
      currentLevel: 3,
      completedLevels: [1, 2],
      answers: {},
      qaHistory: [],
      prdDraft: '',
      codebaseScanned: false,
      isConfirmationPhase: false,
      confirmationSummary: null,
      writtenPrdFileId: null,
      savedAt: new Date().toISOString(),
    });

    await mockApi(page, [makeReq()]);
    await gotoStage1(page);

    // The "继续需求整理" area shows progress info (L3, 2 layers done)
    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 8_000 });
    // "上次进度：L3 · 已完成 2 层" text appears in the resume area
    await expect(page.getByText(/上次进度.*L3/)).toBeVisible({ timeout: 5_000 });
  });
});
