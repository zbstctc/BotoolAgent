import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getProjectRoot } from '@/lib/project-root';

const execAsync = promisify(exec);

const PROJECT_ROOT = getProjectRoot();

interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
}

function isSafeGitRef(ref: string): boolean {
  return (
    /^[A-Za-z0-9._/-]+$/.test(ref) &&
    !ref.startsWith('-') &&
    !ref.includes('..') &&
    !ref.includes('//')
  );
}

export async function GET() {
  try {
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

    // Get file changes with stats compared to main branch
    // Use --numstat to get line additions/deletions
    const { stdout: diffStdout } = await execAsync(
      `git diff --numstat main...${currentBranch} 2>/dev/null || git diff --numstat HEAD`,
      { cwd: PROJECT_ROOT }
    );

    // Get file status (added, modified, deleted)
    const { stdout: statusStdout } = await execAsync(
      `git diff --name-status main...${currentBranch} 2>/dev/null || git diff --name-status HEAD`,
      { cwd: PROJECT_ROOT }
    );

    // Parse diff stats
    const statsLines = diffStdout.trim().split('\n').filter(Boolean);
    const statsMap = new Map<string, { additions: number; deletions: number }>();

    for (const line of statsLines) {
      const [additions, deletions, filePath] = line.split('\t');
      if (filePath) {
        statsMap.set(filePath, {
          additions: additions === '-' ? 0 : parseInt(additions, 10),
          deletions: deletions === '-' ? 0 : parseInt(deletions, 10),
        });
      }
    }

    // Parse file status
    const statusLines = statusStdout.trim().split('\n').filter(Boolean);
    const changes: FileChange[] = [];

    for (const line of statusLines) {
      const [statusCode, ...pathParts] = line.split('\t');
      const filePath = pathParts.join('\t'); // Handle paths with tabs (unlikely but safe)

      if (!filePath) continue;

      let status: FileChange['status'];
      switch (statusCode.charAt(0)) {
        case 'A':
          status = 'added';
          break;
        case 'D':
          status = 'deleted';
          break;
        case 'R':
          status = 'renamed';
          break;
        case 'M':
        default:
          status = 'modified';
          break;
      }

      const stats = statsMap.get(filePath) || { additions: 0, deletions: 0 };

      changes.push({
        path: filePath,
        status,
        additions: stats.additions,
        deletions: stats.deletions,
      });
    }

    // Sort by path
    changes.sort((a, b) => a.path.localeCompare(b.path));

    // Calculate totals
    const totalAdditions = changes.reduce((sum, c) => sum + c.additions, 0);
    const totalDeletions = changes.reduce((sum, c) => sum + c.deletions, 0);

    return NextResponse.json({
      branch: currentBranch,
      changes,
      totals: {
        files: changes.length,
        additions: totalAdditions,
        deletions: totalDeletions,
      },
    });
  } catch (error) {
    console.error('Error getting git changes:', error);
    return NextResponse.json(
      { error: 'Failed to get git changes' },
      { status: 500 }
    );
  }
}
