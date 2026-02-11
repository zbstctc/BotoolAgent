import { NextResponse } from 'next/server';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getPrdJsonPath, getProgressPath, getProjectRoot } from '@/lib/project-root';

const execAsync = promisify(exec);
const PROJECT_ROOT = getProjectRoot();

export interface ReviewSummaryData {
  // Task completion
  totalTasks: number;
  completedTasks: number;

  // Acceptance criteria (Spec compliance)
  totalCriteria: number;
  metCriteria: number;
  deviations: Array<{ taskId: string; content: string; reason: string }>;

  // Code changes
  filesChanged: number;
  additions: number;
  deletions: number;

  // Constitution rules
  rulesApplied: number;
  ruleNames: string[];

  // Security checks ([安全] prefixed items)
  totalSecurityItems: number;
  passedSecurityItems: number;
  securityDetails: Array<{ taskId: string; item: string; passed: boolean }>;

  // Evals
  totalEvals: number;
  passedEvals: number;
  blockingTotal: number;
  blockingPassed: number;
  nonBlockingTotal: number;
  nonBlockingPassed: number;

  // Manual verification suggestions
  manualVerifications: string[];
}

/**
 * Parse prd.json to extract task, constitution, security, and eval data.
 */
function parsePrdData(content: string): {
  totalTasks: number;
  completedTasks: number;
  totalCriteria: number;
  rulesApplied: number;
  ruleNames: string[];
  totalSecurityItems: number;
  securityDetails: Array<{ taskId: string; item: string }>;
  totalEvals: number;
  blockingTotal: number;
  nonBlockingTotal: number;
  evalDetails: Array<{ taskId: string; description: string; blocking: boolean }>;
  manualVerifications: string[];
  acceptanceCriteria: Array<{ taskId: string; criteria: string[] }>;
} {
  try {
    const data = JSON.parse(content);
    const devTasks = data.devTasks || [];

    const totalTasks = devTasks.length;
    const completedTasks = devTasks.filter((t: { passes?: boolean }) => t.passes).length;

    // Acceptance criteria
    let totalCriteria = 0;
    const acceptanceCriteria: Array<{ taskId: string; criteria: string[] }> = [];
    const securityDetails: Array<{ taskId: string; item: string }> = [];
    const manualVerifications: string[] = [];
    let totalSecurityItems = 0;
    let totalEvals = 0;
    let blockingTotal = 0;
    let nonBlockingTotal = 0;
    const evalDetails: Array<{ taskId: string; description: string; blocking: boolean }> = [];

    for (const task of devTasks) {
      const criteria = task.acceptanceCriteria || [];
      totalCriteria += criteria.length;
      acceptanceCriteria.push({ taskId: task.id, criteria });

      // Security items
      for (const c of criteria) {
        if (typeof c === 'string' && c.includes('[安全]')) {
          totalSecurityItems++;
          securityDetails.push({ taskId: task.id, item: c });
        }
        // Manual verification suggestions
        if (typeof c === 'string' && (c.includes('验证') || c.includes('检查') || c.includes('浏览器') || c.includes('手动'))) {
          if (!c.includes('[安全]')) {
            manualVerifications.push(`${task.id}: ${c}`);
          }
        }
      }

      // Evals
      const evals = task.evals || [];
      for (const ev of evals) {
        totalEvals++;
        if (ev.blocking) {
          blockingTotal++;
        } else {
          nonBlockingTotal++;
        }
        evalDetails.push({ taskId: task.id, description: ev.description, blocking: ev.blocking });
      }
    }

    // Constitution rules
    const constitution = data.constitution || {};
    const rules = constitution.rules || [];
    const rulesApplied = rules.length;
    const ruleNames = rules.map((r: { name?: string; id?: string }) => r.name || r.id || '');

    return {
      totalTasks,
      completedTasks,
      totalCriteria,
      rulesApplied,
      ruleNames: ruleNames.filter(Boolean),
      totalSecurityItems,
      securityDetails,
      totalEvals,
      blockingTotal,
      nonBlockingTotal,
      evalDetails,
      manualVerifications,
      acceptanceCriteria,
    };
  } catch {
    return {
      totalTasks: 0,
      completedTasks: 0,
      totalCriteria: 0,
      rulesApplied: 0,
      ruleNames: [],
      totalSecurityItems: 0,
      securityDetails: [],
      totalEvals: 0,
      blockingTotal: 0,
      nonBlockingTotal: 0,
      evalDetails: [],
      manualVerifications: [],
      acceptanceCriteria: [],
    };
  }
}

/**
 * Parse progress.txt to extract Spec compliance results and eval results.
 * Looks for ✅/❌/⬚ markers in spec check sections.
 */
function parseProgressData(content: string): {
  metCriteria: number;
  deviations: Array<{ taskId: string; content: string; reason: string }>;
  passedEvals: number;
  blockingPassed: number;
  nonBlockingPassed: number;
} {
  let metCriteria = 0;
  const deviations: Array<{ taskId: string; content: string; reason: string }> = [];
  let passedEvals = 0;
  let blockingPassed = 0;
  let nonBlockingPassed = 0;

  const lines = content.split('\n');
  let currentTaskId = '';

  for (const line of lines) {
    const trimmed = line.trim();

    // Track current task
    const taskMatch = trimmed.match(/^## .+- (DT-\d+)/);
    if (taskMatch) {
      currentTaskId = taskMatch[1];
    }

    // Count spec compliance markers
    if (trimmed.startsWith('✅')) {
      metCriteria++;
    } else if (trimmed.startsWith('❌')) {
      // Extract deviation reason
      const parts = trimmed.slice(2).split('（');
      const criteriaContent = parts[0]?.trim() || trimmed.slice(2);
      const reason = parts[1]?.replace('）', '').trim() || '';
      deviations.push({ taskId: currentTaskId, content: criteriaContent, reason });
    }

    // Count eval results
    if (trimmed.includes('eval') || trimmed.includes('Eval')) {
      if (trimmed.includes('✅') || trimmed.includes('通过') || trimmed.includes('passed')) {
        passedEvals++;
        if (trimmed.includes('blocking') || trimmed.includes('阻塞')) {
          blockingPassed++;
        } else {
          nonBlockingPassed++;
        }
      }
    }
  }

  return { metCriteria, deviations, passedEvals, blockingPassed, nonBlockingPassed };
}

/**
 * Get code change stats via git diff --stat.
 */
async function getCodeChanges(): Promise<{ filesChanged: number; additions: number; deletions: number }> {
  try {
    const { stdout } = await execAsync(
      'git diff --numstat main...HEAD 2>/dev/null || git diff --numstat main',
      { cwd: PROJECT_ROOT }
    );

    let filesChanged = 0;
    let additions = 0;
    let deletions = 0;

    for (const line of stdout.trim().split('\n').filter(Boolean)) {
      const [add, del] = line.split('\t');
      filesChanged++;
      if (add !== '-') additions += parseInt(add, 10) || 0;
      if (del !== '-') deletions += parseInt(del, 10) || 0;
    }

    return { filesChanged, additions, deletions };
  } catch {
    return { filesChanged: 0, additions: 0, deletions: 0 };
  }
}

/**
 * GET /api/review-summary
 * Returns structured review summary data for Stage 4/5 panels.
 */
export async function GET() {
  try {
    // Read prd.json
    const prdPath = getPrdJsonPath();
    let prdContent = '';
    try {
      if (fs.existsSync(prdPath)) {
        prdContent = fs.readFileSync(prdPath, 'utf-8');
      }
    } catch { /* ignore */ }

    // Read progress.txt
    const progressPath = getProgressPath();
    let progressContent = '';
    try {
      if (fs.existsSync(progressPath)) {
        progressContent = fs.readFileSync(progressPath, 'utf-8');
      }
    } catch { /* ignore */ }

    // Parse data
    const prdData = prdContent ? parsePrdData(prdContent) : null;
    const progressData = progressContent ? parseProgressData(progressContent) : null;
    const codeChanges = await getCodeChanges();

    // Build response - use prd data as base, enrich with progress data
    const summary: ReviewSummaryData = {
      totalTasks: prdData?.totalTasks || 0,
      completedTasks: prdData?.completedTasks || 0,
      totalCriteria: prdData?.totalCriteria || 0,
      metCriteria: progressData?.metCriteria || 0,
      deviations: progressData?.deviations || [],
      filesChanged: codeChanges.filesChanged,
      additions: codeChanges.additions,
      deletions: codeChanges.deletions,
      rulesApplied: prdData?.rulesApplied || 0,
      ruleNames: prdData?.ruleNames || [],
      totalSecurityItems: prdData?.totalSecurityItems || 0,
      passedSecurityItems: 0, // Will be inferred from completed tasks
      securityDetails: (prdData?.securityDetails || []).map(s => ({
        ...s,
        passed: false, // Default, updated below
      })),
      totalEvals: prdData?.totalEvals || 0,
      passedEvals: progressData?.passedEvals || 0,
      blockingTotal: prdData?.blockingTotal || 0,
      blockingPassed: progressData?.blockingPassed || 0,
      nonBlockingTotal: prdData?.nonBlockingTotal || 0,
      nonBlockingPassed: progressData?.nonBlockingPassed || 0,
      manualVerifications: prdData?.manualVerifications || [],
    };

    // Estimate security pass rate from completed tasks
    if (prdData && prdData.totalSecurityItems > 0) {
      const completionRate = prdData.totalTasks > 0 ? prdData.completedTasks / prdData.totalTasks : 0;
      summary.passedSecurityItems = Math.round(prdData.totalSecurityItems * completionRate);
    }

    // If no spec check data in progress.txt, estimate from task completion
    if (summary.metCriteria === 0 && summary.totalCriteria > 0 && summary.completedTasks > 0) {
      const completionRate = summary.totalTasks > 0 ? summary.completedTasks / summary.totalTasks : 0;
      summary.metCriteria = Math.round(summary.totalCriteria * completionRate);
    }

    return NextResponse.json(summary);
  } catch (error) {
    console.error('Error generating review summary:', error);
    return NextResponse.json(
      { error: 'Failed to generate review summary' },
      { status: 500 }
    );
  }
}
