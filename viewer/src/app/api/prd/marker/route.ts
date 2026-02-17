import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { getTasksDir } from '@/lib/project-root';

const TASKS_DIR = getTasksDir();

/**
 * Derive marker filename from source file path.
 * - Source has `prd-` prefix (e.g. `prd-xxx.md`) -> marker: `prd-xxx-导入转换中.md`
 * - Source has no prefix (e.g. `docs/my-req.md`) -> marker: `prd-my-req-导入转换中.md`
 */
function deriveMarkerFilename(sourceFilePath: string): string {
  const baseName = path.basename(sourceFilePath, '.md');
  if (baseName.startsWith('prd-')) {
    return `${baseName}-导入转换中.md`;
  }
  return `prd-${baseName}-导入转换中.md`;
}

function deriveMarkerId(sourceFilePath: string): string {
  const filename = deriveMarkerFilename(sourceFilePath);
  return filename.replace(/^prd-/, '').replace(/\.md$/, '');
}

interface MarkerFrontmatter {
  type: string;
  sourcePath: string;
  sessionId: string;
  createdAt: string;
}

function buildMarkerContent(meta: MarkerFrontmatter): string {
  return [
    '---',
    `type: import-marker`,
    `sourcePath: "${meta.sourcePath}"`,
    `sessionId: "${meta.sessionId}"`,
    `createdAt: "${meta.createdAt}"`,
    '---',
    '',
    `# 导入转换中`,
    '',
    `源文件: ${meta.sourcePath}`,
    `会话: ${meta.sessionId}`,
    '',
    '> 此文件为导入标记，金字塔问答完成后将自动删除。',
    '',
  ].join('\n');
}

function parseMarkerContent(content: string): MarkerFrontmatter | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;

  const fm = fmMatch[1];
  const type = fm.match(/type:\s*(.+)/)?.[1]?.trim();
  if (type !== 'import-marker') return null;

  const sourcePath = fm.match(/sourcePath:\s*"?([^"\n]+)"?/)?.[1]?.trim() || '';
  const sessionId = fm.match(/sessionId:\s*"?([^"\n]+)"?/)?.[1]?.trim() || '';
  const createdAt = fm.match(/createdAt:\s*"?([^"\n]+)"?/)?.[1]?.trim() || '';

  return { type, sourcePath, sessionId, createdAt };
}

// POST — create marker file
export async function POST(request: NextRequest) {
  try {
    const { sourceFilePath, sessionId } = await request.json();

    if (!sourceFilePath || !sessionId) {
      return NextResponse.json(
        { error: 'sourceFilePath and sessionId are required' },
        { status: 400 }
      );
    }

    const markerFilename = deriveMarkerFilename(sourceFilePath);
    const markerPath = path.join(TASKS_DIR, markerFilename);
    const markerId = deriveMarkerId(sourceFilePath);

    // Check if marker already exists
    if (fs.existsSync(markerPath)) {
      const content = fs.readFileSync(markerPath, 'utf-8');
      const meta = parseMarkerContent(content);
      return NextResponse.json(
        {
          exists: true,
          marker: {
            id: markerId,
            filename: markerFilename,
            sourcePath: meta?.sourcePath || sourceFilePath,
            sessionId: meta?.sessionId || '',
            createdAt: meta?.createdAt || '',
          },
        },
        { status: 409 }
      );
    }

    // Ensure tasks directory exists
    if (!fs.existsSync(TASKS_DIR)) {
      fs.mkdirSync(TASKS_DIR, { recursive: true });
    }

    const now = new Date().toISOString();
    const content = buildMarkerContent({
      type: 'import-marker',
      sourcePath: sourceFilePath,
      sessionId,
      createdAt: now,
    });

    fs.writeFileSync(markerPath, content, 'utf-8');

    return NextResponse.json({
      success: true,
      marker: {
        id: markerId,
        filename: markerFilename,
        sourcePath: sourceFilePath,
        sessionId,
        createdAt: now,
      },
    });
  } catch (error) {
    console.error('Error creating marker:', error);
    return NextResponse.json(
      { error: 'Failed to create marker' },
      { status: 500 }
    );
  }
}

// GET — check if marker exists for a source file
export async function GET(request: NextRequest) {
  try {
    const source = request.nextUrl.searchParams.get('source');
    if (!source) {
      return NextResponse.json(
        { error: 'source query parameter is required' },
        { status: 400 }
      );
    }

    const markerFilename = deriveMarkerFilename(source);
    const markerPath = path.join(TASKS_DIR, markerFilename);
    const markerId = deriveMarkerId(source);

    if (fs.existsSync(markerPath)) {
      const content = fs.readFileSync(markerPath, 'utf-8');
      const meta = parseMarkerContent(content);
      return NextResponse.json({
        exists: true,
        marker: {
          id: markerId,
          filename: markerFilename,
          sourcePath: meta?.sourcePath || source,
          sessionId: meta?.sessionId || '',
          createdAt: meta?.createdAt || '',
        },
      });
    }

    return NextResponse.json({ exists: false });
  } catch (error) {
    console.error('Error checking marker:', error);
    return NextResponse.json(
      { error: 'Failed to check marker' },
      { status: 500 }
    );
  }
}

// DELETE — remove marker file
export async function DELETE(request: NextRequest) {
  try {
    const { markerId } = await request.json();
    if (!markerId) {
      return NextResponse.json(
        { error: 'markerId is required' },
        { status: 400 }
      );
    }

    const markerFilename = `prd-${markerId}.md`;
    const markerPath = path.join(TASKS_DIR, markerFilename);

    if (fs.existsSync(markerPath)) {
      fs.unlinkSync(markerPath);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: true, message: 'Marker not found (already deleted)' });
  } catch (error) {
    console.error('Error deleting marker:', error);
    return NextResponse.json(
      { error: 'Failed to delete marker' },
      { status: 500 }
    );
  }
}
