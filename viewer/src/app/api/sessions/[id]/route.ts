import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

// Path to archive directory (relative to project root)
const PROJECT_ROOT = process.cwd();
const ARCHIVE_DIR = path.join(PROJECT_ROOT, '..', 'archive');

interface DevTask {
  id: string;
  title: string;
  description?: string;
  passes: boolean;
  acceptanceCriteria?: string[];
}

interface SessionDetail {
  id: string;
  name: string;
  description?: string;
  branchName?: string;
  date: string;
  status: 'completed' | 'failed' | 'partial';
  tasksCompleted: number;
  tasksTotal: number;
  devTasks: DevTask[];
  progressLog?: string;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sessionDir = path.join(ARCHIVE_DIR, id);

    // Check if session directory exists
    if (!fs.existsSync(sessionDir)) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
    }

    const prdJsonPath = path.join(sessionDir, 'prd.json');
    const progressPath = path.join(sessionDir, 'progress.txt');

    if (!fs.existsSync(prdJsonPath)) {
      return NextResponse.json(
        { error: 'Invalid session: missing prd.json' },
        { status: 404 }
      );
    }

    const prdJson = JSON.parse(fs.readFileSync(prdJsonPath, 'utf-8'));
    const stats = fs.statSync(prdJsonPath);

    const tasks: DevTask[] = (prdJson.devTasks || []).map((t: DevTask) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      passes: t.passes,
      acceptanceCriteria: t.acceptanceCriteria,
    }));

    const tasksCompleted = tasks.filter(t => t.passes).length;
    const tasksTotal = tasks.length;

    // Determine status
    let status: SessionDetail['status'] = 'partial';
    if (tasksTotal > 0) {
      if (tasksCompleted === tasksTotal) {
        status = 'completed';
      } else if (tasksCompleted === 0) {
        status = 'failed';
      }
    }

    // Read progress log if available
    let progressLog: string | undefined;
    if (fs.existsSync(progressPath)) {
      progressLog = fs.readFileSync(progressPath, 'utf-8');
    }

    // Try to extract date from directory name or use file modification time
    let date = stats.mtime.toISOString();
    const dateMatch = id.match(/^(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      date = new Date(dateMatch[1]).toISOString();
    }

    const session: SessionDetail = {
      id,
      name: prdJson.project || id,
      description: prdJson.description,
      branchName: prdJson.branchName,
      date,
      status,
      tasksCompleted,
      tasksTotal,
      devTasks: tasks,
      progressLog,
    };

    return NextResponse.json(session);
  } catch (error) {
    console.error('Error reading session:', error);
    return NextResponse.json(
      { error: 'Failed to read session' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/sessions/[id]
 * Delete a session from the archive
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sessionDir = path.join(ARCHIVE_DIR, id);

    // Check if session directory exists
    if (!fs.existsSync(sessionDir)) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
    }

    // Delete the directory recursively
    fs.rmSync(sessionDir, { recursive: true, force: true });

    return NextResponse.json({ success: true, deleted: id });
  } catch (error) {
    console.error('Error deleting session:', error);
    return NextResponse.json(
      { error: 'Failed to delete session' },
      { status: 500 }
    );
  }
}
