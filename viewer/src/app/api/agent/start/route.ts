import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import { updateTaskHistoryEntry } from '@/lib/task-history';
import { getProjectRoot, getPrdJsonPath, getProjectPrdJsonPath, getAgentScriptPath, getAgentTeamsScriptPath, getAgentPidPath, getAgentStatusPath, isPortableMode } from '@/lib/project-root';

const PROJECT_ROOT = getProjectRoot();
const PID_FILE = getAgentPidPath();
const STATUS_FILE = getAgentStatusPath();

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

function writeAgentStatus(fields: Record<string, unknown>): void {
  const status = {
    status: 'idle',
    message: '',
    timestamp: new Date().toISOString(),
    iteration: 0,
    maxIterations: 0,
    completed: 0,
    total: 0,
    currentTask: 'none',
    retryCount: 0,
    ...fields,
  };
  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));
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

function readPRD(projectId?: string): PRDJson | null {
  try {
    const prdPath = getProjectPrdJsonPath(projectId);
    if (fs.existsSync(prdPath)) {
      return JSON.parse(fs.readFileSync(prdPath, 'utf-8'));
    }
  } catch {
    // Ignore
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const { maxIterations = 10, mode = 'teams', projectId } = await request.json().catch(() => ({}));

    const PRD_PATH = getProjectPrdJsonPath(projectId);

    // Check if prd.json exists (needed for all modes)
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
    const prd = readPRD(projectId);

    // Determine stage based on mode
    const stageMap: Record<string, 3 | 4> = { single: 3, teams: 3, testing: 4 };
    const stage = stageMap[mode] || 3;

    if (prd) {
      const tasks = prd.devTasks || [];
      const tasksCompleted = tasks.filter(t => t.passes).length;
      const tasksTotal = tasks.length;

      updateTaskHistoryEntry({
        id: prd.branchName || `task-${Date.now()}`,
        name: prd.project || 'Unknown Task',
        description: prd.description,
        branchName: prd.branchName,
        status: 'running',
        stage,
        tasksCompleted,
        tasksTotal,
        startTime: new Date().toISOString(),
      });
    }

    let child;

    if (mode === 'testing') {
      // Testing mode: run Claude CLI with /botoolagent-testing skill
      let prompt = '/botoolagent-testing';
      if (projectId) {
        prompt += `\n\nProject: ${projectId}\nPRD path: ${PRD_PATH}`;
      }

      const claudeArgs = [
        'claude',
        '--dangerously-skip-permissions',
        '--output-format', 'stream-json',
        '-p', prompt,
      ];

      // Write initial .agent-status so Stage 4 UI can track progress
      writeAgentStatus({
        status: 'running',
        message: 'Testing pipeline started (4-layer verification)',
        currentTask: 'testing',
      });

      child = spawn(claudeArgs[0], claudeArgs.slice(1), {
        cwd: PROJECT_ROOT,
        detached: true,
        stdio: 'ignore',
      });

      // Listen for exit to write final status (works even with detached+unref
      // because Next.js server keeps the event loop alive)
      child.on('exit', (code) => {
        writeAgentStatus({
          status: code === 0 ? 'complete' : 'error',
          message: code === 0 ? 'Testing pipeline completed' : `Testing failed (exit code ${code})`,
        });
        cleanPidFile();
      });
    } else {
      // Coding mode: run BotoolAgent scripts
      const SCRIPT_PATH = mode === 'teams' ? getAgentTeamsScriptPath() : getAgentScriptPath();

      if (!fs.existsSync(SCRIPT_PATH)) {
        const scriptName = mode === 'teams' ? 'BotoolAgentTeams.sh' : 'BotoolAgent.sh';
        return NextResponse.json(
          { error: `${scriptName} not found`, path: SCRIPT_PATH },
          { status: 404 }
        );
      }

      const args = [SCRIPT_PATH];
      if (mode === 'teams') {
        if (isPortableMode()) {
          args.push('--project-dir', PROJECT_ROOT);
        }
        if (projectId) {
          args.push('--prd-path', PRD_PATH);
        }
      } else {
        args.push(String(maxIterations));
        if (isPortableMode()) {
          args.push('--project-dir', PROJECT_ROOT);
        }
        if (projectId) {
          args.push('--prd-path', PRD_PATH);
        }
      }

      child = spawn('bash', args, {
        cwd: PROJECT_ROOT,
        detached: true,
        stdio: 'ignore',
      });
    }

    // Allow the parent process to exit independently of the child
    child.unref();

    // Write PID lock file
    if (child.pid) {
      writePidFile(child.pid);
    }

    return NextResponse.json({
      success: true,
      message: `BotoolAgent started in background (${mode} mode)`,
      pid: child.pid,
      mode,
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
