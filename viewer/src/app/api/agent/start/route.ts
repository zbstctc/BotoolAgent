import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { updateTaskHistoryEntry } from '@/lib/task-history';

// Get project root directory (parent of viewer/)
const PROJECT_ROOT = path.join(process.cwd(), '..');
const PRD_PATH = path.join(PROJECT_ROOT, 'prd.json');

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

    const SCRIPT_PATH = path.join(PROJECT_ROOT, 'BotoolAgent.sh');

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
    // Use nohup equivalent: detached: true, stdio: 'ignore', unref()
    const child = spawn('bash', [SCRIPT_PATH, String(maxIterations)], {
      cwd: PROJECT_ROOT,
      detached: true,
      stdio: 'ignore',
    });

    // Allow the parent process to exit independently of the child
    child.unref();

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
