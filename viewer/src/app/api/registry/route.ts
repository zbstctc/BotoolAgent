import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import { getRegistryPath } from '@/lib/project-root';

interface RegistryProject {
  name: string;
  prdMd: string;
  prdJson: string;
  progress: string;
  branch: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface Registry {
  version: number;
  projects: Record<string, RegistryProject>;
  activeProject: string | null;
}

function readRegistry(): Registry {
  const registryPath = getRegistryPath();
  try {
    if (fs.existsSync(registryPath)) {
      return JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    }
  } catch {
    // Ignore
  }
  return { version: 1, projects: {}, activeProject: null };
}

function writeRegistry(registry: Registry): void {
  const registryPath = getRegistryPath();
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
}

/**
 * GET /api/registry
 * Returns the project registry
 */
export async function GET() {
  const registry = readRegistry();
  return NextResponse.json(registry);
}

/**
 * PATCH /api/registry
 * Update registry (e.g., switch active project)
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const registry = readRegistry();

    if (body.activeProject !== undefined) {
      registry.activeProject = body.activeProject;
    }

    writeRegistry(registry);
    return NextResponse.json({ success: true, registry });
  } catch (error) {
    console.error('Registry update error:', error);
    return NextResponse.json(
      { error: 'Failed to update registry' },
      { status: 500 }
    );
  }
}
