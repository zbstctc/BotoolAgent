import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { getTasksDir, getProjectPrdJsonPath, getRegistryPath, getProjectSessionPath } from '@/lib/project-root';

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

/**
 * Determine status for a project by its ID.
 * Reads tasks/{projectId}/prd.json for progress info.
 * Falls back to registry for additional metadata.
 */
function determinePRDStatusById(projectId: string, content?: string): { status: PRDItem['status']; stage?: PRDItem['stage'] } {
  // Detect import marker files
  if (content?.includes('type: import-marker')) return { status: 'importing' };

  // Check per-project prd.json
  try {
    const registryPath = getRegistryPath();
    if (fs.existsSync(registryPath)) {
      const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
      if (registry.projects?.[projectId]) {
        const projectPrdPath = getProjectPrdJsonPath(projectId);
        if (fs.existsSync(projectPrdPath)) {
          const prdJson = JSON.parse(fs.readFileSync(projectPrdPath, 'utf-8'));
          const tasks: { passes: boolean }[] = prdJson.devTasks || [];
          if (tasks.length > 0) {
            const allComplete = tasks.every(t => t.passes);
            const hasInProgress = tasks.some(t => !t.passes);
            if (allComplete) return { status: 'completed', stage: 5 };
            if (hasInProgress) return { status: 'in-progress', stage: computeStage(tasks) };
          }
          if (registry.projects[projectId].status === 'coding') {
            return { status: 'in-progress', stage: computeStage(tasks) };
          }
          return { status: 'ready', stage: 1 };
        }
      }
    }
  } catch {
    // Fall through
  }

  // Check per-project prd.json without registry
  try {
    const projectPrdPath = getProjectPrdJsonPath(projectId);
    if (fs.existsSync(projectPrdPath)) {
      const prdJson = JSON.parse(fs.readFileSync(projectPrdPath, 'utf-8'));
      const tasks: { passes: boolean }[] = prdJson.devTasks || [];
      if (tasks.length > 0) {
        const allComplete = tasks.every(t => t.passes);
        const hasInProgress = tasks.some(t => !t.passes);
        if (allComplete) return { status: 'completed', stage: 5 };
        if (hasInProgress) return { status: 'in-progress', stage: computeStage(tasks) };
      }
      return { status: 'ready', stage: 1 };
    }
  } catch {
    // Ignore
  }

  return { status: 'ready', stage: 1 };
}

/**
 * Legacy: Determine status from flat prd-{id}.md filename.
 * Used for backward compat when reading old-format files.
 */
function determinePRDStatusLegacy(filename: string): { status: PRDItem['status']; stage?: PRDItem['stage'] } {
  if (filename.includes('-导入转换中')) return { status: 'importing' };
  const projectId = filename.replace(/^prd-/, '').replace(/\.md$/, '');
  return determinePRDStatusById(projectId);
}

export async function GET() {
  try {
    // Check if tasks directory exists
    if (!fs.existsSync(TASKS_DIR)) {
      return NextResponse.json({ prds: [] });
    }

    const prds: PRDItem[] = [];

    // Build set of project IDs that were transformed from another source (should be hidden)
    const transformedProjectIds = new Set<string>();

    // --- New format: scan tasks/*/prd.md ---
    try {
      const entries = fs.readdirSync(TASKS_DIR, { withFileTypes: true });
      const projectDirs = entries.filter(e => e.isDirectory());

      // Collect transformedFrom info from per-project sessions
      for (const dir of projectDirs) {
        const sessionPath = getProjectSessionPath(dir.name);
        if (fs.existsSync(sessionPath)) {
          try {
            const session = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
            if (session.transformedFrom) {
              // transformedFrom is the source project id (directory name)
              transformedProjectIds.add(session.transformedFrom);
            }
          } catch { /* non-fatal */ }
        }
      }

      for (const dir of projectDirs) {
        if (transformedProjectIds.has(dir.name)) continue;

        const prdMdPath = path.join(TASKS_DIR, dir.name, 'prd.md');
        if (!fs.existsSync(prdMdPath)) continue;

        try {
          const stats = fs.statSync(prdMdPath);
          const content = fs.readFileSync(prdMdPath, 'utf-8');
          const { status, stage } = determinePRDStatusById(dir.name, content);

          prds.push({
            id: dir.name,
            filename: `${dir.name}/prd.md`,
            name: extractPRDName(content),
            createdAt: stats.birthtime.toISOString(),
            status,
            stage,
            preview: extractPreview(content),
          });
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // Directory scan failed
    }

    // --- Legacy format: scan tasks/prd-*.md flat files ---
    // Also read old global .prd-sessions.json for backward compat
    const legacyTransformedSources = new Set<string>();
    try {
      const sessionsPath = path.join(TASKS_DIR, '.prd-sessions.json');
      if (fs.existsSync(sessionsPath)) {
        const sessions = JSON.parse(fs.readFileSync(sessionsPath, 'utf-8'));
        for (const entry of Object.values(sessions)) {
          const src = (entry as Record<string, string>).transformedFrom;
          if (src) legacyTransformedSources.add(src);
        }
      }
    } catch { /* non-fatal */ }

    try {
      const files = fs.readdirSync(TASKS_DIR);
      const legacyPrdFiles = files.filter(f =>
        f.startsWith('prd-') && f.endsWith('.md') && !legacyTransformedSources.has(f)
      );

      // Track project IDs already added from new format to avoid duplicates
      const addedIds = new Set(prds.map(p => p.id));

      for (const filename of legacyPrdFiles) {
        const legacyId = filename.replace(/^prd-/, '').replace(/\.md$/, '');
        if (addedIds.has(legacyId)) continue; // already added from new format

        const filePath = path.join(TASKS_DIR, filename);
        try {
          const stats = fs.statSync(filePath);
          const content = fs.readFileSync(filePath, 'utf-8');
          const { status, stage } = determinePRDStatusLegacy(filename);

          prds.push({
            id: legacyId,
            filename,
            name: extractPRDName(content),
            createdAt: stats.birthtime.toISOString(),
            status,
            stage,
            preview: extractPreview(content),
          });
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // Legacy scan failed
    }

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
