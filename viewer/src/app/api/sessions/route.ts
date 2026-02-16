import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getArchiveDir, getProjectRoot } from '@/lib/project-root';

const execAsync = promisify(exec);

const ARCHIVE_DIR = getArchiveDir();

// Task status type - more detailed than before
export type TaskStatus = 'running' | 'completed' | 'partial' | 'failed' | 'waiting_merge';

// Task stage type
export type TaskStage = 1 | 2 | 3 | 4 | 5;

export interface SessionItem {
  id: string;
  name: string;
  date: string;
  status: 'completed' | 'failed' | 'partial';
  tasksCompleted: number;
  tasksTotal: number;
  branchName?: string;
  description?: string;
}

// Extended session item with more details for TaskHistory
export interface ExtendedSessionItem extends SessionItem {
  taskStatus: TaskStatus;
  stage: TaskStage;
  startTime: string;
  endTime?: string;
  isMerged: boolean;
  prUrl?: string;
}

interface ArchivedPRD {
  project?: string;
  description?: string;
  branchName?: string;
  stage?: TaskStage;
  startTime?: string;
  endTime?: string;
  devTasks?: Array<{
    id: string;
    title: string;
    passes: boolean;
  }>;
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
 * Check if a branch has been merged into main
 */
async function isBranchMerged(branchName: string): Promise<boolean> {
  if (!isSafeGitRef(branchName)) return false;
  try {
    // Check if the branch exists in merged branches list
    const { stdout } = await execAsync(
      `git branch --merged main | grep -w "${branchName}" || true`,
      { cwd: getProjectRoot() }
    );
    return stdout.trim().includes(branchName);
  } catch {
    return false;
  }
}

/**
 * Get PR URL for a branch if it exists
 */
async function getPRUrl(branchName: string): Promise<string | undefined> {
  if (!isSafeGitRef(branchName)) return undefined;
  try {
    const { stdout } = await execAsync(
      `gh pr view ${branchName} --json url --jq '.url' 2>/dev/null || true`,
      { cwd: getProjectRoot() }
    );
    const url = stdout.trim();
    return url || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Determine task stage based on progress
 */
function determineStage(tasksCompleted: number, tasksTotal: number, status: SessionItem['status']): TaskStage {
  if (status === 'completed') return 5;
  if (tasksTotal === 0) return 1;

  const progress = tasksCompleted / tasksTotal;
  if (progress === 0) return 1;
  if (progress < 0.3) return 2;
  if (progress < 0.8) return 3;
  if (progress < 1) return 4;
  return 5;
}

/**
 * Determine detailed task status
 */
function determineTaskStatus(
  status: SessionItem['status'],
  isMerged: boolean,
  tasksCompleted: number,
  tasksTotal: number
): TaskStatus {
  if (status === 'completed' && !isMerged) return 'waiting_merge';
  if (status === 'completed' && isMerged) return 'completed';
  if (status === 'failed') return 'failed';
  if (tasksCompleted > 0 && tasksCompleted < tasksTotal) return 'partial';
  return 'running';
}

function parseSession(dirName: string, dirPath: string): SessionItem | null {
  try {
    // Session directories are expected to be named like: YYYY-MM-DD-project-name
    // or just project-name with a prd.json inside
    const prdJsonPath = path.join(dirPath, 'prd.json');

    if (!fs.existsSync(prdJsonPath)) {
      return null;
    }

    const prdJson: ArchivedPRD = JSON.parse(fs.readFileSync(prdJsonPath, 'utf-8'));
    const stats = fs.statSync(prdJsonPath);

    const tasks = prdJson.devTasks || [];
    const tasksCompleted = tasks.filter(t => t.passes).length;
    const tasksTotal = tasks.length;

    // Determine status
    let status: SessionItem['status'] = 'partial';
    if (tasksTotal > 0) {
      if (tasksCompleted === tasksTotal) {
        status = 'completed';
      } else if (tasksCompleted === 0) {
        status = 'failed';
      }
    }

    // Try to extract date from directory name or use file modification time
    let date = stats.mtime.toISOString();
    const dateMatch = dirName.match(/^(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      date = new Date(dateMatch[1]).toISOString();
    }

    return {
      id: dirName,
      name: prdJson.project || dirName,
      date,
      status,
      tasksCompleted,
      tasksTotal,
      branchName: prdJson.branchName,
      description: prdJson.description,
    };
  } catch {
    return null;
  }
}

async function parseExtendedSession(dirName: string, dirPath: string): Promise<ExtendedSessionItem | null> {
  const baseSession = parseSession(dirName, dirPath);
  if (!baseSession) return null;

  // Read PRD for additional info
  const prdJsonPath = path.join(dirPath, 'prd.json');
  let prdJson: ArchivedPRD = {};
  try {
    prdJson = JSON.parse(fs.readFileSync(prdJsonPath, 'utf-8'));
  } catch {
    // Ignore
  }

  // Check merge status + PR URL in parallel
  const [isMerged, prUrl] = baseSession.branchName
    ? await Promise.all([
        isBranchMerged(baseSession.branchName),
        getPRUrl(baseSession.branchName),
      ])
    : [false, undefined];

  // Determine stage
  const stage = prdJson.stage || determineStage(
    baseSession.tasksCompleted,
    baseSession.tasksTotal,
    baseSession.status
  );

  // Determine detailed task status
  const taskStatus = determineTaskStatus(
    baseSession.status,
    isMerged,
    baseSession.tasksCompleted,
    baseSession.tasksTotal
  );

  return {
    ...baseSession,
    taskStatus,
    stage,
    startTime: prdJson.startTime || baseSession.date,
    endTime: prdJson.endTime,
    isMerged,
    prUrl,
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const extended = searchParams.get('extended') === 'true';

    // Check if archive directory exists
    if (!fs.existsSync(ARCHIVE_DIR)) {
      return NextResponse.json({ sessions: [] });
    }

    // Read all directories in archive
    const entries = fs.readdirSync(ARCHIVE_DIR, { withFileTypes: true });
    const sessionDirs = entries.filter(entry => entry.isDirectory());

    if (extended) {
      // Return extended session info with merge status — run ALL in parallel
      const results = await Promise.all(
        sessionDirs.map(dir => {
          const dirPath = path.join(ARCHIVE_DIR, dir.name);
          return parseExtendedSession(dir.name, dirPath);
        })
      );
      const extendedSessions = results.filter((s): s is ExtendedSessionItem => s !== null);

      // Sort by date, newest first
      extendedSessions.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

      return NextResponse.json({ sessions: extendedSessions, extended: true });
    } else {
      // Return basic session info (legacy behavior)
      const sessions: SessionItem[] = [];

      for (const dir of sessionDirs) {
        const dirPath = path.join(ARCHIVE_DIR, dir.name);
        const session = parseSession(dir.name, dirPath);
        if (session) {
          sessions.push(session);
        }
      }

      // Sort by date, newest first
      sessions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      return NextResponse.json({ sessions });
    }
  } catch (error) {
    console.error('Error reading archive directory:', error);
    return NextResponse.json(
      { error: 'Failed to read archive directory' },
      { status: 500 }
    );
  }
}
