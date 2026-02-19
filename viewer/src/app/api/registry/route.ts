import { NextRequest, NextResponse } from 'next/server';
import { readRegistry, withRegistry } from '@/lib/registry-lock';

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

    const registry = await withRegistry((reg) => {
      if (body.activeProject !== undefined) {
        reg.activeProject = body.activeProject;
      }
      return reg;
    });

    return NextResponse.json({ success: true, registry });
  } catch (error) {
    console.error('Registry update error:', error);
    return NextResponse.json(
      { error: 'Failed to update registry' },
      { status: 500 }
    );
  }
}
