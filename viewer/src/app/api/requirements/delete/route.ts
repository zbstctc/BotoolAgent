import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { getTasksDir, normalizeProjectId } from '@/lib/project-root';

/**
 * POST /api/requirements/delete
 * Permanently deletes a project folder from /tasks/{id} or /tasks/archives/{id}.
 * Also removes timestamp-suffixed duplicate archive folders.
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
    const archivesDir = path.join(tasksDir, 'archives');

    // Try active tasks directory first
    const activeDir = path.join(tasksDir, id);
    if (fs.existsSync(activeDir)) {
      fs.rmSync(activeDir, { recursive: true, force: true });
      console.log(`[delete] Removed active project: ${activeDir}`);
      return NextResponse.json({ success: true });
    }

    // Try archives directory (exact match and timestamp-suffixed duplicates)
    let deleted = false;
    if (fs.existsSync(archivesDir)) {
      // Exact match: tasks/archives/{id}
      const exactArchive = path.join(archivesDir, id);
      if (fs.existsSync(exactArchive)) {
        fs.rmSync(exactArchive, { recursive: true, force: true });
        console.log(`[delete] Removed archive: ${exactArchive}`);
        deleted = true;
      }
      // Timestamp-suffixed duplicates: tasks/archives/{id}-{timestamp}
      try {
        const entries = fs.readdirSync(archivesDir, { withFileTypes: true });
        const pattern = new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d{10,}$`);
        for (const e of entries) {
          if (e.isDirectory() && pattern.test(e.name)) {
            const dupPath = path.join(archivesDir, e.name);
            fs.rmSync(dupPath, { recursive: true, force: true });
            console.log(`[delete] Removed duplicate archive: ${dupPath}`);
            deleted = true;
          }
        }
      } catch {
        // non-fatal
      }
    }

    if (deleted) {
      return NextResponse.json({ success: true });
    }

    return NextResponse.json(
      { error: `Project not found: ${id}` },
      { status: 404 }
    );
  } catch (error) {
    console.error('[/api/requirements/delete] Error:', error);
    return NextResponse.json(
      { error: 'Failed to delete project' },
      { status: 500 }
    );
  }
}
