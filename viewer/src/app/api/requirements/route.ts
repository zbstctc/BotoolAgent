import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { getTasksDir, getBotoolRoot, getProjectPrdJsonPath, getProjectSessionPath } from '@/lib/project-root';

// Inline type definitions (will be replaced by imports from requirement-types.ts once DT-008 is complete)
type RequirementStage = 0 | 1 | 2 | 3 | 4 | 5;
type RequirementStatus = 'active' | 'completed' | 'archived';

interface Requirement {
  id: string;                     // directory name used as id
  name: string;                   // requirement title
  stage: RequirementStage;        // current stage
  status: RequirementStatus;
  sourceFile?: string;            // DRAFT.md path
  prdId?: string;                 // prd.md ID
  prdJsonPath?: string;           // prd.json path
  taskCount?: number;             // total task count (from prd.json)
  branchName?: string;            // Git branch name (from prd.json)
  tasksCompleted?: number;        // completed task count (from prd.json)
  createdAt: number;
  updatedAt: number;
}

interface PrdJson {
  project?: string;
  branchName?: string;
  devTasks?: Array<{ id: string; passes: boolean }>;
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
    const { execSync } = require('child_process') as typeof import('child_process');
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

  // Check if branch merged into main → Stage 5
  if (branchName && isBranchMergedIntoMain(branchName)) {
    return 5;
  }

  // Check if worktree exists → Stage 3+
  if (hasWorktree(projectId)) {
    // Stage 3 = coding active, Stage 4 = testing
    // We'll use Stage 3 as the default for worktree presence
    // (Stage 4 would require additional testing-state detection)
    return 3;
  }

  return 2;
}

/**
 * Derive RequirementStatus from stage and task completion.
 */
function inferStatus(stage: RequirementStage, prdJson: PrdJson | null): RequirementStatus {
  if (stage === 5) return 'completed';
  if (prdJson?.devTasks && prdJson.devTasks.length > 0) {
    const allDone = prdJson.devTasks.every(t => t.passes);
    if (allDone) return 'completed';
  }
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

    const projectDirs = entries.filter(e => e.isDirectory());

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
      const status = inferStatus(stage, prdJson);

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
