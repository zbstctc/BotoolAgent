import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { getProjectRoot } from '@/lib/project-root';

// ── Types (local until DT-004 creates shared types) ────────────────────────

interface ScanResult {
  projectName: string;
  analyzedAt: string;
  prNumber: number | null;
  changedFiles: string[];
  nodes: ScanNode[];
  edges: ScanEdge[];
}

interface ScanNode {
  id: string;
  label: string;
  path: string;
  type: 'root' | 'module' | 'component' | 'utility' | 'config';
  description?: string;
  techStack?: string[];
  features?: { name: string; description?: string; relatedFiles?: string[] }[];
}

interface ScanEdge {
  source: string;
  target: string;
  label?: string;
}

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
    const filePath = path.join(projectRoot, CACHE_FILENAME);
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as ScanResult;
  } catch {
    return null;
  }
}

function getCurrentPrNumber(projectRoot: string): number | null {
  try {
    const output = execSync(
      'gh pr list --head $(git branch --show-current) --json number --limit 1',
      {
        cwd: projectRoot,
        timeout: 10000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    const prs = JSON.parse(output);
    return Array.isArray(prs) && prs.length > 0 ? prs[0].number : null;
  } catch {
    return null; // gh not available or no PR
  }
}

// ── Route handler ───────────────────────────────────────────────────────────

export async function GET() {
  try {
    const projectRoot = getProjectRoot();

    const scanResult = readCachedScanResult(projectRoot);
    const currentPrNumber = getCurrentPrNumber(projectRoot);

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
