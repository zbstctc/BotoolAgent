import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { getTasksDir, getProjectDir, getProjectSessionPath } from '@/lib/project-root';

const TASKS_DIR = getTasksDir();

interface PrdSessionEntry {
  sessionId?: string;
  updatedAt: string;
  transformedFrom?: string;
}

function loadProjectSession(projectId: string): PrdSessionEntry | null {
  try {
    const sessionPath = getProjectSessionPath(projectId);
    if (fs.existsSync(sessionPath)) {
      return JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
    }
  } catch {
    console.error('Error loading project session file');
  }
  return null;
}

function saveProjectSession(projectId: string, entry: PrdSessionEntry): void {
  const sessionPath = getProjectSessionPath(projectId);
  const dir = path.dirname(sessionPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(sessionPath, JSON.stringify(entry, null, 2), 'utf-8');
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

    // Create sanitized project ID from name
    let projectId = sanitizeFilename(prdName);

    // Ensure tasks directory exists
    if (!fs.existsSync(TASKS_DIR)) {
      fs.mkdirSync(TASKS_DIR, { recursive: true });
    }

    // Determine target directory: tasks/{projectId}/
    let projectDir = getProjectDir(projectId); // creates dir if not exists
    let prdFilePath = path.join(projectDir, 'prd.md');

    // Avoid overwriting the source file in transform/import mode
    if (sourceFilePath) {
      const sourceBasename = path.basename(sourceFilePath);
      // If source is in same project dir, use a different project id
      if (path.dirname(sourceFilePath) === projectDir && sourceBasename === 'prd.md') {
        projectId = `${projectId}-botool`;
        projectDir = getProjectDir(projectId);
        prdFilePath = path.join(projectDir, 'prd.md');
      }
    }

    // Check if project dir already has prd.md → use unique projectId with timestamp
    if (fs.existsSync(prdFilePath)) {
      const uniqueProjectId = `${projectId}-${Date.now()}`;
      projectDir = getProjectDir(uniqueProjectId);
      prdFilePath = path.join(projectDir, 'prd.md');
      projectId = uniqueProjectId;
    }

    // Write prd.md to tasks/{projectId}/prd.md
    fs.writeFileSync(prdFilePath, content, 'utf-8');

    // Save session mapping to tasks/{projectId}/prd-session.json
    if (sessionId || sourceFilePath) {
      const entry: PrdSessionEntry = { updatedAt: new Date().toISOString() };
      if (sessionId) entry.sessionId = sessionId;
      if (sourceFilePath) {
        // Store the source project id for the hiding logic in GET /api/prd
        const sourceName = path.basename(sourceFilePath);
        if (sourceName === 'prd.md') {
          // New format: tasks/{projectId}/prd.md → use parent directory name as project id
          entry.transformedFrom = path.basename(path.dirname(sourceFilePath));
        } else {
          // Legacy format: tasks/prd-xxx.md → strip prefix/extension
          entry.transformedFrom = sourceName.replace(/^prd-/, '').replace(/\.md$/, '');
        }
      }
      saveProjectSession(projectId, entry);
    }

    // Clean up marker file if markerId provided (legacy flat format)
    if (markerId) {
      try {
        // Check legacy flat marker first
        const legacyMarkerPath = path.join(TASKS_DIR, `prd-${markerId}.md`);
        if (fs.existsSync(legacyMarkerPath)) fs.unlinkSync(legacyMarkerPath);
        // Also check new format marker: tasks/{markerId}/prd.md (if it's an import marker)
        const newMarkerPath = path.join(TASKS_DIR, markerId, 'prd.md');
        if (fs.existsSync(newMarkerPath)) {
          const markerContent = fs.readFileSync(newMarkerPath, 'utf-8');
          if (markerContent.includes('type: import-marker')) {
            fs.unlinkSync(newMarkerPath);
          }
        }
      } catch { /* non-fatal */ }
    }

    return NextResponse.json({
      success: true,
      filename: `${projectId}/prd.md`,
      id: projectId,
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
