/**
 * Adversarial Loop — State machine orchestrator for Codex<->Claude review/fix cycles.
 *
 * Pure TS utility (no React dependency). Calls /api/prd/review and /api/prd/fix
 * via fetch, consuming SSE streams from both endpoints.
 *
 * Business rules implemented:
 *   BR-001: Convergence = HIGH=0 AND MEDIUM=0
 *   BR-002: Max 3 rounds
 *   BR-003: Codex failure retry 1x, 2 consecutive failures => skipped
 *   BR-009: Fail-closed (API error events treated as failures)
 *   BR-012: Cumulative findings across all rounds
 */

import type { ReviewFinding } from '@/app/api/prd/review/route';

// ============================================================================
// Types
// ============================================================================

export type LoopState =
  | 'idle'
  | 'reviewing'
  | 'fixing'
  | 'passed'
  | 'acknowledged'
  | 'skipped';

export interface LoopProgress {
  state: LoopState;
  round: number;
  maxRounds: number;
  findingsCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  message: string;
}

export interface ReviewStepResult {
  status: 'passed' | 'acknowledged' | 'skipped';
  fixedContent: string;
  reviewResult: ReviewResult;
  ruleAuditSummary?: string;
}

export interface ReviewResult {
  status: 'passed' | 'acknowledged' | 'skipped';
  reviewTarget: 'prd' | 'enrich';
  rounds: number;
  duration: number;
  timestamp: string;
  findings: ReviewFinding[];
  highCount: number;
  mediumCount: number;
  lowCount: number;
}

// ============================================================================
// SSE consumer — shared between review and fix API calls
// ============================================================================

interface ReviewCompleteEvent {
  type: 'complete';
  findings: ReviewFinding[];
  reviewTarget: string;
}

interface FixCompleteEvent {
  type: 'complete';
  fixedContent: string;
  target: string;
  findingsCount: number;
}

/**
 * Consume an SSE response stream and extract the final "complete" event payload.
 * Throws on "error" events from the API.
 */
async function consumeSSE<T>(response: Response): Promise<T> {
  const body = response.body;
  if (!body) {
    throw new Error('Response body is null');
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: T | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;

        let data: Record<string, unknown>;
        try {
          data = JSON.parse(jsonStr);
        } catch {
          // Skip malformed SSE lines
          continue;
        }

        if (data.type === 'complete') {
          result = data as T;
        } else if (data.type === 'error') {
          throw new Error(
            (data.error as string) || 'API returned an error event',
          );
        }
        // 'progress' and 'streaming' events are intentionally ignored here
      }
    }
  }

  if (result === null) {
    throw new Error('SSE stream ended without a complete event');
  }

  return result;
}

// ============================================================================
// API call wrappers
// ============================================================================

async function callReviewAPI(
  content: string,
  reviewTarget: 'prd' | 'enrich',
  selectedRuleIds?: string[],
): Promise<{ findings: ReviewFinding[] }> {
  const response = await fetch('/api/prd/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content,
      reviewTarget,
      rules: selectedRuleIds,
    }),
  });

  if (!response.ok) {
    throw new Error(`Review API returned ${response.status}`);
  }

  const event = await consumeSSE<ReviewCompleteEvent>(response);
  return { findings: event.findings };
}

async function callFixAPI(
  content: string,
  findings: ReviewFinding[],
  reviewTarget: 'prd' | 'enrich',
): Promise<{ fixedContent: string }> {
  const response = await fetch('/api/prd/fix', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content,
      findings,
      target: reviewTarget,
    }),
  });

  if (!response.ok) {
    throw new Error(`Fix API returned ${response.status}`);
  }

  const event = await consumeSSE<FixCompleteEvent>(response);
  return { fixedContent: event.fixedContent };
}

// ============================================================================
// ruleAuditSummary generation (PRD review only, per Section 4.3)
// ============================================================================

interface TrackedViolation {
  ruleId: string;
  ruleName: string;
  taskId: string;
  message: string;
  status: 'fixed' | 'acknowledged';
  round: number;
}

/**
 * Build a human-readable summary from cumulative rule-violation findings.
 *
 * Format follows the PRD example:
 *   "审查 N 条规范（M 轮），发现 X 处违规: Y 处已修正, Z 处 acknowledged。
 *    DT-001: API_Rules ... → 已修正(Round 1); ..."
 *
 * If no violations found: "审查 N 条规范（M 轮），未发现违规"
 */
function generateRuleAuditSummary(
  violations: TrackedViolation[],
  totalRounds: number,
  selectedRuleCount: number,
): string {
  if (violations.length === 0) {
    return `审查 ${selectedRuleCount} 条规范（${totalRounds} 轮），未发现违规`;
  }

  const fixedCount = violations.filter((v) => v.status === 'fixed').length;
  const ackedCount = violations.filter(
    (v) => v.status === 'acknowledged',
  ).length;

  let summary = `审查 ${selectedRuleCount} 条规范（${totalRounds} 轮），发现 ${violations.length} 处违规: ${fixedCount} 处已修正, ${ackedCount} 处 acknowledged。`;

  const details = violations.map((v) => {
    const statusLabel =
      v.status === 'fixed'
        ? `已修正(Round ${v.round})`
        : `acknowledged(Round ${v.round})`;
    const taskLabel = v.taskId || 'General';
    return `${taskLabel}: ${v.message} → ${statusLabel}`;
  });

  summary += details.join('; ') + '。';
  return summary;
}

// ============================================================================
// Main: runAdversarialLoop
// ============================================================================

const MAX_ROUNDS = 3;
const MAX_RETRIES = 1;

/**
 * Run the adversarial review/fix loop.
 *
 * State machine: IDLE -> REVIEWING -> [convergence check]
 *   -> HIGH=0 && MEDIUM=0 -> PASSED (done)
 *   -> round >= 3 -> ACKNOWLEDGED (done)
 *   -> FIXING -> REVIEWING (next round)
 *
 * Codex failure: retry 1 time -> 2 consecutive failures -> SKIPPED
 */
export async function runAdversarialLoop(
  content: string,
  reviewTarget: 'prd' | 'enrich',
  _projectId: string,
  options?: {
    selectedRuleIds?: string[];
    onProgress?: (progress: LoopProgress) => void;
  },
): Promise<ReviewStepResult> {
  const startTime = Date.now();
  const onProgress = options?.onProgress;
  const selectedRuleIds = options?.selectedRuleIds;

  let currentContent = content;
  const allFindings: ReviewFinding[] = [];
  const trackedViolations: TrackedViolation[] = [];
  let round = 0;
  let retryCount = 0;
  let status: 'passed' | 'acknowledged' | 'skipped' = 'acknowledged';

  // Helper to build a LoopProgress with current state
  function makeProgress(
    state: LoopState,
    message: string,
    currentRoundFindings?: ReviewFinding[],
  ): LoopProgress {
    // Use current-round findings for counts when available, else use cumulative
    const countSource = currentRoundFindings || allFindings;
    return {
      state,
      round,
      maxRounds: MAX_ROUNDS,
      findingsCount: countSource.length,
      highCount: countSource.filter((f) => f.severity === 'HIGH').length,
      mediumCount: countSource.filter((f) => f.severity === 'MEDIUM').length,
      lowCount: countSource.filter((f) => f.severity === 'LOW').length,
      message,
    };
  }

  // Notify initial idle state
  onProgress?.(makeProgress('idle', '准备开始对抗审查...'));

  while (round < MAX_ROUNDS) {
    round++;

    // ---- REVIEWING phase ----
    onProgress?.(
      makeProgress('reviewing', `第 ${round}/${MAX_ROUNDS} 轮：Codex 审查中...`),
    );

    let roundFindings: ReviewFinding[];

    try {
      const reviewResult = await callReviewAPI(
        currentContent,
        reviewTarget,
        selectedRuleIds,
      );
      retryCount = 0; // Reset on success
      roundFindings = reviewResult.findings;
    } catch (error) {
      // Codex failure — retry logic (BR-003)
      retryCount++;
      if (retryCount > MAX_RETRIES) {
        status = 'skipped';
        onProgress?.(
          makeProgress(
            'skipped',
            `Codex 连续 ${retryCount} 次失败，跳过审查`,
          ),
        );
        break;
      }
      // Don't count failed round
      round--;
      onProgress?.(
        makeProgress(
          'reviewing',
          `第 ${round + 1}/${MAX_ROUNDS} 轮审查失败，正在重试 (${retryCount}/${MAX_RETRIES + 1})...`,
        ),
      );
      continue;
    }

    // Accumulate findings (BR-012: cumulative across all rounds)
    allFindings.push(...roundFindings);

    // Check convergence on current round's findings (BR-001)
    const highCount = roundFindings.filter(
      (f) => f.severity === 'HIGH',
    ).length;
    const mediumCount = roundFindings.filter(
      (f) => f.severity === 'MEDIUM',
    ).length;

    if (highCount === 0 && mediumCount === 0) {
      // Mark any remaining tracked violations from previous rounds as 'fixed'
      // since this round found no issues (convergence)
      status = 'passed';
      onProgress?.(
        makeProgress(
          'passed',
          `第 ${round} 轮审查通过：无 HIGH/MEDIUM findings`,
          roundFindings,
        ),
      );
      break;
    }

    // If at max rounds, acknowledge remaining findings (BR-002)
    if (round >= MAX_ROUNDS) {
      // Track remaining rule-violations as 'acknowledged'
      for (const f of roundFindings) {
        if (f.category === 'rule-violation') {
          trackedViolations.push({
            ruleId: f.ruleId || 'unknown',
            ruleName: f.ruleName || 'unknown',
            taskId: f.taskId || 'unknown',
            message: f.message,
            status: 'acknowledged',
            round,
          });
        }
      }
      status = 'acknowledged';
      onProgress?.(
        makeProgress(
          'acknowledged',
          `达到 ${MAX_ROUNDS} 轮上限，剩余 ${highCount} HIGH / ${mediumCount} MEDIUM findings 已标记 acknowledged`,
          roundFindings,
        ),
      );
      break;
    }

    // Track rule-violations found in this round as 'fixed' (will be fixed in next step)
    for (const f of roundFindings) {
      if (f.category === 'rule-violation') {
        trackedViolations.push({
          ruleId: f.ruleId || 'unknown',
          ruleName: f.ruleName || 'unknown',
          taskId: f.taskId || 'unknown',
          message: f.message,
          status: 'fixed',
          round,
        });
      }
    }

    // ---- FIXING phase ----
    onProgress?.(
      makeProgress(
        'fixing',
        `第 ${round}/${MAX_ROUNDS} 轮：Claude 修正中 (${roundFindings.length} findings)...`,
        roundFindings,
      ),
    );

    try {
      const fixResult = await callFixAPI(
        currentContent,
        roundFindings,
        reviewTarget,
      );
      currentContent = fixResult.fixedContent;
    } catch (error) {
      // Fix API failure also counts toward retries
      retryCount++;
      if (retryCount > MAX_RETRIES) {
        status = 'skipped';
        onProgress?.(
          makeProgress(
            'skipped',
            `Claude 修正失败且重试已用尽，跳过审查`,
          ),
        );
        break;
      }
      // Don't count this round — retry the whole review+fix cycle
      round--;
      continue;
    }
  }

  // ---- Build result ----

  const reviewResult: ReviewResult = {
    status,
    reviewTarget,
    rounds: round,
    duration: Date.now() - startTime,
    timestamp: new Date().toISOString(),
    findings: allFindings,
    highCount: allFindings.filter((f) => f.severity === 'HIGH').length,
    mediumCount: allFindings.filter((f) => f.severity === 'MEDIUM').length,
    lowCount: allFindings.filter((f) => f.severity === 'LOW').length,
  };

  // Generate rule audit summary only for PRD reviews (Section 4.3)
  let ruleAuditSummary: string | undefined;
  if (reviewTarget === 'prd') {
    ruleAuditSummary = generateRuleAuditSummary(
      trackedViolations,
      round,
      selectedRuleIds?.length ?? 0,
    );
  }

  return {
    status,
    fixedContent: currentContent,
    reviewResult,
    ruleAuditSummary,
  };
}
