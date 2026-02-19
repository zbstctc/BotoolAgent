'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { UseTeammatesReturn, TeammateInfo } from './useTeammates';

// ---------- Public types ----------

export interface TaskTiming {
  taskId: string;
  startTime: number;   // Unix ms
  endTime?: number;     // Unix ms, undefined if in-progress
  duration: number;     // seconds
  batchIndex: number;   // batch this task belongs to
}

export interface UseTaskTimingsReturn {
  timings: TaskTiming[];
  batches: TaskTiming[][];     // timings grouped by batchIndex
  avgTime: number;             // average completed-task duration (seconds)
  currentTaskElapsed: number;  // elapsed time for the current task (seconds)
  totalElapsed: number;        // total agent run time (seconds)
  maxDuration: number;         // longest completed-task duration (seconds, for bar scaling)
}

// ---------- Internal types ----------

/** Parsed entry from a progress-log `## YYYY-MM-DD HH:MM - DT-XXX` line */
interface ProgressEntry {
  taskIds: string[];
  timestamp: number; // Unix ms (0 when time portion is missing)
}

// ---------- Constants ----------

const EMPTY_RETURN: UseTaskTimingsReturn = {
  timings: [],
  batches: [],
  avgTime: 0,
  currentTaskElapsed: 0,
  totalElapsed: 0,
  maxDuration: 0,
};

// ---------- Helpers ----------

/**
 * Parse `## YYYY-MM-DD HH:MM - DT-XXX[, DT-YYY ...]` lines from progressLog.
 * Supports two timestamp formats:
 *   - `## 2026-02-04 18:45 - DT-003`        (date + time)
 *   - `## 2026-02-02 - DT-001`              (date only, time defaults to 00:00)
 */
function parseProgressLog(progressLog: string): ProgressEntry[] {
  const entries: ProgressEntry[] = [];
  // Match both `## YYYY-MM-DD HH:MM - DT-XXX` and `## YYYY-MM-DD - DT-XXX`
  const lineRegex = /^## (\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?\s+-\s+(DT-\d+(?:\s*,\s*DT-\d+)*)/gm;

  let match: RegExpExecArray | null;
  while ((match = lineRegex.exec(progressLog)) !== null) {
    const dateStr = match[1];
    const timeStr = match[2] || '00:00';
    const tasksPart = match[3];

    const timestamp = new Date(`${dateStr}T${timeStr}:00`).getTime();
    const taskIds = tasksPart.split(',').map((s) => s.trim());

    entries.push({ taskIds, timestamp });
  }

  return entries;
}

/**
 * Merge the current batch's teammates into an accumulated map.
 * New task IDs are added; existing entries are preserved (history survives batch transitions).
 */
function mergeBatchIntoHistory(
  accMap: Map<string, number>,
  teammates: UseTeammatesReturn,
): void {
  for (const tm of teammates.teammates) {
    if (!accMap.has(tm.id)) {
      accMap.set(tm.id, teammates.batchIndex);
    }
  }
}

/**
 * Build timings from teammates.json data (source of truth when available).
 * Returns a map of taskId -> partial TaskTiming (without batchIndex filled).
 */
function timingsFromTeammates(
  teammates: TeammateInfo[],
  now: number,
): Map<string, { startTime: number; endTime?: number; duration: number }> {
  const map = new Map<string, { startTime: number; endTime?: number; duration: number }>();

  for (const tm of teammates) {
    if (!tm.startedAt) continue;

    const startTime = new Date(tm.startedAt).getTime();
    if (Number.isNaN(startTime)) continue;

    let endTime: number | undefined;
    let duration: number;

    if (tm.completedAt) {
      endTime = new Date(tm.completedAt).getTime();
      if (Number.isNaN(endTime)) {
        endTime = undefined;
        duration = Math.max(0, (now - startTime) / 1000);
      } else {
        duration = Math.max(0, (endTime - startTime) / 1000);
      }
    } else {
      // in-progress
      duration = Math.max(0, (now - startTime) / 1000);
    }

    map.set(tm.id, { startTime, endTime, duration });
  }

  return map;
}

/**
 * Build timings from progress-log entries.
 * Adjacent entries define the end/start boundary:
 * entry[i].timestamp is the startTime; entry[i+1].timestamp is the endTime.
 * The last entry has no endTime (still in progress or unknown).
 */
function timingsFromProgressLog(
  entries: ProgressEntry[],
  now: number,
): Map<string, { startTime: number; endTime?: number; duration: number }> {
  const map = new Map<string, { startTime: number; endTime?: number; duration: number }>();

  // Skip entries without usable timestamps
  const usable = entries.filter((e) => e.timestamp > 0);
  if (usable.length === 0) return map;

  for (let i = 0; i < usable.length; i++) {
    const entry = usable[i];
    const nextEntry = usable[i + 1];

    const startTime = entry.timestamp;
    let endTime: number | undefined;
    let duration: number;

    if (nextEntry) {
      endTime = nextEntry.timestamp;
      duration = Math.max(0, (endTime - startTime) / 1000);
    } else {
      // Last entry - in progress
      duration = Math.max(0, (now - startTime) / 1000);
    }

    for (const taskId of entry.taskIds) {
      if (!map.has(taskId)) {
        map.set(taskId, { startTime, endTime, duration });
      }
    }
  }

  return map;
}

// ---------- Hook ----------

export function useTaskTimings(
  progressLog: string,
  teammates: UseTeammatesReturn,
  currentTaskId: string | null,
  agentStartTimestamp?: string,
  projectId?: string,
): UseTaskTimingsReturn {
  // Accumulated batch history: persists task→batchIndex across batch transitions
  // Reset when projectId changes to prevent cross-project batch data contamination
  const batchHistoryRef = useRef<Map<string, number>>(new Map());
  const prevProjectIdRef = useRef<string | undefined>(undefined);
  if (prevProjectIdRef.current !== projectId) {
    batchHistoryRef.current = new Map();
    prevProjectIdRef.current = projectId;
  }

  // Tick counter for 1-second updates of currentTaskElapsed
  const [tick, setTick] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Set up 1-second interval when there is a current task
  useEffect(() => {
    if (currentTaskId) {
      intervalRef.current = setInterval(() => {
        setTick((t) => t + 1);
      }, 1000);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [currentTaskId]);

  // Parse the agent start time once
  const agentStartMs = useMemo(() => {
    if (!agentStartTimestamp) return 0;
    const t = new Date(agentStartTimestamp).getTime();
    return Number.isNaN(t) ? 0 : t;
  }, [agentStartTimestamp]);

  // Parse progress log entries (memoized)
  const progressEntries = useMemo(() => parseProgressLog(progressLog), [progressLog]);

  // Merge current batch into accumulated history (runs during render, safe for refs)
  // useCallback gives us a stable reference so we can call it from useMemo safely
  const getAccumulatedBatchMap = useCallback((): Map<string, number> => {
    mergeBatchIntoHistory(batchHistoryRef.current, teammates);
    return batchHistoryRef.current;
  }, [teammates]);

  // Compute all derived values, including the tick-dependent currentTaskElapsed
  return useMemo(() => {
    const now = Date.now();
    // Merge current batch into history (safe to call in useMemo since it only mutates a ref)
    const batchMap = getAccumulatedBatchMap();

    // --- Collect all known task IDs ---
    const allTaskIds = new Set<string>();
    for (const tm of teammates.teammates) {
      allTaskIds.add(tm.id);
    }
    for (const entry of progressEntries) {
      for (const id of entry.taskIds) {
        allTaskIds.add(id);
      }
    }

    if (allTaskIds.size === 0) {
      return EMPTY_RETURN;
    }

    // --- Build timing data from each source ---
    const fromTeammates = timingsFromTeammates(teammates.teammates, now);
    const fromProgress = timingsFromProgressLog(progressEntries, now);

    // --- Count completed tasks for fallback calculation ---
    const completedTeammateIds = new Set(
      teammates.teammates.filter((tm) => tm.status === 'completed').map((tm) => tm.id),
    );

    // --- Total elapsed ---
    const totalElapsed = agentStartMs > 0 ? Math.max(0, (now - agentStartMs) / 1000) : 0;

    // --- Fallback: uniform distribution ---
    const completedCount = completedTeammateIds.size;
    const fallbackDuration =
      completedCount > 0 && totalElapsed > 0 ? totalElapsed / completedCount : 0;

    // --- Merge timings (teammates > progressLog > fallback) ---
    const timings: TaskTiming[] = [];

    for (const taskId of allTaskIds) {
      const tmData = fromTeammates.get(taskId);
      const plData = fromProgress.get(taskId);

      let startTime: number;
      let endTime: number | undefined;
      let duration: number;

      if (tmData) {
        // Source 1: teammates.json (highest priority)
        startTime = tmData.startTime;
        endTime = tmData.endTime;
        duration = tmData.duration;
      } else if (plData) {
        // Source 2: progress log
        startTime = plData.startTime;
        endTime = plData.endTime;
        duration = plData.duration;
      } else {
        // Source 3: fallback - uniform distribution from agent start
        startTime = agentStartMs || now;
        endTime = completedTeammateIds.has(taskId) ? now : undefined;
        duration = fallbackDuration;
      }

      const bi = batchMap.get(taskId) ?? 0;

      timings.push({
        taskId,
        startTime,
        endTime,
        duration,
        batchIndex: bi,
      });
    }

    // Sort by startTime, then by taskId for stability
    timings.sort((a, b) => a.startTime - b.startTime || a.taskId.localeCompare(b.taskId));

    // --- Group by batch ---
    const batchGroups = new Map<number, TaskTiming[]>();
    for (const t of timings) {
      const arr = batchGroups.get(t.batchIndex) ?? [];
      arr.push(t);
      batchGroups.set(t.batchIndex, arr);
    }
    // Sort batch keys and build 2D array
    const sortedBatchKeys = [...batchGroups.keys()].sort((a, b) => a - b);
    const batches: TaskTiming[][] = sortedBatchKeys.map((k) => batchGroups.get(k)!);

    // --- Completed task metrics ---
    const completedTimings = timings.filter((t) => t.endTime !== undefined);
    const sumCompleted = completedTimings.reduce((s, t) => s + t.duration, 0);
    const avgTime = completedTimings.length > 0 ? sumCompleted / completedTimings.length : 0;
    const maxDuration =
      completedTimings.length > 0 ? Math.max(...completedTimings.map((t) => t.duration)) : 0;

    // --- Current task elapsed ---
    let currentTaskElapsed = 0;
    if (currentTaskId) {
      const currentTiming = timings.find((t) => t.taskId === currentTaskId);
      if (currentTiming && !currentTiming.endTime) {
        currentTaskElapsed = Math.max(0, (now - currentTiming.startTime) / 1000);
      }
    }

    return {
      timings,
      batches,
      avgTime,
      currentTaskElapsed,
      totalElapsed,
      maxDuration,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    progressEntries,
    teammates,
    currentTaskId,
    agentStartMs,
    getAccumulatedBatchMap,
    tick, // triggers re-computation every second
  ]);
}
