import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { getTasksDir } from '@/lib/project-root';

const TASKS_DIR = getTasksDir();
const SESSIONS_FILE = path.join(TASKS_DIR, '.prd-sessions.json');

interface PrdSessionEntry {
  sessionId?: string;
  updatedAt: string;
  transformedFrom?: string;
}

interface PrdSessions {
  [prdId: string]: PrdSessionEntry;
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
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf-8');
}

function sanitizeFilename(name: string): string {
  // Remove special characters, keep alphanumeric, spaces, hyphens, and underscores
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_\u4e00-\u9fff]/g, '') // Keep Chinese characters
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
    .slice(0, 50); // Limit length
}

function extractPRDName(content: string): string {
  // Try to extract title from markdown # PRD: <name>
  const titleMatch = content.match(/^#\s*PRD:\s*(.+)$/m);
  if (titleMatch) {
    return titleMatch[1].trim();
  }

  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) {
    return h1Match[1].trim();
  }

  return '';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { content, name: providedName, sessionId, sourceFilePath, markerId } = body;

    if (!content || typeof content !== 'string') {
      return NextResponse.json(
        { error: 'PRD content is required' },
        { status: 400 }
      );
    }

    // Extract or use provided name
    let prdName = providedName || extractPRDName(content);
    if (!prdName) {
      prdName = `prd-${Date.now()}`;
    }

    // Create sanitized filename
    const sanitizedName = sanitizeFilename(prdName);
    let filename = `prd-${sanitizedName}.md`;

    // Avoid overwriting the source file in transform/import mode
    if (sourceFilePath) {
      const sourceBasename = path.basename(sourceFilePath);
      if (filename === sourceBasename) {
        filename = `prd-${sanitizedName}-botool.md`;
      }
    }

    const filePath = path.join(TASKS_DIR, filename);

    // Ensure tasks directory exists
    if (!fs.existsSync(TASKS_DIR)) {
      fs.mkdirSync(TASKS_DIR, { recursive: true });
    }

    // Check if file already exists
    if (fs.existsSync(filePath)) {
      // Generate unique filename by appending timestamp
      const uniqueFilename = `prd-${sanitizedName}-${Date.now()}.md`;
      const uniqueFilePath = path.join(TASKS_DIR, uniqueFilename);
      fs.writeFileSync(uniqueFilePath, content, 'utf-8');

      const prdId = uniqueFilename.replace(/^prd-/, '').replace(/\.md$/, '');

      // Save session mapping (always when transform, or when sessionId provided)
      if (sessionId || sourceFilePath) {
        const sessions = loadSessions();
        const entry: PrdSessionEntry = { updatedAt: new Date().toISOString() };
        if (sessionId) entry.sessionId = sessionId;
        if (sourceFilePath) entry.transformedFrom = path.basename(sourceFilePath);
        sessions[prdId] = entry;
        saveSessions(sessions);
      }

      // Clean up marker file if markerId provided
      if (markerId) {
        try {
          const markerPath = path.join(TASKS_DIR, `prd-${markerId}.md`);
          if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath);
        } catch { /* non-fatal */ }
      }

      return NextResponse.json({
        success: true,
        filename: uniqueFilename,
        id: prdId,
        name: prdName,
        sessionId,
        message: 'PRD saved successfully (with unique identifier due to existing file)',
      });
    }

    // Write the file
    fs.writeFileSync(filePath, content, 'utf-8');

    const prdId = filename.replace(/^prd-/, '').replace(/\.md$/, '');

    // Save session mapping (always when transform, or when sessionId provided)
    if (sessionId || sourceFilePath) {
      const sessions = loadSessions();
      const entry: PrdSessionEntry = { updatedAt: new Date().toISOString() };
      if (sessionId) entry.sessionId = sessionId;
      if (sourceFilePath) entry.transformedFrom = path.basename(sourceFilePath);
      sessions[prdId] = entry;
      saveSessions(sessions);
    }

    // Clean up marker file if markerId provided
    if (markerId) {
      try {
        const markerPath = path.join(TASKS_DIR, `prd-${markerId}.md`);
        if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath);
      } catch { /* non-fatal */ }
    }

    return NextResponse.json({
      success: true,
      filename,
      id: prdId,
      name: prdName,
      sessionId,
      message: 'PRD saved successfully',
    });
  } catch (error) {
    console.error('Error saving PRD:', error);
    return NextResponse.json(
      { error: 'Failed to save PRD' },
      { status: 500 }
    );
  }
}
