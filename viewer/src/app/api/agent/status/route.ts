import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import {
  updateTaskHistoryEntry,
  determineStage,
  determineTaskStatus,
  type TaskStatus as HistoryTaskStatus,
  type TaskStage,
} from '@/lib/task-history';
import { getAgentStatusPath, getPrdJsonPath } from '@/lib/project-root';

// File paths
const STATUS_FILE = getAgentStatusPath();
const PRD_FILE = getPrdJsonPath();

interface AgentStatus {
  status: 'idle' | 'running' | 'waiting_network' | 'timeout' | 'error' | 'failed' | 'complete' | 'iteration_complete' | 'max_iterations';
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

function readStatusFile(): AgentStatus | null {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      const content = fs.readFileSync(STATUS_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch {
    // File doesn't exist or invalid JSON
  }
  return null;
}

function getProgressFromFiles(): { completed: number; total: number } {
  try {
    if (fs.existsSync(PRD_FILE)) {
      const content = fs.readFileSync(PRD_FILE, 'utf-8');
      const completed = (content.match(/"passes": true/g) || []).length;
      const total = (content.match(/"id": "DT-/g) || []).length;
      return { completed, total };
    }
  } catch {
    // Ignore errors
  }
  return { completed: 0, total: 0 };
}

function readPRD(): PRDJson | null {
  try {
    if (fs.existsSync(PRD_FILE)) {
      return JSON.parse(fs.readFileSync(PRD_FILE, 'utf-8'));
    }
  } catch {
    // Ignore
  }
  return null;
}

/**
 * Update task history based on agent status
 */
function syncTaskHistory(agentStatus: AgentStatus): void {
  try {
    const prd = readPRD();
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
        historyStatus = determineTaskStatus(baseStatus, false, tasksCompleted, tasksTotal);
        endTime = new Date().toISOString();
        break;
      case 'failed':
      case 'error':
        historyStatus = 'failed';
        endTime = new Date().toISOString();
        break;
      case 'max_iterations':
        historyStatus = tasksCompleted === tasksTotal ? 'waiting_merge' : 'partial';
        endTime = new Date().toISOString();
        break;
      case 'idle':
        // Don't update on idle
        return;
      default:
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

function getDefaultStatus(): AgentStatus {
  const progress = getProgressFromFiles();
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

// GET: Return current status (non-streaming)
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const stream = url.searchParams.get('stream') === 'true';

  if (!stream) {
    // Return current status as JSON
    const status = readStatusFile() || getDefaultStatus();
    return NextResponse.json(status);
  }

  // Stream mode: SSE
  const encoder = new TextEncoder();
  const { signal } = request;

  const responseStream = new ReadableStream({
    start(controller) {
      let lastStatus = readStatusFile();

      // Send initial status
      const initialStatus = lastStatus || getDefaultStatus();
      const initialEvent = {
        type: 'status',
        data: initialStatus,
        timestamp: Date.now(),
      };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(initialEvent)}\n\n`));

      // Poll for status changes
      const pollInterval = setInterval(() => {
        try {
          const currentStatus = readStatusFile();

          // Check if status file changed
          const currentJson = JSON.stringify(currentStatus);
          const lastJson = JSON.stringify(lastStatus);

          if (currentJson !== lastJson) {
            const event = {
              type: 'status',
              data: currentStatus || getDefaultStatus(),
              timestamp: Date.now(),
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            lastStatus = currentStatus;

            // Sync task history on status change
            if (currentStatus) {
              syncTaskHistory(currentStatus);
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
export async function DELETE() {
  try {
    // Find and kill BotoolAgent.sh process
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      // Find the BotoolAgent.sh process
      const { stdout } = await execAsync("pgrep -f 'BotoolAgent.sh' || true");
      const pids = stdout.trim().split('\n').filter(Boolean);

      if (pids.length === 0) {
        return NextResponse.json({ success: true, message: 'No agent process found' });
      }

      // Kill the processes
      for (const pid of pids) {
        try {
          await execAsync(`kill -9 ${pid}`);
        } catch {
          // Process might have already exited
        }
      }

      // Also kill any claude processes spawned by the agent
      try {
        await execAsync("pkill -9 -f 'claude --dangerously-skip-permissions' || true");
      } catch {
        // No matching processes
      }

      // Update status file
      const stoppedStatus: AgentStatus = {
        ...getDefaultStatus(),
        status: 'idle',
        message: 'Agent stopped by user',
      };
      fs.writeFileSync(STATUS_FILE, JSON.stringify(stoppedStatus, null, 2));

      return NextResponse.json({
        success: true,
        message: `Stopped agent process(es): ${pids.join(', ')}`,
        killedPids: pids,
      });
    } catch (error) {
      console.error('Error stopping agent:', error);
      return NextResponse.json(
        { error: 'Failed to stop agent process' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Failed to stop agent:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to stop agent' },
      { status: 500 }
    );
  }
}
