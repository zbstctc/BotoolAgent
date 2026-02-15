import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { updateTaskHistoryEntry } from '@/lib/task-history';
import { getProjectRoot, getProjectPrdJsonPath, getAgentScriptPath, getAgentPidPath, getAgentStatusPath, isPortableMode } from '@/lib/project-root';

const PROJECT_ROOT = getProjectRoot();
const PID_FILE = getAgentPidPath();
const STATUS_FILE = getAgentStatusPath();
const TESTING_LOG_FILE = path.join(path.dirname(STATUS_FILE), 'agent-testing.log');

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

type TeammateMode = 'in-process' | 'tmux';

function normalizeTeammateMode(value: unknown): TeammateMode {
  if (value === 'tmux') return 'tmux';
  return 'in-process';
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
    const requestBody = await request.json().catch(() => ({}));
    const { mode = 'teams', projectId } = requestBody as {
      mode?: 'teams' | 'testing';
      projectId?: string;
      maxIterations?: number;
      startLayer?: number;
      testingUseTeams?: boolean;
      testingTeammateMode?: TeammateMode;
    };
    const rawMaxIterations = requestBody?.maxIterations;
    const maxIterations = Number.isFinite(rawMaxIterations)
      ? Math.max(1, Math.min(50, Math.floor(rawMaxIterations)))
      : undefined;
    const rawStartLayer = requestBody?.startLayer;
    const startLayer = Number.isFinite(rawStartLayer)
      ? Math.max(1, Math.min(4, Math.floor(rawStartLayer)))
      : undefined;
    const testingUseTeams = typeof requestBody?.testingUseTeams === 'boolean'
      ? requestBody.testingUseTeams
      : true;
    const testingTeammateMode = normalizeTeammateMode(
      requestBody?.testingTeammateMode || process.env.BOTOOL_TEAMMATE_MODE
    );

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
    const stage = mode === 'testing' ? 4 : 3;

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
      if (startLayer && startLayer > 1) {
        prompt += ` ${startLayer}`;
      }
      if (projectId) {
        prompt += `\n\nProject: ${projectId}\nPRD path: ${PRD_PATH}`;
      }

      const claudeArgs = [
        'claude',
        '--dangerously-skip-permissions',
      ];
      if (testingUseTeams) {
        claudeArgs.push('--teammate-mode', testingTeammateMode);
      }
      claudeArgs.push('-p', prompt);

      // Write initial .agent-status so Stage 4 UI can track progress
      writeAgentStatus({
        status: 'running',
        message: testingUseTeams
          ? `Testing pipeline started (Agent Teams: ${testingTeammateMode})`
          : 'Testing pipeline started (single agent mode)',
        currentTask: 'testing',
      });

      // Reset testing log for this run
      try {
        fs.writeFileSync(TESTING_LOG_FILE, '');
      } catch {
        // Ignore log initialization failures
      }

      let stderrTail = '';
      child = spawn(claudeArgs[0], claudeArgs.slice(1), {
        cwd: PROJECT_ROOT,
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          CLAUDE_CODE_NON_INTERACTIVE: '1',
          ...(testingUseTeams ? { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' } : {}),
        },
      });

      const appendLog = (chunk: string) => {
        try {
          fs.appendFileSync(TESTING_LOG_FILE, chunk);
        } catch {
          // Ignore log write failures
        }
      };

      child.stdout?.on('data', (data: Buffer) => {
        appendLog(data.toString());
      });

      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        appendLog(text);
        stderrTail = (stderrTail + text).slice(-2000);
      });

      // Listen for exit to write final status.
      // Keep testing child attached so this callback can reliably update status.
      child.on('exit', (code) => {
        const tailMessage = stderrTail.trim().split('\n').slice(-1)[0];
        writeAgentStatus({
          status: code === 0 ? 'complete' : 'error',
          message: code === 0
            ? 'Testing pipeline completed'
            : tailMessage
              ? `Testing failed (exit code ${code}): ${tailMessage}`
              : `Testing failed (exit code ${code})`,
        });
        cleanPidFile();
      });
    } else {
      // Coding mode: run BotoolAgent.sh (tmux + Agent Teams)
      const SCRIPT_PATH = getAgentScriptPath();

      if (!fs.existsSync(SCRIPT_PATH)) {
        return NextResponse.json(
          { error: 'BotoolAgent.sh not found', path: SCRIPT_PATH },
          { status: 404 }
        );
      }

      const args = [SCRIPT_PATH];
      if (isPortableMode()) {
        args.push('--project-dir', PROJECT_ROOT);
      }
      if (projectId) {
        args.push('--prd-path', PRD_PATH);
      }

      child = spawn('bash', args, {
        cwd: PROJECT_ROOT,
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          ...(maxIterations ? { BOTOOL_MAX_ROUNDS: String(maxIterations) } : {}),
        },
      });
    }

    // Allow coding mode process to continue independently.
    if (mode !== 'testing') {
      child.unref();
    }

    // Write PID lock file
    if (child.pid) {
      writePidFile(child.pid);
    }

    return NextResponse.json({
      success: true,
      message: `BotoolAgent started in background`,
      pid: child.pid,
      mode,
      maxIterations: maxIterations ?? null,
      startLayer: startLayer ?? null,
      testingUseTeams: mode === 'testing' ? testingUseTeams : null,
      testingTeammateMode: mode === 'testing' && testingUseTeams ? testingTeammateMode : null,
    });
  } catch (error) {
    console.error('Failed to start agent:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start agent' },
      { status: 500 }
    );
  }
}
