import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getProjectRoot } from '@/lib/project-root';

const execAsync = promisify(exec);

const PROJECT_ROOT = getProjectRoot();

interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

interface DiffLine {
  type: 'context' | 'addition' | 'deletion';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

interface FileDiff {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  oldPath?: string; // For renamed files
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  isBinary: boolean;
}

interface DiffSummary {
  branch: string;
  baseBranch: string;
  files: FileDiff[];
  totals: {
    files: number;
    additions: number;
    deletions: number;
  };
}

function isSafeGitRef(ref: string): boolean {
  return (
    /^[A-Za-z0-9._/-]+$/.test(ref) &&
    !ref.startsWith('-') &&
    !ref.includes('..') &&
    !ref.includes('//')
  );
}

function isSafeGitPath(filePath: string): boolean {
  return (
    /^[A-Za-z0-9._/\-]+$/.test(filePath) &&
    !filePath.startsWith('/') &&
    !filePath.startsWith('-') &&
    !filePath.includes('..') &&
    !filePath.includes('//')
  );
}

/**
 * Parse a unified diff output into structured hunks
 */
function parseDiff(diffOutput: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const lines = diffOutput.split('\n');

  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    // Match hunk header: @@ -oldStart,oldLines +newStart,newLines @@
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);

    if (hunkMatch) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }

      const oldStart = parseInt(hunkMatch[1], 10);
      const oldLines = hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1;
      const newStart = parseInt(hunkMatch[3], 10);
      const newLines = hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1;

      currentHunk = {
        oldStart,
        oldLines,
        newStart,
        newLines,
        lines: [],
      };

      oldLine = oldStart;
      newLine = newStart;
      continue;
    }

    if (!currentHunk) continue;

    // Skip diff header lines
    if (line.startsWith('diff --git') ||
        line.startsWith('index ') ||
        line.startsWith('---') ||
        line.startsWith('+++') ||
        line.startsWith('\\')) {
      continue;
    }

    if (line.startsWith('+')) {
      currentHunk.lines.push({
        type: 'addition',
        content: line.substring(1),
        newLineNumber: newLine,
      });
      newLine++;
    } else if (line.startsWith('-')) {
      currentHunk.lines.push({
        type: 'deletion',
        content: line.substring(1),
        oldLineNumber: oldLine,
      });
      oldLine++;
    } else if (line.startsWith(' ') || line === '') {
      // Context line
      currentHunk.lines.push({
        type: 'context',
        content: line.substring(1) || '',
        oldLineNumber: oldLine,
        newLineNumber: newLine,
      });
      oldLine++;
      newLine++;
    }
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }

  return hunks;
}

/**
 * GET /api/git/diff
 * Returns all file diffs between current branch and main
 *
 * Query params:
 * - file: (optional) specific file path to get diff for
 * - baseBranch: (optional) base branch to compare against (default: main)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const specificFile = searchParams.get('file');
    const baseBranch = searchParams.get('baseBranch') || 'main';

    if (!isSafeGitRef(baseBranch)) {
      return NextResponse.json(
        { error: 'Invalid baseBranch parameter' },
        { status: 400 }
      );
    }
    if (specificFile && !isSafeGitPath(specificFile)) {
      return NextResponse.json(
        { error: 'Invalid file parameter' },
        { status: 400 }
      );
    }

    // Get the current branch name
    const { stdout: branchStdout } = await execAsync('git branch --show-current', {
      cwd: PROJECT_ROOT,
    });
    const currentBranch = branchStdout.trim();

    if (!isSafeGitRef(currentBranch)) {
      return NextResponse.json(
        { error: 'Unsafe branch name detected' },
        { status: 400 }
      );
    }

    // Check if base branch exists
    try {
      await execAsync(`git rev-parse --verify ${baseBranch}`, { cwd: PROJECT_ROOT });
    } catch {
      return NextResponse.json(
        { error: `Base branch '${baseBranch}' does not exist` },
        { status: 400 }
      );
    }

    // If specific file requested, get diff for that file only
    if (specificFile) {
      const { stdout: diffOutput } = await execAsync(
        `git diff ${baseBranch}...${currentBranch} -- "${specificFile}" 2>/dev/null || git diff ${baseBranch} -- "${specificFile}"`,
        { cwd: PROJECT_ROOT, maxBuffer: 10 * 1024 * 1024 }
      );

      // Get stats for this file
      const { stdout: statsOutput } = await execAsync(
        `git diff --numstat ${baseBranch}...${currentBranch} -- "${specificFile}" 2>/dev/null || git diff --numstat ${baseBranch} -- "${specificFile}"`,
        { cwd: PROJECT_ROOT }
      );

      // Get status
      const { stdout: statusOutput } = await execAsync(
        `git diff --name-status ${baseBranch}...${currentBranch} -- "${specificFile}" 2>/dev/null || git diff --name-status ${baseBranch} -- "${specificFile}"`,
        { cwd: PROJECT_ROOT }
      );

      const statsLine = statsOutput.trim();
      let additions = 0;
      let deletions = 0;
      let isBinary = false;

      if (statsLine) {
        const [add, del] = statsLine.split('\t');
        if (add === '-' || del === '-') {
          isBinary = true;
        } else {
          additions = parseInt(add, 10) || 0;
          deletions = parseInt(del, 10) || 0;
        }
      }

      const statusLine = statusOutput.trim();
      let status: FileDiff['status'] = 'modified';
      let oldPath: string | undefined;

      if (statusLine) {
        const statusCode = statusLine.charAt(0);
        switch (statusCode) {
          case 'A':
            status = 'added';
            break;
          case 'D':
            status = 'deleted';
            break;
          case 'R':
            status = 'renamed';
            // For renamed files, format is "R100\toldpath\tnewpath"
            const parts = statusLine.split('\t');
            if (parts.length >= 2) {
              oldPath = parts[1];
            }
            break;
        }
      }

      const hunks = isBinary ? [] : parseDiff(diffOutput);

      const fileDiff: FileDiff = {
        path: specificFile,
        status,
        oldPath,
        additions,
        deletions,
        hunks,
        isBinary,
      };

      return NextResponse.json({
        branch: currentBranch,
        baseBranch,
        file: fileDiff,
      });
    }

    // Get all file diffs
    // First, get list of changed files with stats
    const { stdout: numstatOutput } = await execAsync(
      `git diff --numstat ${baseBranch}...${currentBranch} 2>/dev/null || git diff --numstat ${baseBranch}`,
      { cwd: PROJECT_ROOT, maxBuffer: 10 * 1024 * 1024 }
    );

    const { stdout: nameStatusOutput } = await execAsync(
      `git diff --name-status ${baseBranch}...${currentBranch} 2>/dev/null || git diff --name-status ${baseBranch}`,
      { cwd: PROJECT_ROOT, maxBuffer: 10 * 1024 * 1024 }
    );

    // Parse stats
    const statsMap = new Map<string, { additions: number; deletions: number; isBinary: boolean }>();
    for (const line of numstatOutput.trim().split('\n').filter(Boolean)) {
      const [add, del, filePath] = line.split('\t');
      if (filePath) {
        statsMap.set(filePath, {
          additions: add === '-' ? 0 : parseInt(add, 10),
          deletions: del === '-' ? 0 : parseInt(del, 10),
          isBinary: add === '-' || del === '-',
        });
      }
    }

    // Parse status and build file list
    const files: FileDiff[] = [];
    const statusMap = new Map<string, { status: FileDiff['status']; oldPath?: string }>();

    for (const line of nameStatusOutput.trim().split('\n').filter(Boolean)) {
      const parts = line.split('\t');
      const statusCode = parts[0];
      const filePath = parts[parts.length - 1]; // Last part is the (new) path

      let status: FileDiff['status'] = 'modified';
      let oldPath: string | undefined;

      switch (statusCode.charAt(0)) {
        case 'A':
          status = 'added';
          break;
        case 'D':
          status = 'deleted';
          break;
        case 'R':
          status = 'renamed';
          oldPath = parts[1]; // For rename, second part is old path
          break;
      }

      statusMap.set(filePath, { status, oldPath });
    }

    // Get diff content for all files (limited to avoid huge responses)
    const { stdout: fullDiff } = await execAsync(
      `git diff ${baseBranch}...${currentBranch} 2>/dev/null || git diff ${baseBranch}`,
      { cwd: PROJECT_ROOT, maxBuffer: 50 * 1024 * 1024 }
    );

    // Parse individual file diffs
    const fileDiffs = fullDiff.split(/^diff --git /m).filter(Boolean);

    for (const fileDiff of fileDiffs) {
      // Extract file path from diff header
      const pathMatch = fileDiff.match(/^a\/(.+?) b\/(.+?)$/m);
      if (!pathMatch) continue;

      const filePath = pathMatch[2];
      const stats = statsMap.get(filePath) || { additions: 0, deletions: 0, isBinary: false };
      const statusInfo = statusMap.get(filePath) || { status: 'modified' as const };

      const hunks = stats.isBinary ? [] : parseDiff('diff --git ' + fileDiff);

      files.push({
        path: filePath,
        status: statusInfo.status,
        oldPath: statusInfo.oldPath,
        additions: stats.additions,
        deletions: stats.deletions,
        hunks,
        isBinary: stats.isBinary,
      });
    }

    // Sort by path
    files.sort((a, b) => a.path.localeCompare(b.path));

    const summary: DiffSummary = {
      branch: currentBranch,
      baseBranch,
      files,
      totals: {
        files: files.length,
        additions: files.reduce((sum, f) => sum + f.additions, 0),
        deletions: files.reduce((sum, f) => sum + f.deletions, 0),
      },
    };

    return NextResponse.json(summary);
  } catch (error) {
    console.error('Error getting git diff:', error);
    return NextResponse.json(
      { error: 'Failed to get git diff' },
      { status: 500 }
    );
  }
}
