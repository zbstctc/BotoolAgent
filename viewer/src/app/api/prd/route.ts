import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { getTasksDir, getPrdJsonPath } from '@/lib/project-root';

const TASKS_DIR = getTasksDir();

export interface PRDItem {
  id: string;
  name: string;
  filename: string;
  createdAt: string;
  status: 'draft' | 'ready' | 'in-progress' | 'completed';
  preview?: string;
}

function extractPRDName(content: string): string {
  // Try to extract title from markdown # PRD: <name> or ## <name>
  const titleMatch = content.match(/^#\s*PRD:\s*(.+)$/m);
  if (titleMatch) {
    return titleMatch[1].trim();
  }

  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) {
    return h1Match[1].trim();
  }

  return 'Untitled PRD';
}

function extractPreview(content: string): string {
  // Extract first paragraph or introduction
  const lines = content.split('\n');
  let preview = '';
  let inIntro = false;

  for (const line of lines) {
    if (line.match(/^##\s*Introduction/i) || line.match(/^##\s*概述/i) || line.match(/^##\s*Background/i)) {
      inIntro = true;
      continue;
    }
    if (inIntro && line.startsWith('##')) {
      break;
    }
    if (inIntro && line.trim() && !line.startsWith('#')) {
      preview += line.trim() + ' ';
      if (preview.length > 200) break;
    }
  }

  if (!preview) {
    // Fallback: get first non-heading, non-empty line
    for (const line of lines) {
      if (line.trim() && !line.startsWith('#') && !line.startsWith('---')) {
        preview = line.trim();
        break;
      }
    }
  }

  return preview.slice(0, 200) + (preview.length > 200 ? '...' : '');
}

function determinePRDStatus(filename: string): PRDItem['status'] {
  // Check if there's an active prd.json that references this PRD
  try {
    const prdJsonPath = getPrdJsonPath();
    if (fs.existsSync(prdJsonPath)) {
      const prdJson = JSON.parse(fs.readFileSync(prdJsonPath, 'utf-8'));
      const baseName = filename.replace(/^prd-/, '').replace(/\.md$/, '');
      const projectName = prdJson.project?.toLowerCase() || '';

      if (projectName.includes(baseName.toLowerCase()) || baseName.toLowerCase().includes(projectName.toLowerCase())) {
        // Check if any tasks are in progress
        const tasks = prdJson.devTasks || [];
        const hasInProgress = tasks.some((t: { passes: boolean }) => !t.passes);
        const allComplete = tasks.every((t: { passes: boolean }) => t.passes);

        if (allComplete) return 'completed';
        if (hasInProgress) return 'in-progress';
      }
    }
  } catch {
    // Ignore errors reading prd.json
  }

  return 'ready';
}

export async function GET() {
  try {
    // Check if tasks directory exists
    if (!fs.existsSync(TASKS_DIR)) {
      return NextResponse.json({ prds: [] });
    }

    // Read all prd-*.md files
    const files = fs.readdirSync(TASKS_DIR);
    const prdFiles = files.filter(f => f.startsWith('prd-') && f.endsWith('.md'));

    const prds: PRDItem[] = prdFiles.map(filename => {
      const filePath = path.join(TASKS_DIR, filename);
      const stats = fs.statSync(filePath);
      const content = fs.readFileSync(filePath, 'utf-8');

      // Generate a simple ID from filename
      const id = filename.replace(/^prd-/, '').replace(/\.md$/, '');

      return {
        id,
        filename,
        name: extractPRDName(content),
        createdAt: stats.birthtime.toISOString(),
        status: determinePRDStatus(filename),
        preview: extractPreview(content),
      };
    });

    // Sort by creation date, newest first
    prds.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return NextResponse.json({ prds });
  } catch (error) {
    console.error('Error reading PRD files:', error);
    return NextResponse.json(
      { error: 'Failed to read PRD files' },
      { status: 500 }
    );
  }
}
