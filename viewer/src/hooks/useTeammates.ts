'use client';

import { useMemo } from 'react';
import type { PrdData, DevTask } from './useFileWatcher';
import type { AgentStatus } from './useAgentStatus';

// ---------- Public types ----------

export interface TeammateInfo {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'pending';
  startedAt?: string;
  completedAt?: string;
}

export interface UseTeammatesReturn {
  batchIndex: number;
  teammates: TeammateInfo[];
  isParallel: boolean;
  source: 'file' | 'inferred';
}

// ---------- Internal types ----------

interface DevTaskWithDeps extends DevTask {
  dependsOn?: string[];
}

interface TeammatesFileData {
  batchIndex: number;
  batchTasks: string[];
  teammates: TeammateInfo[];
  updatedAt: string;
}

// ---------- Constants ----------

const STALE_THRESHOLD_MS = 60_000; // 60 seconds

const ACTIVE_AGENT_STATUSES = new Set([
  'running',
  'starting',
  'waiting_network',
  'iteration_complete',
  'session_done',
]);

// ---------- Helpers ----------

function isAgentActive(agentStatus: AgentStatus): boolean {
  return ACTIVE_AGENT_STATUSES.has(agentStatus.status);
}

function parseTeammatesFile(content: string): TeammatesFileData | null {
  try {
    const parsed = JSON.parse(content);
    if (
      typeof parsed.batchIndex === 'number' &&
      Array.isArray(parsed.teammates) &&
      typeof parsed.updatedAt === 'string'
    ) {
      return parsed as TeammatesFileData;
    }
  } catch {
    // invalid JSON
  }
  return null;
}

function isStale(updatedAt: string): boolean {
  const updatedTime = new Date(updatedAt).getTime();
  if (Number.isNaN(updatedTime)) return true;
  return Date.now() - updatedTime > STALE_THRESHOLD_MS;
}

/**
 * BFS topological sort: group tasks into batches by DAG layers.
 * Tasks with no unresolved dependencies go into the earliest possible batch.
 */
function computeBatches(tasks: DevTaskWithDeps[]): DevTaskWithDeps[][] {
  if (tasks.length === 0) return [];

  const taskMap = new Map<string, DevTaskWithDeps>();
  for (const t of tasks) {
    taskMap.set(t.id, t);
  }

  // Build in-degree and adjacency for BFS layer traversal
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // dep -> tasks that depend on dep

  for (const t of tasks) {
    if (!inDegree.has(t.id)) inDegree.set(t.id, 0);
    const deps = t.dependsOn ?? [];
    for (const dep of deps) {
      // Only count dependencies that exist in the task list
      if (taskMap.has(dep)) {
        inDegree.set(t.id, (inDegree.get(t.id) ?? 0) + 1);
        if (!dependents.has(dep)) dependents.set(dep, []);
        dependents.get(dep)!.push(t.id);
      }
    }
  }

  const batches: DevTaskWithDeps[][] = [];
  let queue = tasks.filter((t) => (inDegree.get(t.id) ?? 0) === 0);

  while (queue.length > 0) {
    batches.push(queue);
    const nextQueue: DevTaskWithDeps[] = [];

    for (const t of queue) {
      for (const depId of dependents.get(t.id) ?? []) {
        const newDeg = (inDegree.get(depId) ?? 1) - 1;
        inDegree.set(depId, newDeg);
        if (newDeg === 0) {
          const depTask = taskMap.get(depId);
          if (depTask) nextQueue.push(depTask);
        }
      }
    }

    queue = nextQueue;
  }

  return batches;
}

/**
 * Infer teammate information from PRD data by topological sorting.
 * Finds the first batch with incomplete tasks and treats those as the current batch.
 */
function inferFromPrd(prdData: PrdData): UseTeammatesReturn {
  const tasks = prdData.devTasks as DevTaskWithDeps[];
  const batches = computeBatches(tasks);

  if (batches.length === 0) {
    return { batchIndex: 0, teammates: [], isParallel: false, source: 'inferred' };
  }

  // Find the first batch that contains at least one incomplete task
  let currentBatchIdx = batches.length - 1; // default to last batch
  for (let i = 0; i < batches.length; i++) {
    const hasIncomplete = batches[i].some((t) => !t.passes);
    if (hasIncomplete) {
      currentBatchIdx = i;
      break;
    }
  }

  const currentBatch = batches[currentBatchIdx];
  const teammates: TeammateInfo[] = currentBatch.map((t) => ({
    id: t.id,
    status: t.passes ? 'completed' : 'running',
  }));

  return {
    batchIndex: currentBatchIdx,
    teammates,
    isParallel: teammates.length >= 2,
    source: 'inferred',
  };
}

// ---------- Default return ----------

const DEFAULT_RETURN: UseTeammatesReturn = {
  batchIndex: 0,
  teammates: [],
  isParallel: false,
  source: 'inferred',
};

// ---------- Hook ----------

export function useTeammates(
  teammatesFileContent: string | null,
  prdData: PrdData | null,
  agentStatus: AgentStatus,
): UseTeammatesReturn {
  // Memoize the topological sort batches so they are only recomputed when prdData changes
  const inferredResult = useMemo<UseTeammatesReturn | null>(() => {
    if (!prdData) return null;
    return inferFromPrd(prdData);
  }, [prdData]);

  return useMemo<UseTeammatesReturn>(() => {
    // 1. Try to parse the teammates.json file
    if (teammatesFileContent) {
      const fileData = parseTeammatesFile(teammatesFileContent);

      if (fileData) {
        // Check for staleness: if updatedAt > 60s AND agent is still running, fallback
        const stale = isStale(fileData.updatedAt) && isAgentActive(agentStatus);

        if (!stale) {
          return {
            batchIndex: fileData.batchIndex,
            teammates: fileData.teammates,
            isParallel: fileData.teammates.length >= 2,
            source: 'file',
          };
        }
        // Stale — fall through to inferred
      }
    }

    // 2. Fallback: infer from PRD data
    if (inferredResult) {
      return inferredResult;
    }

    // 3. No data at all
    return DEFAULT_RETURN;
  }, [teammatesFileContent, agentStatus, inferredResult]);
}
