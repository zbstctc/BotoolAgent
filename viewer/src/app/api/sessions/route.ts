import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

// Path to archive directory (relative to project root)
const PROJECT_ROOT = process.cwd();
const ARCHIVE_DIR = path.join(PROJECT_ROOT, '..', 'archive');

export interface SessionItem {
  id: string;
  name: string;
  date: string;
  status: 'completed' | 'failed' | 'partial';
  tasksCompleted: number;
  tasksTotal: number;
  branchName?: string;
  description?: string;
}

interface ArchivedPRD {
  project?: string;
  description?: string;
  branchName?: string;
  devTasks?: Array<{
    id: string;
    title: string;
    passes: boolean;
  }>;
}

function parseSession(dirName: string, dirPath: string): SessionItem | null {
  try {
    // Session directories are expected to be named like: YYYY-MM-DD-project-name
    // or just project-name with a prd.json inside
    const prdJsonPath = path.join(dirPath, 'prd.json');

    if (!fs.existsSync(prdJsonPath)) {
      return null;
    }

    const prdJson: ArchivedPRD = JSON.parse(fs.readFileSync(prdJsonPath, 'utf-8'));
    const stats = fs.statSync(prdJsonPath);

    const tasks = prdJson.devTasks || [];
    const tasksCompleted = tasks.filter(t => t.passes).length;
    const tasksTotal = tasks.length;

    // Determine status
    let status: SessionItem['status'] = 'partial';
    if (tasksTotal > 0) {
      if (tasksCompleted === tasksTotal) {
        status = 'completed';
      } else if (tasksCompleted === 0) {
        status = 'failed';
      }
    }

    // Try to extract date from directory name or use file modification time
    let date = stats.mtime.toISOString();
    const dateMatch = dirName.match(/^(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      date = new Date(dateMatch[1]).toISOString();
    }

    return {
      id: dirName,
      name: prdJson.project || dirName,
      date,
      status,
      tasksCompleted,
      tasksTotal,
      branchName: prdJson.branchName,
      description: prdJson.description,
    };
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    // Check if archive directory exists
    if (!fs.existsSync(ARCHIVE_DIR)) {
      return NextResponse.json({ sessions: [] });
    }

    // Read all directories in archive
    const entries = fs.readdirSync(ARCHIVE_DIR, { withFileTypes: true });
    const sessionDirs = entries.filter(entry => entry.isDirectory());

    const sessions: SessionItem[] = [];

    for (const dir of sessionDirs) {
      const dirPath = path.join(ARCHIVE_DIR, dir.name);
      const session = parseSession(dir.name, dirPath);
      if (session) {
        sessions.push(session);
      }
    }

    // Sort by date, newest first
    sessions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return NextResponse.json({ sessions });
  } catch (error) {
    console.error('Error reading archive directory:', error);
    return NextResponse.json(
      { error: 'Failed to read archive directory' },
      { status: 500 }
    );
  }
}
