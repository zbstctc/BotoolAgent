import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const RUN_LARGE_PRD = process.env.BOTOOL_E2E_LARGE_PRD === '1';
const VIEWER_DIR = process.cwd();
const REPO_ROOT = path.resolve(VIEWER_DIR, '..');
const TASKS_DIR = path.join(REPO_ROOT, 'tasks');
const ARCHIVE_DIR = path.join(REPO_ROOT, 'tasks', 'snapshots');
const SOURCE_PRD_PATH = path.join(REPO_ROOT, 'v1.6_Botool_Present_v2PRD copy.md');
const SOURCE_PRD_ID = 'e2e-large-prd-source';
const SOURCE_PRD_FILE = path.join(TASKS_DIR, `prd-${SOURCE_PRD_ID}.md`);
const PROJECT_ID = 'e2e-large-prd-project';
// Use the new per-project directory format: tasks/{projectId}/prd.json
const PROJECT_DIR = path.join(TASKS_DIR, PROJECT_ID);
const PROJECT_JSON_FILE = path.join(PROJECT_DIR, 'prd.json');
const PROJECT_PROGRESS_FILE = path.join(PROJECT_DIR, 'progress.txt');

const STORAGE_KEY = 'botool-projects';
const LARGE_TIMEOUT = 14 * 60 * 1000;

type FileBackup = { exists: boolean; content: string };

const fileBackups = new Map<string, FileBackup>();
let preExistingTaskMdFiles = new Set<string>();
let preExistingArchiveEntries = new Set<string>();

function backupFile(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fileBackups.set(filePath, { exists: true, content: fs.readFileSync(filePath, 'utf-8') });
  } else {
    fileBackups.set(filePath, { exists: false, content: '' });
  }
}

function restoreFile(filePath: string): void {
  const backup = fileBackups.get(filePath);
  if (!backup) return;

  if (backup.exists) {
    fs.writeFileSync(filePath, backup.content, 'utf-8');
    return;
  }

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

test.describe('Large PRD Viewer Pipeline', () => {
  test.skip(!RUN_LARGE_PRD, 'Set BOTOOL_E2E_LARGE_PRD=1 to run this large integration test.');
  test.setTimeout(LARGE_TIMEOUT);

  test.beforeAll(() => {
    if (!fs.existsSync(SOURCE_PRD_PATH)) {
      throw new Error(`Large PRD source file not found: ${SOURCE_PRD_PATH}`);
    }

    fs.mkdirSync(TASKS_DIR, { recursive: true });
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });

    preExistingTaskMdFiles = new Set(
      fs.readdirSync(TASKS_DIR).filter((name) => name.startsWith('prd-') && name.endsWith('.md')),
    );
    preExistingArchiveEntries = new Set(fs.readdirSync(ARCHIVE_DIR));

    backupFile(SOURCE_PRD_FILE);
    fs.mkdirSync(PROJECT_DIR, { recursive: true });
    backupFile(PROJECT_JSON_FILE);
    backupFile(PROJECT_PROGRESS_FILE);

    const largePrdContent = fs.readFileSync(SOURCE_PRD_PATH, 'utf-8');
    fs.writeFileSync(SOURCE_PRD_FILE, largePrdContent, 'utf-8');
  });

  test.afterAll(() => {
    restoreFile(SOURCE_PRD_FILE);
    restoreFile(PROJECT_JSON_FILE);
    restoreFile(PROJECT_PROGRESS_FILE);

    // Remove task markdown files created by this test run.
    for (const name of fs.readdirSync(TASKS_DIR)) {
      if (!name.startsWith('prd-') || !name.endsWith('.md')) continue;
      if (preExistingTaskMdFiles.has(name)) continue;
      fs.unlinkSync(path.join(TASKS_DIR, name));
    }

    // Remove archive entries created by this test run.
    for (const name of fs.readdirSync(ARCHIVE_DIR)) {
      if (preExistingArchiveEntries.has(name)) continue;
      fs.rmSync(path.join(ARCHIVE_DIR, name), { recursive: true, force: true });
    }
  });

  test('converts a large PRD and enters Stage 3 via viewer', async ({ page }) => {
    const now = Date.now();
    const projectStorage = {
      version: 1,
      activeProjectId: PROJECT_ID,
      projects: {
        [PROJECT_ID]: {
          id: PROJECT_ID,
          name: 'Large PRD E2E Project',
          currentStage: 2,
          prdId: SOURCE_PRD_ID,
          branchName: null,
          status: 'active',
          createdAt: now,
          updatedAt: now,
        },
      },
    };

    await page.addInitScript(
      ({ storageKey, storageValue }) => {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem(storageKey, JSON.stringify(storageValue));
      },
      { storageKey: STORAGE_KEY, storageValue: projectStorage },
    );

    await page.goto(`/stage2?prd=${SOURCE_PRD_ID}&mode=feature`);

    await expect(page.getByText('选择规范')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /跳过规范检查|确认选择/ }).click();

    await expect(page.getByText('自动生成代码示例和测试用例')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: '跳过此步' }).click();

    const conversionFailed = page.getByText('转换失败');
    const startConversionButton = page.getByRole('button', { name: '开始转换' });
    const startDevButton = page.getByRole('button', { name: '开始开发' });

    const shouldStartManually = await startConversionButton
      .isVisible({ timeout: 5_000 })
      .catch(() => false);
    if (shouldStartManually) {
      await startConversionButton.click();
    }

    const conversionResult = await Promise.race([
      startDevButton
        .waitFor({ state: 'visible', timeout: LARGE_TIMEOUT })
        .then(() => 'ready' as const),
      conversionFailed
        .waitFor({ state: 'visible', timeout: LARGE_TIMEOUT })
        .then(() => 'failed' as const),
    ]);

    if (conversionResult === 'failed') {
      const errorText = (await page.locator('text=转换失败').first().textContent()) || 'unknown error';
      throw new Error(`Large PRD conversion failed in viewer: ${errorText}`);
    }

    await expect(startDevButton).toBeEnabled({ timeout: 60_000 });
    await startDevButton.click();

    await expect(page).toHaveURL(new RegExp(`/stage3\\?projectId=${PROJECT_ID}`), { timeout: 90_000 });
    await expect(page.getByText('自动开发')).toBeVisible({ timeout: 30_000 });

    await expect.poll(() => fs.existsSync(PROJECT_JSON_FILE), { timeout: 30_000 }).toBe(true);
    const generatedPrdJson = JSON.parse(fs.readFileSync(PROJECT_JSON_FILE, 'utf-8')) as {
      prdFile?: string;
    };

    // New per-project format: tasks/{prdId}/prd.md (see prd/convert/route.ts line 144)
    expect(generatedPrdJson.prdFile).toBe(`tasks/${SOURCE_PRD_ID}/prd.md`);
  });
});
