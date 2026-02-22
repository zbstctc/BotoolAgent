/**
 * Multi-Tab & Concurrent Stress Tests
 *
 * Tests multi-tab state isolation, concurrent browser pages (shared localStorage),
 * and regression prevention for the infinite-loop bugs fixed in Stage1Content /
 * StageTransitionModal.
 *
 * Groups:
 *   A. State Isolation     — two requirements open sequentially, no state bleed
 *   B. Regression          — prdSessionId sync does NOT cause infinite loops
 *   C. Concurrent Pages    — two Playwright pages sharing the same localStorage
 *   D. Multi-req Context   — 5–10 requirements in context, correct one shown
 *   E. Q&A Concurrency     — multiple active questions across requirements
 *
 * Design notes:
 *   - Requirement IDs MUST be UUID-format for isValidReqId() to pass and the
 *     TabPanelManager URL bootstrap to open a project tab (which makes Stage1Content visible).
 *   - We do NOT seed REQUIREMENTS_KEY in localStorage because that key is workspace-scoped
 *     (botool-{workspaceId}-requirements-v1) and our seed would use the wrong key.
 *     Requirements come from API mocks only.
 */

import { test, expect, type Page, type Route } from '@playwright/test';

test.setTimeout(60_000);

// ---------------------------------------------------------------------------
// Constants — UUID-format IDs required for isValidReqId() and TabPanelManager
// ---------------------------------------------------------------------------

const REQ_A = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const REQ_B = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const REQ_C = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';

function stateKey(reqId: string) {
  return `botool-pyramid-state-req-${reqId}`;
}

// ---------------------------------------------------------------------------
// Types & state builders
// ---------------------------------------------------------------------------

interface MockReq {
  id: string;
  name: string;
  stage: number;
  status: string;
  createdAt: number;
  updatedAt: number;
  prdSessionId?: string;
}

function makeReq(id: string, overrides: Partial<MockReq> = {}): MockReq {
  return {
    id,
    name: `Multi-Tab Test ${id.substring(0, 8)}`,
    stage: 1,
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeState(reqId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    selectedMode: 'feature',
    isStarted: true,
    cliSessionId: `session-${reqId.substring(0, 8)}`,
    currentLevel: 2,
    completedLevels: [1],
    answers: {},
    qaHistory: [
      { level: 1, question: `${reqId.substring(0, 8)} 的需求问题`, answer: `${reqId.substring(0, 8)} 的答案` },
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

function sseDone(sessionId = 'new-session') {
  return (
    `data: ${JSON.stringify({ type: 'session', sessionId })}\n\n` +
    `data: ${JSON.stringify({ type: 'done' })}\n\n`
  );
}

function sseQuestion(
  questions: Array<{ question: string; options?: Array<{ label: string }> }>,
  level = 1,
) {
  const toolInput = {
    questions,
    metadata: { source: 'pyramidprd', level, levelName: '核心识别', progress: `${level}/5`, totalLevels: 5 },
  };
  return (
    `data: ${JSON.stringify({ type: 'session', sessionId: 'q-session-concurrent' })}\n\n` +
    `data: ${JSON.stringify({ type: 'tool_use', toolId: 'tool-1', toolName: 'AskUserQuestion', toolInput })}\n\n`
  );
}

function sseError(msg: string) {
  return (
    `data: ${JSON.stringify({ type: 'error', error: msg })}\n\n` +
    `data: ${JSON.stringify({ type: 'done' })}\n\n`
  );
}

// ---------------------------------------------------------------------------
// Mock helpers (single page)
// ---------------------------------------------------------------------------

async function mockApis(page: Page, reqs: MockReq[], cliBody = '') {
  await page.route('**/api/requirements', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: reqs }),
    });
  });
  await page.route('**/api/cli/health', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await page.route('**/api/cli/chat', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'text/event-stream',
      headers: { 'Cache-Control': 'no-cache' }, body: cliBody,
    });
  });
  await page.route('**/api/cli/respond', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'text/event-stream',
      headers: { 'Cache-Control': 'no-cache' }, body: sseDone(),
    });
  });
  await page.route('**/api/claude-processes', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ processes: [], totalMemoryMb: 0, totalCount: 0, timestamp: Date.now() }),
    });
  });
  await page.route('**/api/**', async (route: Route) => {
    const u = route.request().url();
    if (u.includes('/api/requirements') || u.includes('/api/cli/') || u.includes('/api/claude-processes')) {
      await route.fallback();
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function seedLS(page: Page, data: Record<string, unknown>) {
  await page.addInitScript(
    (items: Record<string, string>) => {
      for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v);
    },
    Object.fromEntries(Object.entries(data).map(([k, v]) => [k, JSON.stringify(v)])),
  );
}

async function readLS(page: Page, key: string): Promise<unknown> {
  return page.evaluate(
    (k: string) => { const r = localStorage.getItem(k); return r ? JSON.parse(r) : null; },
    key,
  );
}

// ---------------------------------------------------------------------------
// A. State Isolation — sequential navigation, no state bleed
// ---------------------------------------------------------------------------

test.describe('A. 状态隔离', () => {
  test('A1: req-A 和 req-B 各自恢复独立的 Stage1 状态', async ({ page }) => {
    const reqA = makeReq(REQ_A);
    const reqB = makeReq(REQ_B);

    await seedLS(page, {
      [stateKey(REQ_A)]: makeState(REQ_A, { currentLevel: 3, completedLevels: [1, 2] }),
      [stateKey(REQ_B)]: makeState(REQ_B, { currentLevel: 1, completedLevels: [] }),
    });
    await mockApis(page, [reqA, reqB]);

    await page.goto(`/stage1?req=${REQ_A}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });

    await page.goto(`/stage1?req=${REQ_B}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });
  });

  test('A2: req-A 的 cliSessionId 不写入 req-B 的 localStorage key', async ({ page }) => {
    const reqA = makeReq(REQ_A);
    const reqB = makeReq(REQ_B);

    await seedLS(page, {
      [stateKey(REQ_A)]: makeState(REQ_A, { cliSessionId: 'session-A-unique' }),
      // No state for REQ_B
    });
    await mockApis(page, [reqA, reqB]);

    await page.goto(`/stage1?req=${REQ_A}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });

    await page.goto(`/stage1?req=${REQ_B}`, { waitUntil: 'domcontentloaded' });
    // req-B has no state → shows mode selector
    // Use getByRole (ARIA-aware) to avoid strict-mode violation caused by the hidden
    // Next.js children div also rendering the same h2 when isManagedRoute=true.
    await expect(page.getByRole('heading', { name: '选择开发模式' })).toBeVisible({ timeout: 15_000 });

    const reqBState = await readLS(page, stateKey(REQ_B)) as Record<string, unknown> | null;
    if (reqBState !== null) {
      expect(reqBState.cliSessionId).not.toBe('session-A-unique');
    }
  });

  test('A3: req-A 的 qaHistory 内容不出现在 req-B 页面', async ({ page }) => {
    const reqA = makeReq(REQ_A);
    const reqB = makeReq(REQ_B);

    await seedLS(page, {
      [stateKey(REQ_A)]: makeState(REQ_A, {
        qaHistory: [{ level: 1, question: '独特标识问题XYZ9999', answer: '独特答案ABC8888' }],
      }),
      [stateKey(REQ_B)]: makeState(REQ_B, { qaHistory: [] }),
    });
    await mockApis(page, [reqA, reqB]);

    await page.goto(`/stage1?req=${REQ_B}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // req-A's unique content must NOT appear on req-B's page
    await expect(page.getByText('独特标识问题XYZ9999')).not.toBeVisible({ timeout: 3_000 });
    await expect(page.getByText('独特答案ABC8888')).not.toBeVisible({ timeout: 3_000 });
  });

  test('A4: req-A 有完整 prdDraft，req-B 进行中 — 各自显示正确 UI', async ({ page }) => {
    const reqA = makeReq(REQ_A);
    const reqB = makeReq(REQ_B);

    await seedLS(page, {
      [stateKey(REQ_A)]: makeState(REQ_A, {
        prdDraft: '# PRD for req-A\n\n## Overview\nThis is req-A PRD.',
        completedLevels: [1, 2, 3, 4, 5],
        currentLevel: 5,
        writtenPrdFileId: 'prd-req-a.md',
      }),
      [stateKey(REQ_B)]: makeState(REQ_B, {
        prdDraft: '',
        completedLevels: [1],
        currentLevel: 2,
      }),
    });
    await mockApis(page, [reqA, reqB]);

    // req-A: PRD already generated
    // Use getByRole (ARIA-aware) to avoid strict-mode violation: both StageRouter panel
    // and hidden Next.js children div render the same h2 when isManagedRoute=true.
    await page.goto(`/stage1?req=${REQ_A}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'PRD 已生成' })).toBeVisible({ timeout: 15_000 });

    // req-B: mid-session resume prompt
    await page.goto(`/stage1?req=${REQ_B}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'PRD 已生成' })).not.toBeVisible({ timeout: 3_000 });
  });

  test('A5: 快速来回切换 req-A 和 req-B 各 4 次 — 状态保持正确', async ({ page }) => {
    const reqA = makeReq(REQ_A);
    const reqB = makeReq(REQ_B);

    await seedLS(page, {
      [stateKey(REQ_A)]: makeState(REQ_A, { currentLevel: 3, completedLevels: [1, 2] }),
      [stateKey(REQ_B)]: makeState(REQ_B, { currentLevel: 2, completedLevels: [1] }),
    });
    await mockApis(page, [reqA, reqB]);

    for (let i = 0; i < 4; i++) {
      await page.goto(`/stage1?req=${REQ_A}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });

      await page.goto(`/stage1?req=${REQ_B}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });
    }

    // Verify localStorage integrity after 8 navigations
    const stateA = await readLS(page, stateKey(REQ_A)) as Record<string, unknown>;
    expect(stateA?.cliSessionId).toBe(`session-${REQ_A.substring(0, 8)}`);

    const stateB = await readLS(page, stateKey(REQ_B)) as Record<string, unknown>;
    expect(stateB?.cliSessionId).toBe(`session-${REQ_B.substring(0, 8)}`);
  });
});

// ---------------------------------------------------------------------------
// B. Regression — prdSessionId sync infinite loop fix
// ---------------------------------------------------------------------------

test.describe('B. 回归测试 — prdSessionId 同步不引发无限循环', () => {
  test('B1: 恢复含 cliSessionId 的状态 — 不出现 Maximum update depth exceeded', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    // API returns req WITHOUT prdSessionId (simulates mismatch scenario)
    const req = makeReq(REQ_A, { prdSessionId: undefined });
    await seedLS(page, {
      [stateKey(REQ_A)]: makeState(REQ_A, { cliSessionId: 'session-to-sync-regression' }),
    });
    await mockApis(page, [req]);

    await page.goto(`/stage1?req=${REQ_A}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });

    // Let any potential infinite loop manifest
    await page.waitForTimeout(2500);

    const loopErrors = errors.filter(e => e.includes('Maximum update depth exceeded'));
    expect(loopErrors).toHaveLength(0);
  });

  test('B2: API 有旧 prdSessionId，localStorage 有新 cliSessionId — 正确同步且不循环', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    // API returns req with old prdSessionId
    const req = makeReq(REQ_A, { prdSessionId: 'old-session-id' });
    await seedLS(page, {
      // localStorage has NEWER cliSessionId
      [stateKey(REQ_A)]: makeState(REQ_A, { cliSessionId: 'new-session-xyz' }),
    });
    await mockApis(page, [req]);

    await page.goto(`/stage1?req=${REQ_A}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(2000);

    // No infinite loops
    const loopErrors = errors.filter(e => e.includes('Maximum update depth exceeded'));
    expect(loopErrors).toHaveLength(0);
  });

  test('B3: 连续快速导航两个需求各 3 次 — 全程无 React 错误', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    const reqA = makeReq(REQ_A, { prdSessionId: undefined });
    const reqB = makeReq(REQ_B, { prdSessionId: undefined });

    await seedLS(page, {
      [stateKey(REQ_A)]: makeState(REQ_A, { cliSessionId: 'sess-A' }),
      [stateKey(REQ_B)]: makeState(REQ_B, { cliSessionId: 'sess-B' }),
    });
    await mockApis(page, [reqA, reqB]);

    for (let i = 0; i < 3; i++) {
      await page.goto(`/stage1?req=${REQ_A}`, { waitUntil: 'domcontentloaded' });
      await page.goto(`/stage1?req=${REQ_B}`, { waitUntil: 'domcontentloaded' });
    }

    await page.waitForTimeout(1000);

    const reactErrors = errors.filter(e =>
      e.includes('Maximum update depth exceeded') ||
      e.includes('Cannot update a component') ||
      e.includes('Too many re-renders'),
    );
    expect(reactErrors).toHaveLength(0);
  });

  test('B4: StageTransitionModal autoCountdown 变化不触发无限循环', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    // Navigate to stage3 which renders StageTransitionModal
    const req = makeReq(REQ_A, { stage: 3 });

    await page.route('**/api/requirements', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [req] }) });
    });
    await page.route('**/api/cli/health', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });
    await page.route('**/api/agent-status**', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ status: 'idle', completed: 0, total: 0, isRunning: false, isComplete: false, hasError: false }),
      });
    });
    await page.route('**/api/prd**', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) });
    });
    await page.route('**/api/claude-processes', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ processes: [], totalMemoryMb: 0, totalCount: 0, timestamp: Date.now() }) });
    });
    await page.route('**/api/**', async (route: Route) => {
      if (route.request().url().includes('/api/requirements') || route.request().url().includes('/api/agent-status') || route.request().url().includes('/api/prd') || route.request().url().includes('/api/claude-processes')) {
        await route.fallback();
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto(`/stage3?req=${REQ_A}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const loopErrors = errors.filter(e => e.includes('Maximum update depth exceeded'));
    expect(loopErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// C. Concurrent Browser Pages — true multi-tab (shared localStorage)
// ---------------------------------------------------------------------------

test.describe('C. 并发浏览器标签页', () => {
  test('C1: 两个浏览器页面同时加载不同需求的 Stage1', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: `http://localhost:${process.env.TEST_PORT ?? '3200'}` });
    try {
      const reqA = makeReq(REQ_A);
      const reqB = makeReq(REQ_B);

      await context.addInitScript(
        (items: Record<string, string>) => { for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v); },
        {
          [stateKey(REQ_A)]: JSON.stringify(makeState(REQ_A)),
          [stateKey(REQ_B)]: JSON.stringify(makeState(REQ_B)),
        },
      );
      await context.route('**/api/requirements', async route => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [reqA, reqB] }) });
      });
      await context.route('**/api/cli/health', async route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
      await context.route('**/api/cli/chat', async route => route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }));
      await context.route('**/api/claude-processes', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ processes: [], totalMemoryMb: 0, totalCount: 0, timestamp: Date.now() }) }));
      await context.route('**/api/**', async route => {
        const u = route.request().url();
        if (u.includes('/api/requirements') || u.includes('/api/cli/') || u.includes('/api/claude-processes')) {
          await route.fallback(); return;
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      });

      const page1 = await context.newPage();
      const page2 = await context.newPage();

      await Promise.all([
        page1.goto(`/stage1?req=${REQ_A}`, { waitUntil: 'domcontentloaded' }),
        page2.goto(`/stage1?req=${REQ_B}`, { waitUntil: 'domcontentloaded' }),
      ]);

      await Promise.all([
        expect(page1.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 20_000 }),
        expect(page2.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 20_000 }),
      ]);
    } finally {
      await context.close();
    }
  });

  test('C2: 页面 1 写入 localStorage → 页面 2 新导航时能读到', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: `http://localhost:${process.env.TEST_PORT ?? '3200'}` });
    try {
      const reqA = makeReq(REQ_A);
      const reqB = makeReq(REQ_B);

      await context.route('**/api/requirements', async route => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [reqA, reqB] }) });
      });
      await context.route('**/api/cli/health', async route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
      await context.route('**/api/cli/chat', async route => route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }));
      await context.route('**/api/claude-processes', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ processes: [], totalMemoryMb: 0, totalCount: 0, timestamp: Date.now() }) }));
      await context.route('**/api/**', async route => {
        const u = route.request().url();
        if (u.includes('/api/requirements') || u.includes('/api/cli/') || u.includes('/api/claude-processes')) {
          await route.fallback(); return;
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      });

      const page1 = await context.newPage();
      const page2 = await context.newPage();

      // page1 loads req-A (no saved state → mode selector)
      await page1.goto(`/stage1?req=${REQ_A}`, { waitUntil: 'domcontentloaded' });
      await expect(page1.getByRole('heading', { name: '选择开发模式' })).toBeVisible({ timeout: 20_000 });

      // page1 writes req-B state to shared localStorage
      await page1.evaluate(
        ({ k, v }: { k: string; v: string }) => localStorage.setItem(k, v),
        { k: stateKey(REQ_B), v: JSON.stringify(makeState(REQ_B, { cliSessionId: 'cross-tab-session' })) },
      );

      // page2 navigates to req-B — should pick up state page1 wrote
      await page2.goto(`/stage1?req=${REQ_B}`, { waitUntil: 'domcontentloaded' });
      await expect(page2.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 20_000 });

      const stateBOnPage2 = await page2.evaluate(
        (k: string) => { const r = localStorage.getItem(k); return r ? JSON.parse(r) : null; },
        stateKey(REQ_B),
      ) as Record<string, unknown>;
      expect(stateBOnPage2?.cliSessionId).toBe('cross-tab-session');
    } finally {
      await context.close();
    }
  });

  test('C3: 同一需求在两个页面同时打开 — 无状态冲突无循环', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: `http://localhost:${process.env.TEST_PORT ?? '3200'}` });
    try {
      const errors1: string[] = [];
      const errors2: string[] = [];
      const req = makeReq(REQ_A);
      const sharedState = makeState(REQ_A, { currentLevel: 3, completedLevels: [1, 2] });

      await context.addInitScript(
        (items: Record<string, string>) => { for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v); },
        {
          [stateKey(REQ_A)]: JSON.stringify(sharedState),
        },
      );
      await context.route('**/api/requirements', async route => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [req] }) });
      });
      await context.route('**/api/cli/health', async route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
      await context.route('**/api/cli/chat', async route => route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }));
      await context.route('**/api/claude-processes', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ processes: [], totalMemoryMb: 0, totalCount: 0, timestamp: Date.now() }) }));
      await context.route('**/api/**', async route => {
        const u = route.request().url();
        if (u.includes('/api/requirements') || u.includes('/api/cli/') || u.includes('/api/claude-processes')) {
          await route.fallback(); return;
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      });

      const [page1, page2] = await Promise.all([context.newPage(), context.newPage()]);

      page1.on('console', msg => { if (msg.type() === 'error') errors1.push(msg.text()); });
      page1.on('pageerror', err => errors1.push(err.message));
      page2.on('console', msg => { if (msg.type() === 'error') errors2.push(msg.text()); });
      page2.on('pageerror', err => errors2.push(err.message));

      await Promise.all([
        page1.goto(`/stage1?req=${REQ_A}`, { waitUntil: 'domcontentloaded' }),
        page2.goto(`/stage1?req=${REQ_A}`, { waitUntil: 'domcontentloaded' }),
      ]);
      await Promise.all([
        expect(page1.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 20_000 }),
        expect(page2.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 20_000 }),
      ]);

      await page1.waitForTimeout(2000);

      const loopErrors = [
        ...errors1.filter(e => e.includes('Maximum update depth exceeded')),
        ...errors2.filter(e => e.includes('Maximum update depth exceeded')),
      ];
      expect(loopErrors).toHaveLength(0);
    } finally {
      await context.close();
    }
  });

  test('C4: 两个页面各自 "继续需求整理" 并收到问题 — 独立工作', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: `http://localhost:${process.env.TEST_PORT ?? '3200'}` });
    try {
      const reqA = makeReq(REQ_A);
      const reqB = makeReq(REQ_B);
      const questionBody = sseQuestion([
        { question: '您的核心需求是什么？', options: [{ label: '效率提升' }, { label: '用户体验' }] },
      ], 1);

      await context.addInitScript(
        (items: Record<string, string>) => { for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v); },
        {
          [stateKey(REQ_A)]: JSON.stringify(makeState(REQ_A)),
          [stateKey(REQ_B)]: JSON.stringify(makeState(REQ_B)),
        },
      );
      await context.route('**/api/requirements', async route => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [reqA, reqB] }) });
      });
      await context.route('**/api/cli/health', async route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
      await context.route('**/api/cli/chat', async route => {
        await route.fulfill({ status: 200, contentType: 'text/event-stream', body: questionBody });
      });
      await context.route('**/api/cli/respond', async route => route.fulfill({ status: 200, contentType: 'text/event-stream', body: sseDone() }));
      await context.route('**/api/claude-processes', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ processes: [], totalMemoryMb: 0, totalCount: 0, timestamp: Date.now() }) }));
      await context.route('**/api/**', async route => {
        const u = route.request().url();
        if (u.includes('/api/requirements') || u.includes('/api/cli/') || u.includes('/api/claude-processes')) {
          await route.fallback(); return;
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      });

      const page1 = await context.newPage();
      const page2 = await context.newPage();

      await Promise.all([
        page1.goto(`/stage1?req=${REQ_A}`, { waitUntil: 'domcontentloaded' }),
        page2.goto(`/stage1?req=${REQ_B}`, { waitUntil: 'domcontentloaded' }),
      ]);
      await Promise.all([
        expect(page1.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 20_000 }),
        expect(page2.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 20_000 }),
      ]);

      // Both click "继续需求整理" concurrently
      await Promise.all([
        page1.getByRole('button', { name: '继续需求整理' }).click(),
        page2.getByRole('button', { name: '继续需求整理' }).click(),
      ]);

      // Both receive questions independently
      await Promise.all([
        expect(page1.getByText('您的核心需求是什么？')).toBeVisible({ timeout: 20_000 }),
        expect(page2.getByText('您的核心需求是什么？')).toBeVisible({ timeout: 20_000 }),
      ]);
    } finally {
      await context.close();
    }
  });

  test('C5: 页面 1 CLI 错误 — 页面 2 相同需求不受影响', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: `http://localhost:${process.env.TEST_PORT ?? '3200'}` });
    try {
      const req = makeReq(REQ_A);
      let callCount = 0;

      await context.addInitScript(
        (items: Record<string, string>) => { for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v); },
        {
          [stateKey(REQ_A)]: JSON.stringify(makeState(REQ_A)),
        },
      );
      await context.route('**/api/requirements', async route => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [req] }) });
      });
      await context.route('**/api/cli/health', async route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
      await context.route('**/api/cli/chat', async route => {
        callCount++;
        // First call returns error, second returns a question
        const body = callCount === 1
          ? sseError('页面1专属CLI错误')
          : sseQuestion([{ question: '页面2的问题', options: [{ label: '选项一' }] }]);
        await route.fulfill({ status: 200, contentType: 'text/event-stream', body });
      });
      await context.route('**/api/claude-processes', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ processes: [], totalMemoryMb: 0, totalCount: 0, timestamp: Date.now() }) }));
      await context.route('**/api/**', async route => {
        const u = route.request().url();
        if (u.includes('/api/requirements') || u.includes('/api/cli/') || u.includes('/api/claude-processes')) {
          await route.fallback(); return;
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      });

      const page1 = await context.newPage();
      const page2 = await context.newPage();

      await page1.goto(`/stage1?req=${REQ_A}`, { waitUntil: 'domcontentloaded' });
      await expect(page1.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 20_000 });
      await page1.getByRole('button', { name: '继续需求整理' }).click();
      // page1 gets the error
      await expect(page1.getByText('页面1专属CLI错误')).toBeVisible({ timeout: 15_000 });

      // page2 opens same req — gets a question (independent CLI call)
      await page2.goto(`/stage1?req=${REQ_A}`, { waitUntil: 'domcontentloaded' });
      await expect(page2.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 20_000 });
      await page2.getByRole('button', { name: '继续需求整理' }).click();
      await expect(page2.getByText('页面2的问题')).toBeVisible({ timeout: 15_000 });

      // page1 error should not bleed to page2
      await expect(page2.getByText('页面1专属CLI错误')).not.toBeVisible({ timeout: 3_000 });
    } finally {
      await context.close();
    }
  });
});

// ---------------------------------------------------------------------------
// D. Multi-req Context — 5–10 requirements in context
// ---------------------------------------------------------------------------

// UUID-format IDs for bulk requirements (deterministic, passes isValidReqId)
function bulkReqId(i: number): string {
  const hex = i.toString(16).padStart(12, '0');
  return `00000000-0000-4000-0000-${hex}`;
}

test.describe('D. 多需求 Context', () => {
  test('D1: 10 个需求在 Context — 正确恢复目标需求的 Stage1 状态', async ({ page }) => {
    const reqs = Array.from({ length: 10 }, (_, i) => makeReq(bulkReqId(i)));
    const target = reqs[6];

    await seedLS(page, {
      [stateKey(target.id)]: makeState(target.id, {
        currentLevel: 4,
        completedLevels: [1, 2, 3],
        qaHistory: [{ level: 1, question: '目标需求专属问题', answer: '目标专属答案' }],
      }),
    });
    await mockApis(page, reqs);

    await page.goto(`/stage1?req=${target.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 20_000 });

    // Verify other 9 requirements have no saved state
    for (let i = 0; i < 10; i++) {
      if (bulkReqId(i) === target.id) continue;
      const s = await readLS(page, stateKey(bulkReqId(i)));
      expect(s).toBeNull();
    }
  });

  test('D2: 无 prdSessionId 的新需求不触发 prdSessionId sync effect', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    // Fresh requirement: no prdSessionId, no saved state
    const req = makeReq(REQ_A, { prdSessionId: undefined });
    await mockApis(page, [req]);

    await page.goto(`/stage1?req=${REQ_A}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: '选择开发模式' })).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(2000);

    const loopErrors = errors.filter(e => e.includes('Maximum update depth exceeded'));
    expect(loopErrors).toHaveLength(0);
  });

  test('D3: 三个需求同时存在 — 无状态的需求显示模式选择器', async ({ page }) => {
    const reqA = makeReq(REQ_A);
    const reqB = makeReq(REQ_B);
    const reqC = makeReq(REQ_C);

    await seedLS(page, {
      [stateKey(REQ_A)]: makeState(REQ_A),
      [stateKey(REQ_B)]: makeState(REQ_B),
      // REQ_C has no saved state
    });
    await mockApis(page, [reqA, reqB, reqC]);

    await page.goto(`/stage1?req=${REQ_C}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: '选择开发模式' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: '继续需求整理' })).not.toBeVisible({ timeout: 3_000 });
  });

  test('D4: 两个需求顺序完成 PRD — 各自 prdDraft 独立保存不互相覆盖', async ({ page }) => {
    const reqA = makeReq(REQ_A);
    const reqB = makeReq(REQ_B);

    await seedLS(page, {
      [stateKey(REQ_A)]: makeState(REQ_A, {
        prdDraft: '# PRD-A\n专属于A的PRD内容',
        completedLevels: [1, 2, 3, 4, 5],
        writtenPrdFileId: 'prd-a.md',
      }),
      [stateKey(REQ_B)]: makeState(REQ_B, {
        prdDraft: '# PRD-B\n专属于B的PRD内容',
        completedLevels: [1, 2, 3, 4, 5],
        writtenPrdFileId: 'prd-b.md',
      }),
    });
    await mockApis(page, [reqA, reqB]);

    // Use getByRole (ARIA-aware) to avoid strict-mode: StageRouter panel + hidden children
    // both render the same h2 when isManagedRoute=true; ARIA excludes display:none ancestors.
    await page.goto(`/stage1?req=${REQ_A}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'PRD 已生成' })).toBeVisible({ timeout: 15_000 });

    await page.goto(`/stage1?req=${REQ_B}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'PRD 已生成' })).toBeVisible({ timeout: 15_000 });

    // localStorage keys must remain independent
    const stateA = await readLS(page, stateKey(REQ_A)) as Record<string, unknown>;
    const stateB = await readLS(page, stateKey(REQ_B)) as Record<string, unknown>;
    expect(stateA?.writtenPrdFileId).toBe('prd-a.md');
    expect(stateB?.writtenPrdFileId).toBe('prd-b.md');
  });
});

// ---------------------------------------------------------------------------
// E. Q&A Concurrency — multiple active Q&A sessions
// ---------------------------------------------------------------------------

test.describe('E. Q&A 并发交互', () => {
  test('E1: req-A CLI 错误后导航到 req-B — req-B 不继承错误状态', async ({ page }) => {
    const reqA = makeReq(REQ_A);
    const reqB = makeReq(REQ_B);
    let callN = 0;

    await seedLS(page, {
      [stateKey(REQ_A)]: makeState(REQ_A),
      [stateKey(REQ_B)]: makeState(REQ_B),
    });
    await page.route('**/api/requirements', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [reqA, reqB] }) });
    });
    await page.route('**/api/cli/health', async (route: Route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
    await page.route('**/api/cli/chat', async (route: Route) => {
      callN++;
      await route.fulfill({
        status: 200, contentType: 'text/event-stream',
        body: callN === 1 ? sseError('仅 req-A 的 CLI 错误') : '',
      });
    });
    await page.route('**/api/claude-processes', async (route: Route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ processes: [], totalMemoryMb: 0, totalCount: 0, timestamp: Date.now() }) }));
    await page.route('**/api/**', async (route: Route) => {
      if (route.request().url().includes('/api/requirements') || route.request().url().includes('/api/cli/') || route.request().url().includes('/api/claude-processes')) {
        await route.fallback(); return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    // req-A gets CLI error
    await page.goto(`/stage1?req=${REQ_A}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '继续需求整理' }).click();
    await expect(page.getByText('仅 req-A 的 CLI 错误')).toBeVisible({ timeout: 15_000 });

    // Navigate to req-B — error must NOT appear
    await page.goto(`/stage1?req=${REQ_B}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('仅 req-A 的 CLI 错误')).not.toBeVisible({ timeout: 3_000 });
  });

  test('E2: 两个并发页面同时回答问题并提交 — 各自独立完成', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: `http://localhost:${process.env.TEST_PORT ?? '3200'}` });
    try {
      const reqA = makeReq(REQ_A);
      const reqB = makeReq(REQ_B);
      const questionBody = sseQuestion([
        { question: '您最关心的业务目标？', options: [{ label: '降低成本' }, { label: '提升效率' }] },
      ], 1);

      await context.addInitScript(
        (items: Record<string, string>) => { for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v); },
        {
          [stateKey(REQ_A)]: JSON.stringify(makeState(REQ_A)),
          [stateKey(REQ_B)]: JSON.stringify(makeState(REQ_B)),
        },
      );
      await context.route('**/api/requirements', async route => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [reqA, reqB] }) });
      });
      await context.route('**/api/cli/health', async route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
      await context.route('**/api/cli/chat', async route => route.fulfill({ status: 200, contentType: 'text/event-stream', body: questionBody }));
      await context.route('**/api/cli/respond', async route => route.fulfill({ status: 200, contentType: 'text/event-stream', body: sseDone() }));
      await context.route('**/api/claude-processes', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ processes: [], totalMemoryMb: 0, totalCount: 0, timestamp: Date.now() }) }));
      await context.route('**/api/**', async route => {
        const u = route.request().url();
        if (u.includes('/api/requirements') || u.includes('/api/cli/') || u.includes('/api/claude-processes')) {
          await route.fallback(); return;
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      });

      const page1 = await context.newPage();
      const page2 = await context.newPage();

      await Promise.all([
        page1.goto(`/stage1?req=${REQ_A}`, { waitUntil: 'domcontentloaded' }),
        page2.goto(`/stage1?req=${REQ_B}`, { waitUntil: 'domcontentloaded' }),
      ]);
      await Promise.all([
        expect(page1.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 20_000 }),
        expect(page2.getByRole('button', { name: '继续需求整理' })).toBeVisible({ timeout: 20_000 }),
      ]);
      await Promise.all([
        page1.getByRole('button', { name: '继续需求整理' }).click(),
        page2.getByRole('button', { name: '继续需求整理' }).click(),
      ]);
      await Promise.all([
        expect(page1.getByText('您最关心的业务目标？')).toBeVisible({ timeout: 20_000 }),
        expect(page2.getByText('您最关心的业务目标？')).toBeVisible({ timeout: 20_000 }),
      ]);

      // Both select an option concurrently
      await Promise.all([
        page1.getByRole('button', { name: '降低成本' }).click(),
        page2.getByRole('button', { name: '提升效率' }).click(),
      ]);

      // Both submit buttons should be enabled (level 1 → button text is "继续下一层")
      await Promise.all([
        expect(page1.getByRole('button', { name: '继续下一层' })).toBeEnabled({ timeout: 10_000 }),
        expect(page2.getByRole('button', { name: '继续下一层' })).toBeEnabled({ timeout: 10_000 }),
      ]);
    } finally {
      await context.close();
    }
  });

  test('E3: 大量 qaHistory (15条) 在两个需求间切换 — 正确恢复不混淆', async ({ page }) => {
    const reqA = makeReq(REQ_A);
    const reqB = makeReq(REQ_B);
    const bigHistoryA = Array.from({ length: 15 }, (_, i) => ({
      level: Math.min(Math.ceil((i + 1) / 3), 5) as 1 | 2 | 3 | 4 | 5,
      question: `req-A 问题 ${i + 1}`,
      answer: `req-A 答案 ${i + 1}`,
    }));
    const bigHistoryB = Array.from({ length: 15 }, (_, i) => ({
      level: Math.min(Math.ceil((i + 1) / 3), 5) as 1 | 2 | 3 | 4 | 5,
      question: `req-B 问题 ${i + 1}`,
      answer: `req-B 答案 ${i + 1}`,
    }));

    await seedLS(page, {
      [stateKey(REQ_A)]: makeState(REQ_A, {
        qaHistory: bigHistoryA,
        completedLevels: [1, 2, 3, 4, 5],
        prdDraft: '# PRD-A',
        writtenPrdFileId: 'prd-a.md',
      }),
      [stateKey(REQ_B)]: makeState(REQ_B, {
        qaHistory: bigHistoryB,
        completedLevels: [1, 2, 3, 4, 5],
        prdDraft: '# PRD-B',
        writtenPrdFileId: 'prd-b.md',
      }),
    });
    await mockApis(page, [reqA, reqB]);

    // Use getByRole (ARIA-aware) throughout: after each navigation, both the active
    // StageRouter panel AND the hidden Next.js children div render the same h2 —
    // ARIA excludes elements in display:none ancestors, ensuring exactly one match.
    await page.goto(`/stage1?req=${REQ_A}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'PRD 已生成' })).toBeVisible({ timeout: 20_000 });

    // Switch to req-B
    await page.goto(`/stage1?req=${REQ_B}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'PRD 已生成' })).toBeVisible({ timeout: 15_000 });

    // Switch back to req-A
    await page.goto(`/stage1?req=${REQ_A}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'PRD 已生成' })).toBeVisible({ timeout: 15_000 });

    // Verify qaHistory integrity for req-A after multiple navigations
    const savedA = await readLS(page, stateKey(REQ_A)) as Record<string, unknown>;
    expect(Array.isArray(savedA?.qaHistory)).toBe(true);
    expect((savedA.qaHistory as unknown[]).length).toBe(15);
  });
});
