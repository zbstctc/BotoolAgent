import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import {
  updateTaskHistoryEntry,
  determineStage,
  determineTaskStatus,
  type TaskStatus as HistoryTaskStatus,
  type TaskStage,
} from '@/lib/task-history';
import { getAgentStatusPath, getProjectPrdJsonPath, getAgentPidPath, getTasksDir, normalizeProjectId } from '@/lib/project-root';

interface AgentPidInfo {
  pid: number;
  startedAt: string;
}

function readPidFile(pidFile: string): AgentPidInfo | null {
  try {
    if (fs.existsSync(pidFile)) {
      return JSON.parse(fs.readFileSync(pidFile, 'utf-8'));
    }
  } catch {
    // Ignore
  }
  return null;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function cleanPidFile(pidFile: string): void {
  try {
    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
    }
  } catch {
    // Ignore
  }
}

/**
 * Check if agent process is alive. If status says "running" but process is dead,
 * update status to crashed and clean PID file.
 */
function checkAndHandleOrphan(status: AgentStatus, statusFile: string, pidFile: string): AgentStatus {
  const runningStatuses: AgentStatus['status'][] = ['running', 'starting', 'waiting_network', 'iteration_complete'];
  if (!runningStatuses.includes(status.status)) return status;

  const pidInfo = readPidFile(pidFile);
  if (!pidInfo) return status; // No PID file, can't verify

  if (!isProcessAlive(pidInfo.pid)) {
    // Process is dead but status says running → orphan detected
    cleanPidFile(pidFile);
    const crashedStatus: AgentStatus = {
      ...status,
      status: 'error',
      message: '代理异常退出（进程已终止）',
      timestamp: new Date().toISOString(),
    };
    // Update the status file
    try {
      fs.writeFileSync(statusFile, JSON.stringify(crashedStatus, null, 2));
    } catch {
      // Ignore write errors
    }
    return crashedStatus;
  }

  return status;
}

interface AgentStatus {
  status: 'idle' | 'running' | 'starting' | 'waiting_network' | 'timeout' | 'error' | 'failed' | 'stopped' | 'complete' | 'iteration_complete' | 'session_done' | 'max_iterations' | 'max_rounds' | 'wall_timeout';
  message: string;
  timestamp: string;
  iteration: number;
  maxIterations: number;
  completed: number;
  total: number;
  currentTask: string;
  retryCount: number;
  rateLimit?: {
    enabled: boolean;
    calls: number;
    maxCalls: number;
    windowRemaining: number;
  };
  circuitBreaker?: {
    enabled: boolean;
    noProgressCount: number;
    threshold: number;
    lastCompletedCount: number;
  };
  apiRateLimit?: {
    waiting: boolean;
    resetAt: number;
    remainingSeconds: number;
  };
}

interface PRDJson {
  project?: string;
  description?: string;
  branchName?: string;
  devTasks?: Array<{ id: string; passes: boolean }>;
}

function readStatusFile(statusFile: string): AgentStatus | null {
  try {
    if (fs.existsSync(statusFile)) {
      const content = fs.readFileSync(statusFile, 'utf-8');
      return JSON.parse(content);
    }
  } catch {
    // File doesn't exist or invalid JSON
  }
  return null;
}

function getProgressFromFiles(projectId?: string | null): { completed: number; total: number } {
  try {
    const prdFile = getProjectPrdJsonPath(projectId);
    if (fs.existsSync(prdFile)) {
      const content = fs.readFileSync(prdFile, 'utf-8');
      const completed = (content.match(/"passes": true/g) || []).length;
      const total = (content.match(/"id": "DT-/g) || []).length;
      return { completed, total };
    }
  } catch {
    // Ignore errors
  }
  return { completed: 0, total: 0 };
}

function readPRD(projectId?: string | null): PRDJson | null {
  try {
    const prdFile = getProjectPrdJsonPath(projectId);
    if (fs.existsSync(prdFile)) {
      return JSON.parse(fs.readFileSync(prdFile, 'utf-8'));
    }
  } catch {
    // Ignore
  }
  return null;
}

/**
 * Update task history based on agent status
 */
function syncTaskHistory(agentStatus: AgentStatus, projectId?: string | null): void {
  try {
    const prd = readPRD(projectId);
    if (!prd || !prd.branchName) return;

    const tasks = prd.devTasks || [];
    const tasksCompleted = tasks.filter(t => t.passes).length;
    const tasksTotal = tasks.length;

    // Map agent status to task history status
    let historyStatus: HistoryTaskStatus = 'running';
    let endTime: string | undefined;

    const baseStatus = tasksCompleted === tasksTotal
      ? 'completed'
      : tasksCompleted === 0
        ? 'failed'
        : 'partial';

    switch (agentStatus.status) {
      case 'complete':
      case 'session_done':
        historyStatus = determineTaskStatus(baseStatus, false, tasksCompleted, tasksTotal);
        endTime = new Date().toISOString();
        break;
      case 'failed':
      case 'error':
      case 'stopped':
        historyStatus = 'failed';
        endTime = new Date().toISOString();
        break;
      case 'max_iterations':
      case 'max_rounds':
      case 'wall_timeout':
      case 'timeout':
        historyStatus = tasksCompleted === tasksTotal ? 'waiting_merge' : 'partial';
        endTime = new Date().toISOString();
        break;
      case 'idle':
        // Don't update on idle
        return;
      default:
        // running, starting, waiting_network, iteration_complete
        historyStatus = 'running';
    }

    // Determine stage
    const stage: TaskStage = determineStage(tasksCompleted, tasksTotal, baseStatus);

    updateTaskHistoryEntry({
      id: prd.branchName,
      name: prd.project || 'Unknown Task',
      description: prd.description,
      branchName: prd.branchName,
      status: historyStatus,
      stage,
      tasksCompleted,
      tasksTotal,
      endTime,
    });
  } catch (error) {
    console.error('Error syncing task history:', error);
  }
}

function getDefaultStatus(projectId?: string | null): AgentStatus {
  const progress = getProgressFromFiles(projectId);
  return {
    status: 'idle',
    message: 'Agent not running',
    timestamp: new Date().toISOString(),
    iteration: 0,
    maxIterations: 0,
    completed: progress.completed,
    total: progress.total,
    currentTask: 'none',
    retryCount: 0,
  };
}

/**
 * Scan all project status files under tasks/
 */
function scanAllProjectStatuses(): Record<string, AgentStatus> {
  const results: Record<string, AgentStatus> = {};
  try {
    const tasksDir = getTasksDir();
    const entries = fs.readdirSync(tasksDir, { withFileTypes: true })
      .filter(d => d.isDirectory());
    for (const entry of entries) {
      const projId = entry.name;
      const statusPath = getAgentStatusPath(projId);
      if (fs.existsSync(statusPath)) {
        try {
          const s = JSON.parse(fs.readFileSync(statusPath, 'utf-8')) as AgentStatus;
          results[projId] = s;
        } catch {
          // Skip invalid status files
        }
      }
    }
  } catch {
    // Ignore filesystem errors
  }
  return results;
}

// GET: Return current status (non-streaming or SSE)
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const stream = url.searchParams.get('stream') === 'true';
  const rawProjectId = url.searchParams.get('projectId');

  // normalizeProjectId guards against path traversal; no ASCII-only restriction
  // so that Chinese / Unicode project names work correctly.
  const projectId = normalizeProjectId(rawProjectId);

  if (!stream) {
    // No projectId: return all project statuses
    if (!projectId) {
      return NextResponse.json(scanAllProjectStatuses());
    }
    // With projectId: return single project status with orphan detection
    const statusFile = getAgentStatusPath(projectId);
    const pidFile = getAgentPidPath(projectId);
    let status = readStatusFile(statusFile) || getDefaultStatus(projectId);
    status = checkAndHandleOrphan(status, statusFile, pidFile);
    return NextResponse.json(status);
  }

  // Stream mode: SSE (uses per-project paths when projectId provided)
  const statusFile = getAgentStatusPath(projectId);
  const pidFile = getAgentPidPath(projectId);
  const encoder = new TextEncoder();
  const { signal } = request;

  const responseStream = new ReadableStream({
    start(controller) {
      let lastStatus = readStatusFile(statusFile);

      // Send initial status
      const initialStatus = lastStatus || getDefaultStatus(projectId);
      const initialEvent = {
        type: 'status',
        data: initialStatus,
        timestamp: Date.now(),
      };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(initialEvent)}\n\n`));

      // Poll for status changes
      const pollInterval = setInterval(() => {
        try {
          let currentStatus = readStatusFile(statusFile);

          // Orphan detection: check if process is still alive
          if (currentStatus) {
            currentStatus = checkAndHandleOrphan(currentStatus, statusFile, pidFile);
          }

          // Check if status file changed
          const currentJson = JSON.stringify(currentStatus);
          const lastJson = JSON.stringify(lastStatus);

          if (currentJson !== lastJson) {
            const event = {
              type: 'status',
              data: currentStatus || getDefaultStatus(projectId),
              timestamp: Date.now(),
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            lastStatus = currentStatus;

            // Sync task history on status change
            if (currentStatus) {
              syncTaskHistory(currentStatus, projectId);
            }
          }
        } catch {
          // Ignore errors during polling
        }
      }, 500); // Poll every 500ms for faster updates

      // Heartbeat to keep connection alive
      const heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          // Connection closed
        }
      }, 15000);

      // Clean up on abort
      signal.addEventListener('abort', () => {
        clearInterval(pollInterval);
        clearInterval(heartbeatInterval);
        controller.close();
      });
    },
  });

  return new Response(responseStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

// DELETE: Stop the agent (kill the process)
export async function DELETE(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const rawProjectId = url.searchParams.get('projectId');

    const projectId = normalizeProjectId(rawProjectId);

    const pidFile = getAgentPidPath(projectId);
    const statusFile = getAgentStatusPath(projectId);
    const killedPids: number[] = [];

    // Prefer PID lock file to avoid killing unrelated Claude processes.
    const pidInfo = readPidFile(pidFile);
    if (pidInfo?.pid && isProcessAlive(pidInfo.pid)) {
      try {
        process.kill(pidInfo.pid, 'SIGTERM');
        killedPids.push(pidInfo.pid);
      } catch {
        // Ignore termination race conditions
      }

      // Allow graceful shutdown first.
      await new Promise((resolve) => setTimeout(resolve, 1500));

      if (isProcessAlive(pidInfo.pid)) {
        try {
          process.kill(pidInfo.pid, 'SIGKILL');
        } catch {
          // Ignore force-kill race conditions
        }
      }
    } else if (pidInfo) {
      // Stale PID lock.
      cleanPidFile(pidFile);
    }

    // Fallback if PID lock is missing and no projectId (legacy mode only).
    if (killedPids.length === 0 && !projectId) {
      try {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        const { stdout } = await execAsync("pgrep -f 'BotoolAgent.sh' || true");
        const pids = stdout
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((pid) => Number(pid))
          .filter((pid) => Number.isInteger(pid) && pid > 0);

        for (const pid of pids) {
          try {
            process.kill(pid, 'SIGKILL');
            killedPids.push(pid);
          } catch {
            // Process may already be gone
          }
        }
      } catch {
        // Ignore fallback lookup errors
      }
    }

    // Tmux session cleanup (per-project or legacy).
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      const sessionName = projectId ? `botool-teams-${projectId}` : 'botool-teams';
      await execAsync(`tmux kill-session -t ${sessionName} 2>/dev/null || true`);
    } catch {
      // Ignore tmux cleanup errors
    }

    cleanPidFile(pidFile);

    const stoppedStatus: AgentStatus = {
      ...getDefaultStatus(projectId),
      status: 'idle',
      message: 'Agent stopped by user',
    };
    try {
      fs.mkdirSync(path.dirname(statusFile), { recursive: true });
      fs.writeFileSync(statusFile, JSON.stringify(stoppedStatus, null, 2));
    } catch {
      // Ignore write errors
    }

    return NextResponse.json({
      success: true,
      message: killedPids.length > 0
        ? `Stopped agent process(es): ${killedPids.join(', ')}`
        : 'No running agent process found',
      killedPids,
    });
  } catch (error) {
    console.error('Failed to stop agent:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to stop agent' },
      { status: 500 }
    );
  }
}
