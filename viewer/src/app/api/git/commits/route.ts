import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

// Get project root (parent of viewer directory)
const PROJECT_ROOT = path.join(process.cwd(), '..');

interface Commit {
  hash: string;
  shortHash: string;
  message: string;
  date: string;
  author: string;
  taskId: string | null; // Extracted from "feat: [DT-XXX]" pattern
}

export async function GET() {
  try {
    // Get the current branch name
    const { stdout: branchStdout } = await execAsync('git branch --show-current', {
      cwd: PROJECT_ROOT,
    });
    const currentBranch = branchStdout.trim();

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
