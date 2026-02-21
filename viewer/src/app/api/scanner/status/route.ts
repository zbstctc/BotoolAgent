import { NextResponse } from 'next/server';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { getProjectRoot, ensureContainedPath } from '@/lib/project-root';
import type { ScanResult } from '@/types/scanner';

// ── Types ───────────────────────────────────────────────────────────────────

interface StatusResponse {
  hasResult: boolean;
  scanResult?: ScanResult;
  currentPrNumber: number | null;
  needsUpdate: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const CACHE_FILENAME = '.botoolagent-scan-result.json';

function readCachedScanResult(projectRoot: string): ScanResult | null {
  try {
    const filePath = ensureContainedPath(projectRoot, CACHE_FILENAME);
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as ScanResult;
  } catch {
    return null;
  }
}

function getCurrentPrNumber(projectRoot: string): Promise<number | null> {
  return new Promise((resolve) => {
    // First get current branch name
    execFile('git', ['branch', '--show-current'], {
      cwd: projectRoot,
      timeout: 5000,
    }, (gitErr, branchOut) => {
      if (gitErr) { resolve(null); return; }
      const branch = branchOut.trim();
      if (!branch) { resolve(null); return; }

      // Then query gh for PR number on this branch
      execFile('gh', ['pr', 'list', '--head', branch, '--json', 'number', '--limit', '1'], {
        cwd: projectRoot,
        timeout: 10000,
      }, (ghErr, ghOut) => {
        if (ghErr) { resolve(null); return; }
        try {
          const prs = JSON.parse(ghOut);
          resolve(Array.isArray(prs) && prs.length > 0 ? prs[0].number : null);
        } catch {
          resolve(null);
        }
      });
    });
  });
}

// ── Route handler ───────────────────────────────────────────────────────────

export async function GET() {
  try {
    const projectRoot = getProjectRoot();

    const scanResult = readCachedScanResult(projectRoot);
    const currentPrNumber = await getCurrentPrNumber(projectRoot);

    const hasResult = scanResult !== null;

    // needsUpdate: true when cached PR number differs from current PR
    const needsUpdate = hasResult
      ? scanResult.prNumber !== currentPrNumber
      : false;

    const response: StatusResponse = {
      hasResult,
      ...(hasResult ? { scanResult } : {}),
      currentPrNumber,
      needsUpdate,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Failed to get scanner status:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get scanner status' },
      { status: 500 },
    );
  }
}
