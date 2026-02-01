import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

export async function POST(request: Request) {
  try {
    const { maxIterations = 10 } = await request.json().catch(() => ({}));

    // Get project root directory (parent of viewer/)
    const PROJECT_ROOT = path.join(process.cwd(), '..');
    const SCRIPT_PATH = path.join(PROJECT_ROOT, 'BotoolAgent.sh');

    // Check if script exists
    if (!fs.existsSync(SCRIPT_PATH)) {
      return NextResponse.json(
        { error: 'BotoolAgent.sh not found', path: SCRIPT_PATH },
        { status: 404 }
      );
    }

    // Check if prd.json exists
    const PRD_PATH = path.join(PROJECT_ROOT, 'prd.json');
    if (!fs.existsSync(PRD_PATH)) {
      return NextResponse.json(
        { error: 'prd.json not found. Please convert a PRD first.' },
        { status: 400 }
      );
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
