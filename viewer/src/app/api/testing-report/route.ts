import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { getTasksDir, normalizeProjectId } from '@/lib/project-root';

/**
 * GET /api/testing-report?projectId=xxx
 * Returns the testing-report.json for a given project.
 * If the file does not exist, returns { report: null }.
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const rawProjectId = url.searchParams.get('projectId') || undefined;
    const projectId = normalizeProjectId(rawProjectId);

    if (!projectId) {
      return NextResponse.json({ report: null });
    }

    const reportPath = path.join(getTasksDir(), projectId, 'testing-report.json');

    if (!fs.existsSync(reportPath)) {
      return NextResponse.json({ report: null });
    }

    const content = fs.readFileSync(reportPath, 'utf-8');
    const report = JSON.parse(content);

    return NextResponse.json({ report });
  } catch (error) {
    console.error('Error reading testing report:', error);
    return NextResponse.json(
      { error: 'Failed to read testing report' },
      { status: 500 }
    );
  }
}
