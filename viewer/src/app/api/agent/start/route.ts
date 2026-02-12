import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import { updateTaskHistoryEntry } from '@/lib/task-history';
import { getProjectRoot, getPrdJsonPath, getAgentScriptPath, getAgentPidPath, isPortableMode } from '@/lib/project-root';

const PROJECT_ROOT = getProjectRoot();
const PRD_PATH = getPrdJsonPath();
const PID_FILE = getAgentPidPath();

interface AgentPidInfo {
  pid: number;
  startedAt: string;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPidFile(): AgentPidInfo | null {
  try {
    if (fs.existsSync(PID_FILE)) {
      return JSON.parse(fs.readFileSync(PID_FILE, 'utf-8'));
    }
  } catch {
    // Ignore
  }
  return null;
}

function writePidFile(pid: number): void {
  const info: AgentPidInfo = {
    pid,
    startedAt: new Date().toISOString(),
  };
  fs.writeFileSync(PID_FILE, JSON.stringify(info, null, 2));
}

function cleanPidFile(): void {
  try {
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
    }
  } catch {
    // Ignore
  }
}

interface PRDJson {
  project?: string;
  description?: string;
  branchName?: string;
  devTasks?: Array<{ id: string; passes: boolean }>;
}

function readPRD(): PRDJson | null {
  try {
    if (fs.existsSync(PRD_PATH)) {
      return JSON.parse(fs.readFileSync(PRD_PATH, 'utf-8'));
    }
  } catch {
    // Ignore
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const { maxIterations = 10 } = await request.json().catch(() => ({}));

    const SCRIPT_PATH = getAgentScriptPath();

    // Check if script exists
    if (!fs.existsSync(SCRIPT_PATH)) {
      return NextResponse.json(
        { error: 'BotoolAgent.sh not found', path: SCRIPT_PATH },
        { status: 404 }
      );
    }

    // Check if prd.json exists
    if (!fs.existsSync(PRD_PATH)) {
      return NextResponse.json(
        { error: 'prd.json not found. Please convert a PRD first.' },
        { status: 400 }
      );
    }

    // Check if agent is already running (PID lock)
    const existingPid = readPidFile();
    if (existingPid && isProcessAlive(existingPid.pid)) {
      return NextResponse.json(
        {
          error: '代理已在运行中',
          pid: existingPid.pid,
          startedAt: existingPid.startedAt,
        },
        { status: 409 }
      );
    }
    // Clean stale PID file if process is dead
    if (existingPid) {
      cleanPidFile();
    }

    // Read PRD to get task info
    const prd = readPRD();
    if (prd) {
      const tasks = prd.devTasks || [];
      const tasksCompleted = tasks.filter(t => t.passes).length;
      const tasksTotal = tasks.length;

      // Update task history entry - mark as running
      updateTaskHistoryEntry({
        id: prd.branchName || `task-${Date.now()}`,
        name: prd.project || 'Unknown Task',
        description: prd.description,
        branchName: prd.branchName,
        status: 'running',
        stage: 3, // Coding stage
        tasksCompleted,
        tasksTotal,
        startTime: new Date().toISOString(),
      });
    }

    // Start BotoolAgent.sh in background
    // In portable mode, pass --project-dir so the agent operates on the user's project
    const args = [SCRIPT_PATH, String(maxIterations)];
    if (isPortableMode()) {
      args.push('--project-dir', PROJECT_ROOT);
    }

    const child = spawn('bash', args, {
      cwd: PROJECT_ROOT,
      detached: true,
      stdio: 'ignore',
    });

    // Allow the parent process to exit independently of the child
    child.unref();

    // Write PID lock file
    if (child.pid) {
      writePidFile(child.pid);
    }

    return NextResponse.json({
      success: true,
      message: 'BotoolAgent started in background',
      pid: child.pid,
      maxIterations,
    });
  } catch (error) {
    console.error('Failed to start agent:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start agent' },
      { status: 500 }
    );
  }
}
