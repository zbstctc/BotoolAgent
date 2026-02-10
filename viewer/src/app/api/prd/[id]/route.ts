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
    const filename = `prd-${id}.md`;
    const filePath = path.join(TASKS_DIR, filename);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return NextResponse.json(
        { error: 'PRD not found' },
        { status: 404 }
      );
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const stats = fs.statSync(filePath);

    return NextResponse.json({
      id,
      filename,
      content,
      createdAt: stats.birthtime.toISOString(),
      modifiedAt: stats.mtime.toISOString(),
    });
  } catch (error) {
    console.error('Error reading PRD file:', error);
    return NextResponse.json(
      { error: 'Failed to read PRD file' },
      { status: 500 }
    );
  }
}
