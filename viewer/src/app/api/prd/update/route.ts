import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import { getProjectPrdJsonPath, normalizeProjectId } from '@/lib/project-root';
import { verifyCsrfProtection } from '@/lib/api-guard';

interface DevTask {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  priority: number;
  passes: boolean;
  notes: string;
}

interface PrdJson {
  project: string;
  branchName: string;
  description: string;
  devTasks: DevTask[];
}

export async function POST(request: NextRequest) {
  const csrfError = verifyCsrfProtection(request);
  if (csrfError) return csrfError;

  try {
    const body: PrdJson & { projectId?: string } = await request.json();

    // Validate projectId (if provided) to prevent path traversal
    if (body.projectId) {
      const safeProjectId = normalizeProjectId(body.projectId);
      if (!safeProjectId) {
        return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
      }
      body.projectId = safeProjectId;
    }

    // Validate required fields
    if (!body.project || !body.branchName || !body.devTasks) {
      return NextResponse.json(
        { error: 'Missing required fields: project, branchName, or devTasks' },
        { status: 400 }
      );
    }

    // Validate devTasks structure
    if (!Array.isArray(body.devTasks)) {
      return NextResponse.json(
        { error: 'devTasks must be an array' },
        { status: 400 }
      );
    }

    // Update priorities based on array order
    const updatedPrd: PrdJson = {
      ...body,
      devTasks: body.devTasks.map((task, index) => ({
        ...task,
        priority: index + 1,
      })),
    };

    // Write to prd.json (project-specific if projectId provided, otherwise root)
    const prdJsonPath = getProjectPrdJsonPath(body.projectId);
    fs.writeFileSync(prdJsonPath, JSON.stringify(updatedPrd, null, 2));

    return NextResponse.json({
      success: true,
      message: 'prd.json updated successfully',
      savedTo: prdJsonPath,
    });
  } catch (error) {
    console.error('Update PRD error:', error);
    return NextResponse.json(
      { error: 'Failed to update prd.json' },
      { status: 500 }
    );
  }
}
