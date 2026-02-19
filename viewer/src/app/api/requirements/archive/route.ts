import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { getTasksDir, normalizeProjectId } from '@/lib/project-root';

/**
 * POST /api/requirements/archive
 * Physically moves a project folder from /tasks/{id} to /tasks/archives/{id}
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { id?: string };
    const id = normalizeProjectId(body.id);

    if (!id) {
      return NextResponse.json(
        { error: 'Missing or invalid project id' },
        { status: 400 }
      );
    }

    const tasksDir = getTasksDir();
    const srcDir = path.join(tasksDir, id);
    const archivesDir = path.join(tasksDir, 'archives');
    const destDir = path.join(archivesDir, id);

    if (!fs.existsSync(srcDir)) {
      return NextResponse.json(
        { error: `Project directory not found: ${id}` },
        { status: 404 }
      );
    }

    // Ensure archives directory exists
    fs.mkdirSync(archivesDir, { recursive: true });

    // If destination already exists, append a timestamp suffix
    let finalDest = destDir;
    if (fs.existsSync(destDir)) {
      const suffix = Date.now();
      finalDest = path.join(archivesDir, `${id}-${suffix}`);
    }

    // Move the folder
    fs.renameSync(srcDir, finalDest);

    console.log(`[archive] Moved ${srcDir} → ${finalDest}`);

    return NextResponse.json({ success: true, archivedTo: path.basename(finalDest) });
  } catch (error) {
    console.error('[/api/requirements/archive] Error:', error);
    return NextResponse.json(
      { error: 'Failed to archive project' },
      { status: 500 }
    );
  }
}
