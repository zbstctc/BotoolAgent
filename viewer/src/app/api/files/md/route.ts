import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { getProjectRoot } from '@/lib/project-root';

const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build',
  '.turbo', '.state', 'archive', '.cache', 'coverage', '__pycache__',
]);

const MAX_DEPTH = 4;

interface MdFileInfo {
  path: string;
  name: string;
  directory: string;
  preview: string;
  size: number;
  modifiedAt: string;
}

function getPreview(filePath: string): string {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim() !== '');
    return lines.slice(0, 5).join('\n');
  } catch {
    return '';
  }
}

function scanMdFiles(dir: string, rootDir: string, depth: number): MdFileInfo[] {
  if (depth > MAX_DEPTH) return [];

  const results: MdFileInfo[] = [];
  let entries: fs.Dirent[];

  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      results.push(...scanMdFiles(fullPath, rootDir, depth + 1));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      try {
        const stat = fs.statSync(fullPath);
        const relativePath = path.relative(rootDir, fullPath);
        results.push({
          path: relativePath,
          name: entry.name,
          directory: path.relative(rootDir, dir) || '.',
          preview: getPreview(fullPath),
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        });
      } catch {
        // skip files we can't stat
      }
    }
  }

  return results;
}

export async function GET() {
  try {
    const projectRoot = getProjectRoot();
    const tasksDir = path.join(projectRoot, 'tasks');
    const files = fs.existsSync(tasksDir)
      ? scanMdFiles(tasksDir, projectRoot, 0)
      : [];

    // Sort by modifiedAt descending
    files.sort((a, b) =>
      new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
    );

    return NextResponse.json({ files });
  } catch (error) {
    console.error('Error scanning md files:', error);
    return NextResponse.json(
      { error: 'Failed to scan markdown files' },
      { status: 500 }
    );
  }
}
