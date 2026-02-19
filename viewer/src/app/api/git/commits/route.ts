import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { getProjectRoot, getProjectPrdJsonPath, normalizeProjectId } from '@/lib/project-root';

const execAsync = promisify(exec);

const PROJECT_ROOT = getProjectRoot();

interface Commit {
  hash: string;
  shortHash: string;
  message: string;
  date: string;
  author: string;
  taskId: string | null; // Extracted from "feat: [DT-XXX]" pattern
}

function isSafeGitRef(ref: string): boolean {
  return (
    /^[A-Za-z0-9._/-]+$/.test(ref) &&
    !ref.startsWith('-') &&
    !ref.includes('..') &&
    !ref.includes('//')
  );
}

/**
 * Resolve the feature branch name for a project.
 * Reads branchName from prd.json when projectId is given; falls back to git branch --show-current.
 */
async function resolveBranch(projectId?: string | null): Promise<string | null> {
  const safeId = normalizeProjectId(projectId);
  if (safeId) {
    try {
      const prdPath = getProjectPrdJsonPath(safeId);
      const content = await fs.readFile(prdPath, 'utf-8');
      const prd = JSON.parse(content);
      if (prd.branchName && isSafeGitRef(prd.branchName)) {
        return prd.branchName;
      }
    } catch {
      // fall through
    }
  }
  try {
    const { stdout } = await execAsync('git branch --show-current', { cwd: PROJECT_ROOT });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const projectId = request.nextUrl.searchParams.get('projectId') || undefined;

    // Resolve branch: projectId → prd.json → branchName, or fall back to git
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

    // Get commits on this branch that are not on main
    // Format: hash|shortHash|message|date|author
    const { stdout: logStdout } = await execAsync(
      `git log main..${currentBranch} --pretty=format:"%H|%h|%s|%ci|%an" 2>/dev/null || git log -20 --pretty=format:"%H|%h|%s|%ci|%an"`,
      { cwd: PROJECT_ROOT, maxBuffer: 10 * 1024 * 1024 }
    );

    const commits: Commit[] = [];
    const lines = logStdout.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      const [hash, shortHash, message, date, author] = line.split('|');
      if (!hash) continue;

      // Extract task ID from message (e.g., "feat: [DT-019] - Title")
      const taskIdMatch = message.match(/\[DT-\d+\]/);
      const taskId = taskIdMatch ? taskIdMatch[0].slice(1, -1) : null;

      commits.push({
        hash,
        shortHash,
        message,
        date,
        author,
        taskId,
      });
    }

    return NextResponse.json({
      branch: currentBranch,
      commits,
      count: commits.length,
    });
  } catch (error) {
    console.error('Error getting git commits:', error);
    return NextResponse.json(
      { error: 'Failed to get git commits' },
      { status: 500 }
    );
  }
}
