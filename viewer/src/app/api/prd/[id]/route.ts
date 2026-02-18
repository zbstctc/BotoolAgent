import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { getTasksDir } from '@/lib/project-root';

const TASKS_DIR = getTasksDir();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Try new format: tasks/{id}/prd.md
    const newFormatPath = path.join(TASKS_DIR, id, 'prd.md');
    if (fs.existsSync(newFormatPath)) {
      const content = fs.readFileSync(newFormatPath, 'utf-8');
      const stats = fs.statSync(newFormatPath);
      return NextResponse.json({
        id,
        filename: `${id}/prd.md`,
        content,
        createdAt: stats.birthtime.toISOString(),
        modifiedAt: stats.mtime.toISOString(),
      });
    }

    // Fall back to legacy format: tasks/prd-{id}.md
    const legacyFilename = `prd-${id}.md`;
    const legacyPath = path.join(TASKS_DIR, legacyFilename);
    if (fs.existsSync(legacyPath)) {
      const content = fs.readFileSync(legacyPath, 'utf-8');
      const stats = fs.statSync(legacyPath);
      return NextResponse.json({
        id,
        filename: legacyFilename,
        content,
        createdAt: stats.birthtime.toISOString(),
        modifiedAt: stats.mtime.toISOString(),
      });
    }

    return NextResponse.json(
      { error: 'PRD not found' },
      { status: 404 }
    );
  } catch (error) {
    console.error('Error reading PRD file:', error);
    return NextResponse.json(
      { error: 'Failed to read PRD file' },
      { status: 500 }
    );
  }
}
