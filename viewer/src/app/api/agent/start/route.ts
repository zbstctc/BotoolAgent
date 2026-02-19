import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { updateTaskHistoryEntry } from '@/lib/task-history';
import { getProjectRoot, getProjectPrdJsonPath, getAgentScriptPath, getAgentPidPath, getAgentStatusPath, isPortableMode, normalizeProjectId } from '@/lib/project-root';
import { verifyCsrfProtection } from '@/lib/api-guard';

const PROJECT_ROOT = getProjectRoot();

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

function writePidFile(pid: number, pidFile: string): void {
  const info: AgentPidInfo = {
    pid,
    startedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(pidFile, JSON.stringify(info, null, 2));
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

function writeAgentStatus(fields: Record<string, unknown>, statusFile: string): void {
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
    fs.mkdirSync(path.dirname(statusFile), { recursive: true });
    fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
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

function readPRD(projectId?: string | null): PRDJson | null {
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
  const csrfError = verifyCsrfProtection(request);
  if (csrfError) return csrfError;

  try {
    const requestBody = await request.json().catch(() => ({}));
    const { mode = 'teams', projectId: rawProjectId } = requestBody as {
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

    const projectId = normalizeProjectId(rawProjectId);

    // Derive per-project file paths
    const pidFile = getAgentPidPath(projectId);
    const statusFile = getAgentStatusPath(projectId);
    const testingLogFile = path.join(path.dirname(statusFile), 'agent-testing.log');

    const PRD_PATH = getProjectPrdJsonPath(projectId);

    // Check if prd.json exists (needed for all modes)
    if (!fs.existsSync(PRD_PATH)) {
      return NextResponse.json(
        { error: 'prd.json not found. Please convert a PRD first.' },
        { status: 400 }
      );
    }

    // Check if agent is already running (per-project PID lock)
    const existingPid = readPidFile(pidFile);
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
      cleanPidFile(pidFile);
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
      claudeArgs.push('--verbose', '--output-format', 'stream-json', '-p', prompt);

      // Write initial status so Stage 4 UI can track progress
      writeAgentStatus({
        status: 'running',
        message: testingUseTeams
          ? `Testing pipeline started (Agent Teams: ${testingTeammateMode})`
          : 'Testing pipeline started (single agent mode)',
        currentTask: 'testing',
      }, statusFile);

      // Reset testing log for this run
      try {
        fs.mkdirSync(path.dirname(testingLogFile), { recursive: true });
        fs.writeFileSync(testingLogFile, '');
      } catch {
        // Ignore log initialization failures
      }

      // Write stdout/stderr directly to log file fd — survives parent death.
      // stream-json output goes to the file; /api/agent/log parses it for the UI.
      const logFd = fs.openSync(testingLogFile, 'a');

      // Remove CLAUDECODE to prevent "nested session" rejection
      const { CLAUDECODE: _c1, ...cleanEnv1 } = process.env;
      child = spawn(claudeArgs[0], claudeArgs.slice(1), {
        cwd: PROJECT_ROOT,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: {
          ...cleanEnv1,
          CLAUDE_CODE_NON_INTERACTIVE: '1',
          ...(testingUseTeams ? { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' } : {}),
        },
      });

      // Parent closes its copy of the fd; child keeps writing via its own copy.
      fs.closeSync(logFd);

      // Exit handler still fires as long as this Next.js server is alive.
      // If server restarts, checkAndHandleOrphan() in /api/agent/status covers it.
      child.on('exit', (code) => {
        writeAgentStatus({
          status: code === 0 ? 'complete' : 'error',
          message: code === 0
            ? '验收流程已完成'
            : `验收失败（退出码 ${code}）`,
        }, statusFile);
        cleanPidFile(pidFile);
      });
    } else {
      // Coding mode: run BotoolAgent.sh (tmux + Agent Teams)
      const SCRIPT_PATH = getAgentScriptPath();

      if (!fs.existsSync(SCRIPT_PATH)) {
        return NextResponse.json(
          { error: 'BotoolAgent.sh not found' },
          { status: 404 }
        );
      }

      const args = [SCRIPT_PATH];
      if (isPortableMode()) {
        args.push('--project-dir', PROJECT_ROOT);
      }
      if (projectId) {
        args.push('--project-id', projectId);
        args.push('--prd-path', PRD_PATH);
      }

      // Remove CLAUDECODE to prevent "nested session" rejection
      const { CLAUDECODE: _c2, ...cleanEnv2 } = process.env;
      child = spawn('bash', args, {
        cwd: PROJECT_ROOT,
        detached: true,
        stdio: 'ignore',
        env: {
          ...cleanEnv2,
          ...(maxIterations ? { BOTOOL_MAX_ROUNDS: String(maxIterations) } : {}),
          BOTOOL_MODEL: process.env.BOTOOL_MODEL || 'claude-opus-4-6',
        },
      });
    }

    // Both coding and testing modes run as detached processes.
    child.unref();

    // Write per-project PID lock file
    if (child.pid) {
      writePidFile(child.pid, pidFile);
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
