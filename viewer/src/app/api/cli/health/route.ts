import { NextResponse } from 'next/server';
import { execSync } from 'child_process';

export async function GET() {
  try {
    // Check if claude CLI is available
    execSync('which claude', { timeout: 5000, stdio: 'pipe' });
    return NextResponse.json({ ok: true, timestamp: Date.now() });
  } catch {
    return NextResponse.json(
      { ok: false, error: 'CLI 不可用' },
      { status: 503 }
    );
  }
}
