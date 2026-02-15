import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getProjectRoot } from '@/lib/project-root';

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
