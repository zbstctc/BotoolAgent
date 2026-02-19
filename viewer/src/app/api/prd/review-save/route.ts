import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { normalizeProjectId, getProjectDir, getTasksDir } from '@/lib/project-root';
import type { ReviewResult } from '@/lib/adversarial-loop';

// ============================================================================
// Types
// ============================================================================

interface ReviewSaveBody {
  projectId: string;
  reviewTarget: 'prd' | 'enrich';
  reviewResult: ReviewResult;
  fixedContent?: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Strict projectId whitelist: only [a-zA-Z0-9_-] allowed.
 * Rejects /, .., spaces, and any other characters.
 */
const PROJECT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Ensure the resolved target path is strictly under the tasks/ root.
 * Uses fs.realpathSync on the parent that exists, then checks containment.
 */
function assertPathUnderTasks(targetPath: string, tasksDir: string): void {
  // Resolve to absolute paths
  const resolvedTarget = path.resolve(targetPath);
  const resolvedTasksDir = path.resolve(tasksDir);

  // For the target file, the parent directory should already exist (created by getProjectDir).
  // Use realpathSync on the existing parent to resolve any symlinks.
  const targetParent = path.dirname(resolvedTarget);
  let realParent: string;
  try {
    realParent = fs.realpathSync(targetParent);
  } catch {
    throw new Error('Target directory does not exist');
  }

  let realTasksDir: string;
  try {
    realTasksDir = fs.realpathSync(resolvedTasksDir);
  } catch {
    throw new Error('Tasks directory does not exist');
  }

  if (!realParent.startsWith(realTasksDir + path.sep) && realParent !== realTasksDir) {
    throw new Error('Path traversal detected');
  }
}

/**
 * Atomic file write: write to a temporary file in the same directory,
 * then rename (atomic on the same filesystem).
 */
function atomicWriteFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  const tmpName = `.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tmpPath = path.join(dir, tmpName);

  try {
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    // Clean up temp file if rename failed
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

// ============================================================================
// API Handler
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ReviewSaveBody;
    const { projectId, reviewTarget, reviewResult, fixedContent } = body;

    // --- Input validation at handler top ---

    if (!projectId || typeof projectId !== 'string') {
      return NextResponse.json(
        { error: 'projectId is required and must be a string' },
        { status: 400 },
      );
    }

    // Strict whitelist check before any filesystem operations
    if (!PROJECT_ID_PATTERN.test(projectId)) {
      return NextResponse.json(
        { error: 'projectId contains invalid characters' },
        { status: 400 },
      );
    }

    // Double-check with normalizeProjectId (rejects /, .., \, \0)
    const safeId = normalizeProjectId(projectId);
    if (!safeId) {
      return NextResponse.json(
        { error: 'projectId contains invalid characters' },
        { status: 400 },
      );
    }

    if (!reviewTarget || (reviewTarget !== 'prd' && reviewTarget !== 'enrich')) {
      return NextResponse.json(
        { error: 'reviewTarget must be "prd" or "enrich"' },
        { status: 400 },
      );
    }

    if (!reviewResult || typeof reviewResult !== 'object') {
      return NextResponse.json(
        { error: 'reviewResult is required and must be an object' },
        { status: 400 },
      );
    }

    if (fixedContent !== undefined && typeof fixedContent !== 'string') {
      return NextResponse.json(
        { error: 'fixedContent must be a string if provided' },
        { status: 400 },
      );
    }

    // --- Resolve paths with safety checks ---

    const tasksDir = getTasksDir();
    // getProjectDir creates the directory if it doesn't exist
    const projectDir = getProjectDir(safeId);

    // Determine output filename based on reviewTarget
    const reviewFileName =
      reviewTarget === 'prd' ? 'prd-review.json' : 'enrich-review.json';
    const reviewFilePath = path.join(projectDir, reviewFileName);

    // Path safety: ensure we're writing under tasks/
    assertPathUnderTasks(reviewFilePath, tasksDir);

    // --- Write review result JSON ---

    atomicWriteFile(reviewFilePath, JSON.stringify(reviewResult, null, 2));

    // --- Write fixedContent to prd.md (if applicable) ---

    if (reviewTarget === 'prd' && fixedContent) {
      const prdMdPath = path.join(projectDir, 'prd.md');
      assertPathUnderTasks(prdMdPath, tasksDir);

      // Backup original prd.md if it exists
      if (fs.existsSync(prdMdPath)) {
        const timestamp = Date.now();
        const rand = Math.random().toString(36).slice(2);
        const backupPath = path.join(projectDir, `prd-${timestamp}-${rand}.md.bak`);
        assertPathUnderTasks(backupPath, tasksDir);

        try {
          fs.copyFileSync(prdMdPath, backupPath);
        } catch (err) {
          console.error('[review-save] Failed to backup prd.md:', err);
          // Continue even if backup fails — the atomic write is still safe
        }
      }

      // Atomic write: temp file + rename
      atomicWriteFile(prdMdPath, fixedContent);
    }

    return NextResponse.json({
      success: true,
      reviewFile: reviewFileName,
      prdUpdated: reviewTarget === 'prd' && !!fixedContent,
    });
  } catch (error) {
    console.error('[review-save] API error:', error);

    // Do not expose internal paths or stack traces (security red line)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
