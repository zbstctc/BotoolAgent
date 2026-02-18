import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { getTasksDir, getProjectSessionPath } from '@/lib/project-root';

const TASKS_DIR = getTasksDir();

interface SessionInfo {
  sessionId?: string;
  updatedAt: string;
  transformedFrom?: string;
}

/**
 * Load session for a specific project from tasks/{projectId}/prd-session.json.
 * Falls back to global .prd-sessions.json for backward compat.
 */
function loadSession(prdId: string): SessionInfo | null {
  // Try new per-project format first
  try {
    const sessionPath = getProjectSessionPath(prdId);
    if (fs.existsSync(sessionPath)) {
      return JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
    }
  } catch {
    console.error('Error loading project session file');
  }

  // Fall back to legacy global file
  try {
    const globalPath = path.join(TASKS_DIR, '.prd-sessions.json');
    if (fs.existsSync(globalPath)) {
      const all = JSON.parse(fs.readFileSync(globalPath, 'utf-8'));
      if (all[prdId]) return all[prdId];
    }
  } catch {
    // Ignore
  }

  return null;
}

/**
 * Save session for a specific project to tasks/{projectId}/prd-session.json.
 */
function saveSession(prdId: string, session: SessionInfo): void {
  const sessionPath = getProjectSessionPath(prdId);
  const dir = path.dirname(sessionPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2), 'utf-8');
}

/**
 * Load all sessions by scanning per-project files and merging with legacy global file.
 */
function loadAllSessions(): Record<string, SessionInfo> {
  const result: Record<string, SessionInfo> = {};

  // Load from legacy global file
  try {
    const globalPath = path.join(TASKS_DIR, '.prd-sessions.json');
    if (fs.existsSync(globalPath)) {
      const legacy = JSON.parse(fs.readFileSync(globalPath, 'utf-8'));
      Object.assign(result, legacy);
    }
  } catch {
    // Ignore
  }

  // Scan per-project session files (override legacy entries)
  try {
    if (fs.existsSync(TASKS_DIR)) {
      const entries = fs.readdirSync(TASKS_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const sessionPath = getProjectSessionPath(entry.name);
        if (fs.existsSync(sessionPath)) {
          try {
            const session = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
            result[entry.name] = session;
          } catch { /* skip malformed files */ }
        }
      }
    }
  } catch {
    // Ignore scan errors
  }

  return result;
}

// GET /api/prd-sessions - Get all sessions or specific session by prdId query param
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const prdId = searchParams.get('prdId');

    if (prdId) {
      // Return specific session for a PRD
      const session = loadSession(prdId);
      if (session) {
        return NextResponse.json({
          prdId,
          ...session,
        });
      }
      return NextResponse.json({ prdId, sessionId: null });
    }

    // Return all sessions
    const sessions = loadAllSessions();
    return NextResponse.json({ sessions });
  } catch (error) {
    console.error('Error getting sessions:', error);
    return NextResponse.json(
      { error: 'Failed to get sessions' },
      { status: 500 }
    );
  }
}

// POST /api/prd-sessions - Create or update a session mapping
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prdId, sessionId } = body;

    if (!prdId || typeof prdId !== 'string') {
      return NextResponse.json(
        { error: 'prdId is required' },
        { status: 400 }
      );
    }

    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json(
        { error: 'sessionId is required' },
        { status: 400 }
      );
    }

    const existing = loadSession(prdId);
    const session: SessionInfo = {
      ...existing,
      sessionId,
      updatedAt: new Date().toISOString(),
    };
    saveSession(prdId, session);

    return NextResponse.json({
      success: true,
      prdId,
      sessionId,
    });
  } catch (error) {
    console.error('Error saving session:', error);
    return NextResponse.json(
      { error: 'Failed to save session' },
      { status: 500 }
    );
  }
}

// DELETE /api/prd-sessions - Delete a session mapping
export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const prdId = searchParams.get('prdId');

    if (!prdId) {
      return NextResponse.json(
        { error: 'prdId is required' },
        { status: 400 }
      );
    }

    // Delete per-project session file if it exists
    try {
      const sessionPath = getProjectSessionPath(prdId);
      if (fs.existsSync(sessionPath)) {
        fs.unlinkSync(sessionPath);
      }
    } catch { /* non-fatal */ }

    // Also remove from legacy global file if present
    try {
      const globalPath = path.join(TASKS_DIR, '.prd-sessions.json');
      if (fs.existsSync(globalPath)) {
        const all = JSON.parse(fs.readFileSync(globalPath, 'utf-8'));
        if (all[prdId]) {
          delete all[prdId];
          fs.writeFileSync(globalPath, JSON.stringify(all, null, 2), 'utf-8');
        }
      }
    } catch { /* non-fatal */ }

    return NextResponse.json({
      success: true,
      prdId,
    });
  } catch (error) {
    console.error('Error deleting session:', error);
    return NextResponse.json(
      { error: 'Failed to delete session' },
      { status: 500 }
    );
  }
}
