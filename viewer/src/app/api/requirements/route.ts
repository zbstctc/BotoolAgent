import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { getTasksDir, getBotoolRoot, getProjectPrdJsonPath, getProjectSessionPath } from '@/lib/project-root';
import type { RequirementStage, RequirementStatus, Requirement } from '@/lib/requirement-types';

interface PrdJson {
  project?: string;
  branchName?: string;
  devTasks?: Array<{ id: string; passes: boolean }>;
}

interface RegistryEntry {
  status?: string;
}

interface Registry {
  projects?: Record<string, RegistryEntry>;
}

/**
 * Read registry.json and return the status for a given project.
 */
function getRegistryStatus(projectId: string): string | null {
  try {
    const tasksDir = getTasksDir();
    const registryPath = path.join(tasksDir, 'registry.json');
    if (!fs.existsSync(registryPath)) return null;
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8')) as Registry;
    return registry.projects?.[projectId]?.status ?? null;
  } catch {
    return null;
  }
}

/**
 * Extract requirement title from markdown content (# Heading) or fall back to directory name.
 */
function extractTitle(content: string, dirName: string): string {
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) {
    return h1Match[1].trim();
  }
  return dirName;
}

/**
 * Check if a git branch has been merged into main.
 * Returns true if the branchName exists in the list of branches merged into main.
 */
function isBranchMergedIntoMain(branchName: string): boolean {
  try {
    const botoolRoot = getBotoolRoot();
    const mergedBranches = execSync('git branch --merged main', {
      cwd: botoolRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return mergedBranches
      .split('\n')
      .map((b: string) => b.trim().replace(/^\*\s*/, ''))
      .includes(branchName);
  } catch {
    return false;
  }
}

/**
 * Check if a git worktree for this project exists at .worktrees/{id}/.
 */
function hasWorktree(projectId: string): boolean {
  const botoolRoot = getBotoolRoot();
  const worktreePath = path.join(botoolRoot, '.worktrees', projectId);
  return fs.existsSync(worktreePath);
}

/**
 * Check if testing has been started (agent-testing.log exists on disk).
 */
function hasTestingStarted(projectId: string): boolean {
  const tasksDir = getTasksDir();
  return fs.existsSync(path.join(tasksDir, projectId, 'agent-testing.log'));
}

/**
 * Check if testing-report.json exists for this project,
 * either on disk (main branch) or on the feature branch.
 */
function hasTestingReport(projectId: string, branchName?: string): boolean {
  const tasksDir = getTasksDir();
  // Check on current working tree (main)
  if (fs.existsSync(path.join(tasksDir, projectId, 'testing-report.json'))) {
    return true;
  }
  // Check on the feature branch (testing agent commits artifacts there)
  if (branchName) {
    try {
      const botoolRoot = getBotoolRoot();
      const relativePath = path.relative(botoolRoot, path.join(tasksDir, projectId, 'testing-report.json'));
      execSync(`git cat-file -e ${branchName}:${relativePath}`, {
        cwd: botoolRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return true;
    } catch {
      // Branch doesn't have the file
    }
  }
  return false;
}

/**
 * Check if agent-status file exists and indicates development has started/completed.
 */
function hasAgentActivity(projectId: string): boolean {
  const tasksDir = getTasksDir();
  return fs.existsSync(path.join(tasksDir, projectId, 'agent-status'))
    || fs.existsSync(path.join(tasksDir, projectId, 'progress.txt'));
}

/**
 * Infer the requirement stage based on which files exist:
 * - DRAFT.md only → Stage 0
 * - prd.md (no prd.json) → Stage 1
 * - prd.json exists → Stage 2+
 * - worktree exists → Stage 3+
 * - branch merged into main → Stage 5
 */
function inferStage(
  projectId: string,
  hasDraftMd: boolean,
  hasPrdMd: boolean,
  hasPrdJson: boolean,
  prdJson: PrdJson | null
): RequirementStage {
  if (!hasDraftMd && !hasPrdMd) {
    // Should not happen as we filter these out, but be safe
    return 0;
  }

  if (!hasPrdMd && hasDraftMd) {
    return 0;
  }

  // Has prd.md → at least Stage 1
  if (!hasPrdJson) {
    return 1;
  }

  // Has prd.json → at least Stage 2
  const branchName = prdJson?.branchName;
  const devTasks = prdJson?.devTasks ?? [];
  const completedCount = devTasks.filter(t => t.passes).length;
  const allTasksDone = devTasks.length > 0 && completedCount === devTasks.length;

  // Registry says "complete" → Stage 5 (authoritative after finalize)
  const registryStatus = getRegistryStatus(projectId);
  if (registryStatus === 'complete') {
    return 5;
  }

  // Check if branch merged into main → Stage 5
  if (branchName && isBranchMergedIntoMain(branchName)) {
    return 5;
  }

  // All tasks done → check testing state
  if (allTasksDone) {
    // Testing report exists (on disk or on feature branch) → Stage 5
    if (hasTestingReport(projectId, branchName)) {
      return 5;
    }
    // Testing started (log file exists) → Stage 4
    if (hasTestingStarted(projectId)) {
      return 4;
    }
    // Coding done but testing not started → Stage 3 (shows "开发完成")
    return 3;
  }

  // Testing in progress but not all tasks done (edge case) → Stage 4
  if (hasTestingReport(projectId, branchName) || hasTestingStarted(projectId)) {
    return 4;
  }

  // Worktree exists or agent has been active or some tasks completed → Stage 3
  if (hasWorktree(projectId) || hasAgentActivity(projectId) || completedCount > 0) {
    return 3;
  }

  return 2;
}

/**
 * Derive RequirementStatus from stage and project state.
 * Stage 5 can be either "completed" (merged) or "active" (tested, pending merge).
 */
function inferStatus(stage: RequirementStage, projectId: string, branchName?: string): RequirementStatus {
  if (stage !== 5) return 'active';
  // Stage 5: check if actually merged or just testing-complete
  if (getRegistryStatus(projectId) === 'complete') return 'completed';
  if (branchName && isBranchMergedIntoMain(branchName)) return 'completed';
  return 'active';
}

export async function GET() {
  try {
    const tasksDir = getTasksDir();

    if (!fs.existsSync(tasksDir)) {
      return NextResponse.json({ data: [] });
    }

    const requirements: Requirement[] = [];

    // Collect project IDs that were "transformed from" another source.
    // These are marker references and should not appear as standalone requirements.
    const transformedFromIds = new Set<string>();

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(tasksDir, { withFileTypes: true });
    } catch {
      return NextResponse.json({ data: [] });
    }

    const projectDirs = entries.filter(e => e.isDirectory() && e.name !== 'archives' && e.name !== 'snapshots');

    // First pass: collect transformedFrom references
    for (const dir of projectDirs) {
      const sessionPath = getProjectSessionPath(dir.name);
      if (fs.existsSync(sessionPath)) {
        try {
          const session = JSON.parse(fs.readFileSync(sessionPath, 'utf-8')) as Record<string, unknown>;
          if (typeof session.transformedFrom === 'string' && session.transformedFrom) {
            // transformedFrom stores the source project id (directory name)
            transformedFromIds.add(session.transformedFrom);
          }
        } catch {
          // non-fatal, skip
        }
      }
    }

    // Second pass: build requirements list
    for (const dir of projectDirs) {
      const dirName = dir.name;

      // Skip directories that are just import sources (already transformed)
      if (transformedFromIds.has(dirName)) continue;

      const dirPath = path.join(tasksDir, dirName);
      const draftMdPath = path.join(dirPath, 'DRAFT.md');
      const prdMdPath = path.join(dirPath, 'prd.md');
      const prdJsonPath = getProjectPrdJsonPath(dirName);

      const hasDraftMd = fs.existsSync(draftMdPath);
      const hasPrdMd = fs.existsSync(prdMdPath);
      const hasPrdJson = fs.existsSync(prdJsonPath);

      // Skip directories with neither DRAFT.md nor prd.md (not a requirement directory)
      if (!hasDraftMd && !hasPrdMd) continue;

      // Read prd.json if it exists
      let prdJson: PrdJson | null = null;
      if (hasPrdJson) {
        try {
          prdJson = JSON.parse(fs.readFileSync(prdJsonPath, 'utf-8')) as PrdJson;
        } catch {
          // non-fatal
        }
      }

      // Determine title from prd.md or DRAFT.md content, fallback to dir name
      let name = dirName;
      const mdFilePath = hasPrdMd ? prdMdPath : draftMdPath;
      try {
        const content = fs.readFileSync(mdFilePath, 'utf-8');
        name = extractTitle(content, dirName);
      } catch {
        // keep dirName as fallback
      }

      // Get file timestamps for createdAt/updatedAt
      let createdAt = Date.now();
      let updatedAt = Date.now();
      try {
        const statFile = hasPrdMd ? prdMdPath : draftMdPath;
        const stats = fs.statSync(statFile);
        createdAt = stats.birthtimeMs || stats.ctimeMs;
        updatedAt = stats.mtimeMs;
      } catch {
        // use defaults
      }

      const stage = inferStage(dirName, hasDraftMd, hasPrdMd, hasPrdJson, prdJson);
      const status = inferStatus(stage, dirName, prdJson?.branchName);

      const requirement: Requirement = {
        id: dirName,
        name,
        stage,
        status,
        createdAt,
        updatedAt,
      };

      // Populate optional fields
      if (hasDraftMd) {
        requirement.sourceFile = draftMdPath;
      }

      if (hasPrdMd) {
        requirement.prdId = dirName;
      }

      if (hasPrdJson) {
        requirement.prdJsonPath = prdJsonPath;

        if (prdJson) {
          if (prdJson.branchName) {
            requirement.branchName = prdJson.branchName;
          }

          const devTasks = prdJson.devTasks ?? [];
          if (devTasks.length > 0) {
            requirement.taskCount = devTasks.length;
            requirement.tasksCompleted = devTasks.filter(t => t.passes).length;
          }
        }
      }

      // Try to extract prUrl from agent-status
      if (!requirement.prUrl) {
        const agentStatusPath = path.join(dirPath, 'agent-status');
        if (fs.existsSync(agentStatusPath)) {
          try {
            const agentStatus = JSON.parse(fs.readFileSync(agentStatusPath, 'utf-8')) as Record<string, unknown>;
            if (typeof agentStatus.prUrl === 'string') {
              requirement.prUrl = agentStatus.prUrl;
            }
          } catch {
            // non-fatal
          }
        }
      }

      requirements.push(requirement);
    }

    // Sort by updatedAt descending (most recently modified first)
    requirements.sort((a, b) => b.updatedAt - a.updatedAt);

    return NextResponse.json({ data: requirements });
  } catch (error) {
    console.error('[/api/requirements] Error scanning requirements:', error);
    return NextResponse.json(
      { error: 'Failed to scan requirements' },
      { status: 500 }
    );
  }
}
