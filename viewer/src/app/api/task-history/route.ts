import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Path to task history file
const PROJECT_ROOT = process.cwd();
const TASKS_DIR = path.join(PROJECT_ROOT, '..', 'tasks');
const TASK_HISTORY_FILE = path.join(TASKS_DIR, '.task-history.json');

// Task status type
export type TaskStatus = 'running' | 'completed' | 'partial' | 'failed' | 'waiting_merge';

// Task stage type
export type TaskStage = 1 | 2 | 3 | 4 | 5;

// Task history entry
export interface TaskHistoryEntry {
  id: string;
  name: string;
  description?: string;
  branchName?: string;
  status: TaskStatus;
  stage: TaskStage;
  tasksCompleted: number;
  tasksTotal: number;
  startTime: string;
  endTime?: string;
  isMerged: boolean;
  prUrl?: string;
  lastUpdated: string;
}

// Task history data structure
interface TaskHistoryData {
  version: number;
  entries: TaskHistoryEntry[];
}

/**
 * Read task history from file
 */
function readTaskHistory(): TaskHistoryData {
  try {
    if (fs.existsSync(TASK_HISTORY_FILE)) {
      const content = fs.readFileSync(TASK_HISTORY_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.error('Error reading task history:', error);
  }
  return { version: 1, entries: [] };
}

/**
 * Write task history to file
 */
function writeTaskHistory(data: TaskHistoryData): void {
  try {
    // Ensure tasks directory exists
    if (!fs.existsSync(TASKS_DIR)) {
      fs.mkdirSync(TASKS_DIR, { recursive: true });
    }
    fs.writeFileSync(TASK_HISTORY_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error writing task history:', error);
    throw error;
  }
}

/**
 * Check if a branch has been merged into main
 */
async function isBranchMerged(branchName: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(
      `git branch --merged main | grep -w "${branchName}" || true`,
      { cwd: path.join(PROJECT_ROOT, '..') }
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
  try {
    const { stdout } = await execAsync(
      `gh pr view ${branchName} --json url --jq '.url' 2>/dev/null || true`,
      { cwd: path.join(PROJECT_ROOT, '..') }
    );
    const url = stdout.trim();
    return url || undefined;
  } catch {
    return undefined;
  }
}

/**
 * GET /api/task-history
 * Returns all task history entries
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const refresh = searchParams.get('refresh') === 'true';

    const history = readTaskHistory();

    // Optionally refresh merge status and PR URLs
    if (refresh) {
      for (const entry of history.entries) {
        if (entry.branchName) {
          entry.isMerged = await isBranchMerged(entry.branchName);
          entry.prUrl = await getPRUrl(entry.branchName);

          // Update status if merged
          if (entry.isMerged && entry.status === 'waiting_merge') {
            entry.status = 'completed';
          }
        }
      }
      writeTaskHistory(history);
    }

    return NextResponse.json({
      entries: history.entries,
      total: history.entries.length,
    });
  } catch (error) {
    console.error('Error getting task history:', error);
    return NextResponse.json(
      { error: 'Failed to get task history' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/task-history
 * Create or update a task history entry
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      id,
      name,
      description,
      branchName,
      status,
      stage,
      tasksCompleted,
      tasksTotal,
      startTime,
      endTime,
      isMerged,
      prUrl,
    } = body;

    if (!id || !name || !status || !stage) {
      return NextResponse.json(
        { error: 'Missing required fields: id, name, status, stage' },
        { status: 400 }
      );
    }

    const history = readTaskHistory();
    const now = new Date().toISOString();

    // Check if entry already exists
    const existingIndex = history.entries.findIndex(e => e.id === id);

    const entry: TaskHistoryEntry = {
      id,
      name,
      description,
      branchName,
      status,
      stage,
      tasksCompleted: tasksCompleted ?? 0,
      tasksTotal: tasksTotal ?? 0,
      startTime: startTime ?? (existingIndex >= 0 ? history.entries[existingIndex].startTime : now),
      endTime,
      isMerged: isMerged ?? false,
      prUrl,
      lastUpdated: now,
    };

    if (existingIndex >= 0) {
      // Update existing entry
      history.entries[existingIndex] = entry;
    } else {
      // Add new entry
      history.entries.unshift(entry);
    }

    writeTaskHistory(history);

    return NextResponse.json({
      success: true,
      entry,
    });
  } catch (error) {
    console.error('Error updating task history:', error);
    return NextResponse.json(
      { error: 'Failed to update task history' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/task-history
 * Delete a task history entry
 */
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'Missing required parameter: id' },
        { status: 400 }
      );
    }

    const history = readTaskHistory();
    const existingIndex = history.entries.findIndex(e => e.id === id);

    if (existingIndex < 0) {
      return NextResponse.json(
        { error: 'Task history entry not found' },
        { status: 404 }
      );
    }

    // Remove entry
    const deleted = history.entries.splice(existingIndex, 1)[0];
    writeTaskHistory(history);

    return NextResponse.json({
      success: true,
      deleted,
    });
  } catch (error) {
    console.error('Error deleting task history:', error);
    return NextResponse.json(
      { error: 'Failed to delete task history' },
      { status: 500 }
    );
  }
}
