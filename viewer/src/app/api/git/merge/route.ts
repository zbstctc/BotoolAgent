import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { updateTaskHistoryEntry } from '@/lib/task-history';
import { getProjectRoot, getProjectPrdJsonPath, getBotoolRoot, normalizeProjectId, getTasksDir, isSafeGitRef } from '@/lib/project-root';
import path from 'path';
import { verifyCsrfProtection } from '@/lib/api-guard';

const execAsync = promisify(exec);

const PROJECT_ROOT = getProjectRoot();

/**
 * Resolve the feature branch name for a project.
 * If projectId is given, reads branchName from tasks/{projectId}/prd.json.
 * Falls back to git branch --show-current (for non-worktree usage).
 */
async function resolveBranch(projectId?: string | null): Promise<string | null> {
  const safeId = normalizeProjectId(projectId);
  if (safeId) {
    try {
      const prdPath = getProjectPrdJsonPath(safeId);
      const content = await fsPromises.readFile(prdPath, 'utf-8');
      const prd = JSON.parse(content);
      if (prd.branchName && isSafeGitRef(prd.branchName)) {
        return prd.branchName;
      }
    } catch {
      // prd.json not found or invalid — fall through to git fallback
    }
  }
  try {
    const { stdout } = await execAsync('git branch --show-current', { cwd: PROJECT_ROOT });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

interface PRDJson {
  project?: string;
  description?: string;
  branchName?: string;
  devTasks?: Array<{ id: string; passes: boolean }>;
}

function readPRD(projectId?: string): PRDJson | null {
  try {
    const prdFile = getProjectPrdJsonPath(projectId);
    if (fs.existsSync(prdFile)) {
      return JSON.parse(fs.readFileSync(prdFile, 'utf-8'));
    }
  } catch {
    // Ignore
  }
  return null;
}

interface MergeResult {
  success: boolean;
  method: 'merge' | 'squash' | 'rebase';
  mergedBranch: string;
  baseBranch: string;
  prNumber?: number;
  prUrl?: string;
  deletedBranch: boolean;
  commitSha?: string;
  message: string;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Check if gh CLI is available
 */
async function checkGhCli(): Promise<boolean> {
  try {
    await execAsync('gh --version', { cwd: PROJECT_ROOT });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if user is authenticated with gh
 */
async function checkGhAuth(): Promise<boolean> {
  try {
    await execAsync('gh auth status', { cwd: PROJECT_ROOT });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get PR info for a specific branch (by --head filter).
 * Falls back to gh pr view (current branch) when no branch is given.
 */
async function getPRInfo(branch?: string): Promise<{ number: number; url: string; state: string } | null> {
  try {
    if (branch) {
      // Find PR by branch name (works from any branch, including main)
      const { stdout: listJson } = await execAsync(
        `gh pr list --head ${shellQuote(branch)} --json number --state all`,
        { cwd: PROJECT_ROOT }
      );
      const prList = JSON.parse(listJson);
      if (prList.length === 0) return null;

      const prNumber = prList[0].number;
      const { stdout } = await execAsync(
        `gh pr view ${prNumber} --json number,url,state`,
        { cwd: PROJECT_ROOT }
      );
      return JSON.parse(stdout);
    }
    // Fallback: gh pr view for current branch
    const { stdout } = await execAsync(
      `gh pr view --json number,url,state`,
      { cwd: PROJECT_ROOT }
    );
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

/**
 * POST /api/git/merge
 * Merges the current branch's PR to base branch
 *
 * Request body (optional):
 * - method: 'merge' | 'squash' | 'rebase' (default: 'squash')
 * - deleteBranch: boolean (default: true) - delete branch after merge
 * - baseBranch: string (default: 'main') - base branch to merge into
 */
export async function POST(request: NextRequest) {
  const csrfError = verifyCsrfProtection(request);
  if (csrfError) return csrfError;

  try {
    // Check gh CLI
    if (!await checkGhCli()) {
      return NextResponse.json(
        { error: 'GitHub CLI (gh) is not installed' },
        { status: 500 }
      );
    }

    if (!await checkGhAuth()) {
      return NextResponse.json(
        { error: 'Not authenticated with GitHub. Run "gh auth login" first.' },
        { status: 401 }
      );
    }

    // Parse request body
    let method: 'merge' | 'squash' | 'rebase' = 'squash';
    let deleteBranch = true;
    let baseBranch = 'main';
    let projectId: string | undefined;

    try {
      const requestBody = await request.json();
      method = requestBody.method || 'squash';
      deleteBranch = requestBody.deleteBranch !== false; // default true
      baseBranch = requestBody.baseBranch || 'main';
      projectId = requestBody.projectId;
    } catch {
      // Empty body is OK, use defaults
    }

    if (!isSafeGitRef(baseBranch)) {
      return NextResponse.json(
        { error: 'Invalid baseBranch' },
        { status: 400 }
      );
    }

    // Resolve branch: use projectId → prd.json → branchName, or fall back to git
    const currentBranch = await resolveBranch(projectId);
    if (!currentBranch) {
      return NextResponse.json(
        { error: 'Could not determine branch name' },
        { status: 400 }
      );
    }

    if (!isSafeGitRef(currentBranch)) {
      return NextResponse.json(
        { error: 'Unsafe branch name detected' },
        { status: 400 }
      );
    }

    // Check if on base branch
    if (currentBranch === baseBranch) {
      return NextResponse.json(
        { error: `Cannot merge from ${baseBranch} to itself` },
        { status: 400 }
      );
    }

    // Get PR info by branch (works from any branch, including main)
    const prInfo = await getPRInfo(currentBranch);

    if (!prInfo) {
      return NextResponse.json(
        { error: `No PR found for branch "${currentBranch}". Create a PR first.` },
        { status: 404 }
      );
    }

    if (prInfo.state.toLowerCase() !== 'open') {
      return NextResponse.json(
        { error: `PR is not open (current state: ${prInfo.state})` },
        { status: 400 }
      );
    }

    // Build merge command
    const methodFlag = method === 'merge' ? '--merge' : method === 'rebase' ? '--rebase' : '--squash';
    try {
      // Execute merge — do NOT pass --delete-branch to gh; we handle local cleanup ourselves.
      // gh's --delete-branch tries to delete the local branch, which fails when a worktree
      // is checked out on that branch (worktree model). We remove the worktree first, then
      // delete the local branch manually.
      await execAsync(
        `gh pr merge ${prInfo.number} ${methodFlag}`,
        { cwd: PROJECT_ROOT }
      );

      // Delete remote branch via git push (separate from gh merge)
      if (deleteBranch) {
        try {
          await execAsync(`git push origin --delete ${shellQuote(currentBranch)}`, { cwd: PROJECT_ROOT });
        } catch {
          // Remote branch may already be deleted (gh sometimes deletes it); ignore
        }
      }

      // Get merge commit SHA (if available)
      let commitSha: string | undefined;
      try {
        // Switch to base branch and get the latest commit
        await execAsync(`git fetch origin ${shellQuote(baseBranch)}`, { cwd: PROJECT_ROOT });
        const { stdout: shaOutput } = await execAsync(
          `git rev-parse origin/${shellQuote(baseBranch)}`,
          { cwd: PROJECT_ROOT }
        );
        commitSha = shaOutput.trim();
      } catch {
        // Ignore errors getting commit SHA
      }

      const result: MergeResult = {
        success: true,
        method,
        mergedBranch: currentBranch,
        baseBranch,
        prNumber: prInfo.number,
        prUrl: prInfo.url,
        deletedBranch: deleteBranch,
        commitSha,
        message: `Successfully merged PR #${prInfo.number} via ${method}${deleteBranch ? ' and deleted branch' : ''}`,
      };

      // Clean up worktree and per-project PID file after successful merge
      try {
        const safeId = normalizeProjectId(projectId);
        if (safeId) {
          const botoolRoot = getBotoolRoot();
          // Remove the worktree FIRST — must happen before local branch deletion
          try {
            await execAsync(
              `git worktree remove ${shellQuote(`.worktrees/${safeId}`)} --force`,
              { cwd: botoolRoot }
            );
          } catch (worktreeErr) {
            console.warn(`[merge] Failed to remove worktree .worktrees/${safeId}:`, worktreeErr);
          }
          // Now delete local branch (safe after worktree is removed)
          if (deleteBranch) {
            try {
              await execAsync(`git branch -D ${shellQuote(currentBranch)}`, { cwd: botoolRoot });
            } catch {
              // Branch may already be gone; ignore
            }
          }
          // Remove per-project state files (agent-pid, agent-status, teammates.json, last-branch)
          const projectDir = path.join(getTasksDir(), safeId);
          for (const stateFile of ['agent-pid', 'agent-status', 'teammates.json', 'last-branch']) {
            const filePath = path.join(projectDir, stateFile);
            try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch { /* ignore */ }
          }
        }
      } catch (cleanupErr) {
        console.warn('[merge] Worktree cleanup error (non-fatal):', cleanupErr);
      }

      // Update task history to mark as completed (merged)
      const prd = readPRD(projectId);
      if (prd && prd.branchName) {
        const tasks = prd.devTasks || [];
        const tasksCompleted = tasks.filter(t => t.passes).length;
        const tasksTotal = tasks.length;

        updateTaskHistoryEntry({
          id: prd.branchName,
          name: prd.project || 'Unknown Task',
          description: prd.description,
          branchName: prd.branchName,
          status: 'completed',
          stage: 5,
          tasksCompleted,
          tasksTotal,
          isMerged: true,
          prUrl: prInfo.url,
          endTime: new Date().toISOString(),
        });
      }

      return NextResponse.json(result);
    } catch (mergeError) {
      const errorMessage = mergeError instanceof Error ? mergeError.message : 'Unknown error';

      // Check for common merge issues
      if (errorMessage.includes('conflicts')) {
        return NextResponse.json(
          { error: 'Merge failed due to conflicts. Please resolve conflicts manually.' },
          { status: 409 }
        );
      }

      if (errorMessage.includes('required status checks')) {
        return NextResponse.json(
          { error: 'Merge blocked: required status checks have not passed.' },
          { status: 422 }
        );
      }

      if (errorMessage.includes('review')) {
        return NextResponse.json(
          { error: 'Merge blocked: required reviews have not been approved.' },
          { status: 422 }
        );
      }

      throw mergeError;
    }
  } catch (error) {
    console.error('Error merging PR:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to merge PR: ${errorMessage}` },
      { status: 500 }
    );
  }
}

/**
 * GET /api/git/merge?projectId=xxx
 * Returns information about whether the project's feature branch PR can be merged.
 * In worktree model, resolves the branch from prd.json rather than git branch --show-current.
 */
export async function GET(request: NextRequest) {
  try {
    // Check gh CLI
    if (!await checkGhCli()) {
      return NextResponse.json(
        { error: 'GitHub CLI (gh) is not installed' },
        { status: 500 }
      );
    }

    if (!await checkGhAuth()) {
      return NextResponse.json(
        { error: 'Not authenticated with GitHub. Run "gh auth login" first.' },
        { status: 401 }
      );
    }

    const url = new URL(request.url);
    const projectId = url.searchParams.get('projectId') || undefined;

    const currentBranch = await resolveBranch(projectId);
    if (!currentBranch) {
      return NextResponse.json(
        { error: 'Could not determine branch name' },
        { status: 400 }
      );
    }

    if (!isSafeGitRef(currentBranch)) {
      return NextResponse.json(
        { error: 'Unsafe branch name detected' },
        { status: 400 }
      );
    }

    // Find PR by branch using gh pr list --head (works from any branch, including main)
    try {
      const { stdout: listJson } = await execAsync(
        `gh pr list --head ${shellQuote(currentBranch)} --json number --state all`,
        { cwd: PROJECT_ROOT }
      );
      const prList = JSON.parse(listJson);

      if (prList.length === 0) {
        return NextResponse.json({
          branch: currentBranch,
          hasPR: false,
          canMerge: false,
          message: 'No PR found for this branch',
        });
      }

      const prNumber = prList[0].number;
      const { stdout: prJson } = await execAsync(
        `gh pr view ${prNumber} --json number,title,url,state,mergeable,mergeStateStatus,reviewDecision`,
        { cwd: PROJECT_ROOT }
      );

      const prData = JSON.parse(prJson);

      return NextResponse.json({
        branch: currentBranch,
        hasPR: true,
        prNumber: prData.number,
        prUrl: prData.url,
        state: prData.state.toLowerCase(),
        mergeable: prData.mergeable === 'MERGEABLE',
        mergeStateStatus: prData.mergeStateStatus,
        reviewDecision: prData.reviewDecision,
        canMerge: prData.state.toLowerCase() === 'open' && prData.mergeable === 'MERGEABLE',
        message: getMergeStatusMessage(prData),
      });
    } catch {
      return NextResponse.json({
        branch: currentBranch,
        hasPR: false,
        canMerge: false,
        message: 'No PR found for this branch',
      });
    }
  } catch (error) {
    console.error('Error getting merge status:', error);
    return NextResponse.json(
      { error: 'Failed to get merge status' },
      { status: 500 }
    );
  }
}

/**
 * Generate a human-readable merge status message
 */
function getMergeStatusMessage(prData: {
  state: string;
  mergeable: string;
  mergeStateStatus?: string;
  reviewDecision?: string;
}): string {
  if (prData.state.toLowerCase() !== 'open') {
    return `PR is ${prData.state.toLowerCase()}`;
  }

  if (prData.mergeable === 'CONFLICTING') {
    return 'PR has conflicts that need to be resolved';
  }

  if (prData.mergeStateStatus === 'BLOCKED') {
    if (prData.reviewDecision === 'REVIEW_REQUIRED') {
      return 'PR requires review approval';
    }
    return 'PR is blocked by required status checks';
  }

  if (prData.mergeable === 'MERGEABLE') {
    return 'PR is ready to merge';
  }

  return 'Checking merge status...';
}
