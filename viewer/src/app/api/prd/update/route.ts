import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

// Path to project root (parent of viewer)
const PROJECT_ROOT = path.join(process.cwd(), '..');

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
  try {
    const body: PrdJson = await request.json();

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

    // Write to prd.json
    const prdJsonPath = path.join(PROJECT_ROOT, 'prd.json');
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
