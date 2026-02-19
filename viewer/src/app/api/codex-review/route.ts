import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { getTasksDir, normalizeProjectId } from '@/lib/project-root';

// --- Data types ---

export interface CodexFinding {
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  category: 'security' | 'logic' | 'error-handling' | 'test-coverage' | 'style';
  rule: string;
  file: string;
  line: number;
  message: string;
  suggestion: string;
}

export interface CodexReviewOutput {
  findings: CodexFinding[];
}

export interface RejectionRecord {
  finding: string;
  reason: string;
  codexAccepted: boolean;
}

export interface AdversarialRound {
  round: number;
  codexFindings: number;
  fixed: number;
  rejected: number;
  rejectionReasons: RejectionRecord[];
  remaining: number;
}

export interface AdversarialState {
  round: number;
  maxRounds: number;
  status: 'in_progress' | 'converged' | 'circuit_breaker';
  rounds: AdversarialRound[];
}

export interface CodexReviewResponse {
  findings: CodexFinding[];
  adversarialState: AdversarialState | null;
}

// --- Handler ---

/**
 * GET /api/codex-review?projectId=xxx
 * Returns Codex red-team review findings and adversarial loop state.
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const rawProjectId = url.searchParams.get('projectId');
    const projectId = normalizeProjectId(rawProjectId);

    if (!projectId) {
      return NextResponse.json(
        { error: 'Missing or invalid projectId' },
        { status: 400 }
      );
    }

    const projectDir = path.join(getTasksDir(), projectId);

    // Read codex-review.json
    let findings: CodexFinding[] = [];
    const reviewPath = path.join(projectDir, 'codex-review.json');
    try {
      if (fs.existsSync(reviewPath)) {
        const raw = fs.readFileSync(reviewPath, 'utf-8');
        const parsed: CodexReviewOutput = JSON.parse(raw);
        findings = parsed.findings || [];
      }
    } catch {
      // File missing or malformed — return empty findings
    }

    // Read adversarial-state.json
    let adversarialState: AdversarialState | null = null;
    const statePath = path.join(projectDir, 'adversarial-state.json');
    try {
      if (fs.existsSync(statePath)) {
        const raw = fs.readFileSync(statePath, 'utf-8');
        adversarialState = JSON.parse(raw) as AdversarialState;
      }
    } catch {
      // File missing or malformed — return null
    }

    const response: CodexReviewResponse = { findings, adversarialState };
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error reading codex review data:', error);
    return NextResponse.json(
      { error: 'Failed to read codex review data' },
      { status: 500 }
    );
  }
}
