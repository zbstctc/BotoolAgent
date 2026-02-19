import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const RUN_STAGE34 = process.env.BOTOOL_E2E_STAGE34 === '1';
const RUN_STAGE4_FULL = process.env.BOTOOL_E2E_STAGE4_FULL === '1';
const VIEWER_DIR = process.cwd();
const REPO_ROOT = path.resolve(VIEWER_DIR, '..');
const TASKS_DIR = path.join(REPO_ROOT, 'tasks');
const PROJECT_ID = 'e2e-stage34-project';
// Use the new per-project directory format: tasks/{projectId}/prd.json
// Matches getProjectPrdJsonPath(projectId) in lib/project-root.ts
const PROJECT_PRD_FILE = path.join(TASKS_DIR, PROJECT_ID, 'prd.json');
const PROJECT_PROGRESS_FILE = path.join(TASKS_DIR, PROJECT_ID, 'progress.txt');
const TASK_HISTORY_FILE = path.join(TASKS_DIR, '.task-history.json');
// Per-project state files live under tasks/{projectId}/, not .state/
const AGENT_STATUS_FILE = path.join(TASKS_DIR, PROJECT_ID, 'agent-status');
const AGENT_PID_FILE = path.join(TASKS_DIR, PROJECT_ID, 'agent-pid');

const STORAGE_KEY = 'botool-projects';
const TEST_TIMEOUT = 3 * 60 * 1000;

type FileBackup = { exists: boolean; content: string };

const backups = new Map<string, FileBackup>();
let hasPreexistingAgent = false;

function backupFile(filePath: string): void {
  if (fs.existsSync(filePath)) {
    backups.set(filePath, { exists: true, content: fs.readFileSync(filePath, 'utf-8') });
  } else {
    backups.set(filePath, { exists: false, content: '' });
  }
}

function restoreFile(filePath: string): void {
  const backup = backups.get(filePath);
  if (!backup) return;
  if (backup.exists) {
    fs.writeFileSync(filePath, backup.content, 'utf-8');
    return;
  }
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function detectPreexistingAgent(): boolean {
  if (!fs.existsSync(AGENT_PID_FILE)) return false;
  try {
    const content = JSON.parse(fs.readFileSync(AGENT_PID_FILE, 'utf-8')) as { pid?: number };
    return typeof content.pid === 'number' && isPidAlive(content.pid);
  } catch {
    return false;
  }
}

function seedProjectInStorage(page: Page, stage: 3 | 4): Promise<void> {
  const now = Date.now();
  const storageValue = {
    version: 1,
    activeProjectId: PROJECT_ID,
    projects: {
      [PROJECT_ID]: {
        id: PROJECT_ID,
        name: 'Stage34 E2E Project',
        currentStage: stage,
        prdId: PROJECT_ID,
        branchName: 'botool/e2e-stage34-project',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
    },
  };

  return page.addInitScript(
    ({ storageKey, value }) => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem(storageKey, JSON.stringify(value));
    },
    { storageKey: STORAGE_KEY, value: storageValue },
  );
}

async function getAgentStatus(request: APIRequestContext): Promise<string> {
  const response = await request.get(`/api/agent/status?projectId=${PROJECT_ID}`);
  expect(response.ok()).toBeTruthy();
  const data = (await response.json()) as { status?: string };
  return data.status || 'idle';
}

async function waitForNonIdleStatus(request: APIRequestContext, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await getAgentStatus(request);
    if (status !== 'idle') return status;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Agent status remained idle beyond timeout');
}

async function waitForIdleStatus(request: APIRequestContext, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await getAgentStatus(request);
    if (status === 'idle') return status;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Agent status did not return to idle');
}

async function waitForTerminalStatus(request: APIRequestContext, timeoutMs: number): Promise<string> {
  const terminal = new Set(['complete', 'failed', 'error', 'idle', 'timeout', 'max_iterations', 'max_rounds']);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await getAgentStatus(request);
    // Keep long-running test progress visible and avoid silent timeout in CI wrappers.
    console.log(`[stage4full] polled status=${status}`);
    if (terminal.has(status)) return status;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error('Agent status did not reach terminal state before timeout');
}

test.describe('Stage3/Stage4 Agent Integration', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!RUN_STAGE34, 'Set BOTOOL_E2E_STAGE34=1 to run Stage3/4 integration test.');
  test.setTimeout(TEST_TIMEOUT);

  test.beforeAll(() => {
    // Create the per-project subdirectory (new path format: tasks/{projectId}/)
    fs.mkdirSync(path.join(TASKS_DIR, PROJECT_ID), { recursive: true });

    backupFile(PROJECT_PRD_FILE);
    backupFile(PROJECT_PROGRESS_FILE);
    backupFile(TASK_HISTORY_FILE);
    backupFile(AGENT_STATUS_FILE);
    backupFile(AGENT_PID_FILE);

    hasPreexistingAgent = detectPreexistingAgent();

    const prd = {
      project: 'Stage34 E2E Project',
      branchName: 'botool/e2e-stage34-project',
      description: 'Minimal PRD for Stage3/4 integration test',
      devTasks: [],
      sessions: [],
    };

    fs.writeFileSync(PROJECT_PRD_FILE, JSON.stringify(prd, null, 2), 'utf-8');
    fs.writeFileSync(
      PROJECT_PROGRESS_FILE,
      '# Stage34 Test Progress\nStarted: 2026-02-15\n---\n',
      'utf-8',
    );
  });

  test.afterEach(async ({ request }) => {
    if (hasPreexistingAgent) return;
    await request.delete(`/api/agent/status?projectId=${PROJECT_ID}`).catch(() => null);
  });

  test.afterAll(() => {
    restoreFile(PROJECT_PRD_FILE);
    restoreFile(PROJECT_PROGRESS_FILE);
    restoreFile(TASK_HISTORY_FILE);
    restoreFile(AGENT_STATUS_FILE);
    restoreFile(AGENT_PID_FILE);
  });

  test('stage3 can trigger agent start and report status', async ({ page, request }) => {
    test.skip(hasPreexistingAgent, 'Detected a pre-existing running agent; skip to avoid interrupting it.');

    await request.delete(`/api/agent/status?projectId=${PROJECT_ID}`).catch(() => null);

    await seedProjectInStorage(page, 3);
    await page.goto(`/stage3?projectId=${PROJECT_ID}`);

    await expect(page.getByText('自动开发')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: '启动代理' })).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: '启动代理' }).click();
    await expect(page.getByText('最大轮次')).toBeVisible({ timeout: 10_000 });
    await page.locator('input[type="number"]').fill('1');

    const startResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/agent/start') &&
        response.request().method() === 'POST',
    );

    await page.getByRole('button', { name: '启动' }).click();
    const startResponse = await startResponsePromise;
    expect(startResponse.status()).toBe(200);
    const startData = (await startResponse.json()) as { success?: boolean };
    expect(startData.success).toBeTruthy();

    const status = await waitForNonIdleStatus(request, 45_000);
    expect(status).not.toBe('idle');
  });

  test('stage4 can trigger testing start and transition status', async ({ page, request }) => {
    test.skip(hasPreexistingAgent, 'Detected a pre-existing running agent; skip to avoid interrupting it.');

    await request.delete(`/api/agent/status?projectId=${PROJECT_ID}`).catch(() => null);

    await seedProjectInStorage(page, 4);
    await page.goto(`/stage4?projectId=${PROJECT_ID}`);

    await expect(page.getByText('4-Layer Verification Pipeline')).toBeVisible({ timeout: 30_000 });
    const startTestingButton = page.getByRole('button', { name: 'Start Testing' });
    await expect(startTestingButton).toBeVisible({ timeout: 30_000 });

    const startResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/agent/start') &&
        response.request().method() === 'POST',
    );

    await startTestingButton.click();
    const startResponse = await startResponsePromise;
    expect(startResponse.status()).toBe(200);
    const startData = (await startResponse.json()) as {
      success?: boolean;
      mode?: string;
      testingUseTeams?: boolean | null;
      testingTeammateMode?: string | null;
    };
    expect(startData.success).toBeTruthy();
    expect(startData.mode).toBe('testing');
    expect(startData.testingUseTeams).toBe(true);
    expect(['in-process', 'tmux']).toContain(startData.testingTeammateMode);

    const status = await waitForNonIdleStatus(request, 45_000);
    expect(['running', 'complete', 'error', 'failed', 'waiting_network', 'iteration_complete']).toContain(status);

    // Explicit cleanup for testing mode and assert it returns idle.
    await request.delete(`/api/agent/status?projectId=${PROJECT_ID}`).catch(() => null);
    const finalStatus = await waitForIdleStatus(request, 30_000);
    expect(finalStatus).toBe('idle');
  });

  test('stage4 testing can finish naturally to complete', async ({ page, request }) => {
    test.skip(!RUN_STAGE4_FULL, 'Set BOTOOL_E2E_STAGE4_FULL=1 to run full Stage4 completion test.');
    test.skip(hasPreexistingAgent, 'Detected a pre-existing running agent; skip to avoid interrupting it.');
    test.setTimeout(4 * 60 * 1000);

    await request.delete(`/api/agent/status?projectId=${PROJECT_ID}`).catch(() => null);

    await seedProjectInStorage(page, 4);
    await page.goto(`/stage4?projectId=${PROJECT_ID}`);

    await expect(page.getByText('4-Layer Verification Pipeline')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Start Testing' })).toBeVisible({ timeout: 30_000 });

    // Use startLayer=4 to verify natural completion path within practical E2E time window.
    const startResponse = await request.post('/api/agent/start', {
      data: { mode: 'testing', projectId: PROJECT_ID, startLayer: 4 },
    });
    expect(startResponse.ok()).toBeTruthy();
    const startData = (await startResponse.json()) as { success?: boolean };
    expect(startData.success).toBeTruthy();

    const nonIdle = await waitForNonIdleStatus(request, 60_000);
    expect(nonIdle).not.toBe('idle');

    const finalStatus = await waitForTerminalStatus(request, 90_000);
    if (finalStatus !== 'complete') {
      throw new Error(`Stage4 testing ended with non-success status: ${finalStatus}`);
    }
  });
});
