import * as fs from 'fs';
import * as path from 'path';
import { getTasksDir } from '@/lib/project-root';

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
export interface TaskHistoryData {
  version: number;
  entries: TaskHistoryEntry[];
}

const TASKS_DIR = getTasksDir();
const TASK_HISTORY_FILE = path.join(TASKS_DIR, '.task-history.json');

/**
 * Read task history from file
 */
export function readTaskHistory(): TaskHistoryData {
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
export function writeTaskHistory(data: TaskHistoryData): void {
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
 * Determine task stage based on progress
 */
export function determineStage(
  tasksCompleted: number,
  tasksTotal: number,
  status: 'completed' | 'failed' | 'partial'
): TaskStage {
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
export function determineTaskStatus(
  status: 'completed' | 'failed' | 'partial',
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

/**
 * Update or create a task history entry
 */
export function updateTaskHistoryEntry(
  entry: Partial<TaskHistoryEntry> & { id: string; name: string }
): TaskHistoryEntry {
  const history = readTaskHistory();
  const now = new Date().toISOString();

  // Find existing entry
  const existingIndex = history.entries.findIndex(e => e.id === entry.id);
  const existing = existingIndex >= 0 ? history.entries[existingIndex] : null;

  // Create/update entry
  const updatedEntry: TaskHistoryEntry = {
    id: entry.id,
    name: entry.name,
    description: entry.description ?? existing?.description,
    branchName: entry.branchName ?? existing?.branchName,
    status: entry.status ?? existing?.status ?? 'running',
    stage: entry.stage ?? existing?.stage ?? 1,
    tasksCompleted: entry.tasksCompleted ?? existing?.tasksCompleted ?? 0,
    tasksTotal: entry.tasksTotal ?? existing?.tasksTotal ?? 0,
    startTime: entry.startTime ?? existing?.startTime ?? now,
    endTime: entry.endTime ?? existing?.endTime,
    isMerged: entry.isMerged ?? existing?.isMerged ?? false,
    prUrl: entry.prUrl ?? existing?.prUrl,
    lastUpdated: now,
  };

  if (existingIndex >= 0) {
    history.entries[existingIndex] = updatedEntry;
  } else {
    history.entries.unshift(updatedEntry);
  }

  writeTaskHistory(history);
  return updatedEntry;
}

/**
 * Delete a task history entry
 */
export function deleteTaskHistoryEntry(id: string): TaskHistoryEntry | null {
  const history = readTaskHistory();
  const existingIndex = history.entries.findIndex(e => e.id === id);

  if (existingIndex < 0) {
    return null;
  }

  const deleted = history.entries.splice(existingIndex, 1)[0];
  writeTaskHistory(history);
  return deleted;
}

/**
 * Get a task history entry by ID
 */
export function getTaskHistoryEntry(id: string): TaskHistoryEntry | null {
  const history = readTaskHistory();
  return history.entries.find(e => e.id === id) ?? null;
}
