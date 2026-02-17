import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { getTasksDir, getPrdJsonPath, getRegistryPath, getProjectPrdJsonPath } from '@/lib/project-root';

const TASKS_DIR = getTasksDir();

export interface PRDItem {
  id: string;
  name: string;
  filename: string;
  createdAt: string;
  status: 'draft' | 'ready' | 'in-progress' | 'completed' | 'importing';
  stage?: 1 | 2 | 3 | 4 | 5;
  preview?: string;
}

function extractPRDName(content: string): string {
  // Handle import marker files
  if (content.includes('type: import-marker')) {
    const sourceMatch = content.match(/sourcePath:\s*"?([^"\n]+)"?/);
    if (sourceMatch) {
      const sourceName = sourceMatch[1].split('/').pop()?.replace(/\.md$/, '') || '';
      return `导入中: ${sourceName}`;
    }
    return '导入中';
  }

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

function computeStage(tasks: { passes: boolean }[]): 1 | 2 | 3 | 4 | 5 {
  if (tasks.length === 0) return 1;
  const completed = tasks.filter(t => t.passes).length;
  const total = tasks.length;
  const ratio = completed / total;
  if (ratio === 0) return 2;
  if (ratio < 0.8) return 3;
  if (ratio < 1) return 4;
  return 5;
}

function determinePRDStatus(filename: string): { status: PRDItem['status']; stage?: PRDItem['stage'] } {
  // Detect import marker files
  if (filename.includes('-导入转换中')) return { status: 'importing' };

  const baseName = filename.replace(/^prd-/, '').replace(/\.md$/, '');

  // First check registry for project-specific prd.json
  try {
    const registryPath = getRegistryPath();
    if (fs.existsSync(registryPath)) {
      const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
      if (registry.projects?.[baseName]) {
        const projectPrdPath = getProjectPrdJsonPath(baseName);
        if (fs.existsSync(projectPrdPath)) {
          const prdJson = JSON.parse(fs.readFileSync(projectPrdPath, 'utf-8'));
          const tasks: { passes: boolean }[] = prdJson.devTasks || [];
          if (tasks.length > 0) {
            const allComplete = tasks.every(t => t.passes);
            const hasInProgress = tasks.some(t => !t.passes);
            if (allComplete) return { status: 'completed', stage: 5 };
            if (hasInProgress) return { status: 'in-progress', stage: computeStage(tasks) };
          }
          if (registry.projects[baseName].status === 'coding') {
            return { status: 'in-progress', stage: computeStage(tasks) };
          }
          return { status: 'ready', stage: 1 };
        }
      }
    }
  } catch {
    // Fall through to legacy check
  }

  // Fallback: check root prd.json
  try {
    const prdJsonPath = getPrdJsonPath();
    if (fs.existsSync(prdJsonPath)) {
      const prdJson = JSON.parse(fs.readFileSync(prdJsonPath, 'utf-8'));
      const projectName = prdJson.project?.toLowerCase() || '';

      if (projectName.includes(baseName.toLowerCase()) || baseName.toLowerCase().includes(projectName.toLowerCase())) {
        const tasks: { passes: boolean }[] = prdJson.devTasks || [];
        const allComplete = tasks.length > 0 && tasks.every(t => t.passes);
        const hasInProgress = tasks.some(t => !t.passes);

        if (allComplete) return { status: 'completed', stage: 5 };
        if (hasInProgress) return { status: 'in-progress', stage: computeStage(tasks) };
      }
    }
  } catch {
    // Ignore errors reading prd.json
  }

  return { status: 'ready', stage: 1 };
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
      const { status, stage } = determinePRDStatus(filename);

      return {
        id,
        filename,
        name: extractPRDName(content),
        createdAt: stats.birthtime.toISOString(),
        status,
        stage,
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
