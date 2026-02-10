import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { getTasksDir } from '@/lib/project-root';

const TASKS_DIR = getTasksDir();
const SESSIONS_FILE = path.join(TASKS_DIR, '.prd-sessions.json');

interface SessionInfo {
  sessionId: string;
  updatedAt: string;
}

interface PrdSessions {
  [prdId: string]: SessionInfo;
}

function loadSessions(): PrdSessions {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'));
    }
  } catch {
    console.error('Error loading sessions file');
  }
  return {};
}

function saveSessions(sessions: PrdSessions): void {
  // Ensure tasks directory exists
  if (!fs.existsSync(TASKS_DIR)) {
    fs.mkdirSync(TASKS_DIR, { recursive: true });
  }
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf-8');
}

// GET /api/prd-sessions - Get all sessions or specific session by prdId query param
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const prdId = searchParams.get('prdId');

    const sessions = loadSessions();

    if (prdId) {
      // Return specific session for a PRD
      const session = sessions[prdId];
      if (session) {
        return NextResponse.json({
          prdId,
          ...session,
        });
      }
      return NextResponse.json({ prdId, sessionId: null });
    }

    // Return all sessions
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

    const sessions = loadSessions();
    sessions[prdId] = {
      sessionId,
      updatedAt: new Date().toISOString(),
    };
    saveSessions(sessions);

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

    const sessions = loadSessions();
    if (sessions[prdId]) {
      delete sessions[prdId];
      saveSessions(sessions);
    }

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
