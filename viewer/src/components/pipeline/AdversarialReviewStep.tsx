'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { TerminalActivityFeed } from '@/components/TerminalActivityFeed';
import { useSimulatedProgress } from '@/hooks/useSimulatedProgress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ReviewFinding } from '@/app/api/prd/review/route';

// ============================================================================
// Types
// ============================================================================

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

export interface ReviewStepResult {
  status: 'passed' | 'acknowledged' | 'skipped';
  fixedContent: string;
  reviewResult: ReviewResult;
  ruleAuditSummary?: string;
}

interface AdversarialReviewStepProps {
  reviewTarget: 'prd' | 'enrich';
  content: string;
  selectedRuleIds?: string[];
  projectId?: string;
  onComplete: (result: ReviewStepResult) => void;
  onBack?: () => void;
}

// Adversarial loop state
type ReviewState = 'idle' | 'reviewing' | 'fixing' | 'completed' | 'error';

const MAX_ROUNDS = 3;
const MAX_RETRIES = 1;

// ============================================================================
// SSE stream reader helper
// ============================================================================

async function readSSEStream(
  response: Response,
  onData: (data: Record<string, unknown>) => void,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Unable to read response stream');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const raw = line.slice(6).trim();
        if (!raw) continue;
        try {
          onData(JSON.parse(raw));
        } catch {
          // Skip unparseable SSE data
        }
      }
    }
  }
}

// ============================================================================
// Component
// ============================================================================

export function AdversarialReviewStep({
  reviewTarget,
  content,
  selectedRuleIds,
  onComplete,
  onBack,
}: AdversarialReviewStepProps) {
  // State
  const [state, setState] = useState<ReviewState>('idle');
  const [progress, setProgress] = useState(0);
  const [realProgress, setRealProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Result tracking
  const [currentRound, setCurrentRound] = useState(0);
  const [findings, setFindings] = useState<ReviewFinding[]>([]);
  const [finalStatus, setFinalStatus] = useState<'passed' | 'acknowledged' | 'skipped' | null>(null);
  const [fixedContent, setFixedContent] = useState('');
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null);

  // Refs
  const abortControllerRef = useRef<AbortController | null>(null);
  const hasStartedRef = useRef(false);
  const autoCompletedRef = useRef(false);
  const startTimeRef = useRef(0);

  // Terminal line helper
  const addTerminalLine = useCallback((line: string) => {
    setTerminalLines(prev => [...prev.slice(-19), line]);
  }, []);

  // Simulated progress
  useSimulatedProgress({
    isActive: state === 'reviewing' || state === 'fixing',
    realProgress,
    setProgress,
    setMessage,
    addTerminalLine,
  });

  // ============================================================================
  // API calls
  // ============================================================================

  const callReview = useCallback(async (
    contentToReview: string,
    signal: AbortSignal,
  ): Promise<{ findings: ReviewFinding[] } | null> => {
    const response = await fetch('/api/prd/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: contentToReview,
        reviewTarget,
        rules: reviewTarget === 'prd' ? selectedRuleIds : undefined,
      }),
      signal,
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error || 'Review API call failed');
    }

    let resultFindings: ReviewFinding[] | null = null;
    let errorMsg: string | null = null;

    await readSSEStream(response, (data) => {
      if (data.type === 'progress' && typeof data.message === 'string') {
        addTerminalLine(data.message.slice(0, 50));
        setRealProgress(prev => Math.min(prev + 5, 90));
      } else if (data.type === 'complete') {
        resultFindings = (data.findings as ReviewFinding[]) || [];
      } else if (data.type === 'error') {
        errorMsg = (data.error as string) || 'Unknown review error';
      }
    });

    if (errorMsg) throw new Error(errorMsg);
    if (resultFindings === null) throw new Error('Review completed without findings result');

    return { findings: resultFindings };
  }, [reviewTarget, selectedRuleIds, addTerminalLine]);

  const callFix = useCallback(async (
    contentToFix: string,
    fixFindings: ReviewFinding[],
    signal: AbortSignal,
  ): Promise<string | null> => {
    const response = await fetch('/api/prd/fix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: contentToFix,
        findings: fixFindings,
        target: reviewTarget,
      }),
      signal,
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error || 'Fix API call failed');
    }

    let result: string | null = null;
    let errorMsg: string | null = null;

    await readSSEStream(response, (data) => {
      if (data.type === 'progress' && typeof data.message === 'string') {
        addTerminalLine(data.message.slice(0, 50));
        setRealProgress(prev => Math.min(prev + 3, 90));
      } else if (data.type === 'streaming') {
        // Partial content streaming - just show activity
        setRealProgress(prev => Math.min(prev + 1, 85));
      } else if (data.type === 'complete') {
        result = (data.fixedContent as string) || null;
      } else if (data.type === 'error') {
        errorMsg = (data.error as string) || 'Unknown fix error';
      }
    });

    if (errorMsg) throw new Error(errorMsg);
    return result;
  }, [reviewTarget, addTerminalLine]);

  // ============================================================================
  // Rule audit summary extraction
  // ============================================================================

  const extractRuleAuditSummary = useCallback((allFindings: ReviewFinding[]): string | undefined => {
    const ruleViolations = allFindings.filter(f => f.category === 'rule-violation');
    if (ruleViolations.length === 0) return undefined;

    // Group by ruleId
    const grouped = new Map<string, { name: string; count: number }>();
    for (const v of ruleViolations) {
      const key = v.ruleId || 'unknown';
      const existing = grouped.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        grouped.set(key, { name: v.ruleName || key, count: 1 });
      }
    }

    const lines: string[] = [];
    for (const [ruleId, { name, count }] of grouped.entries()) {
      lines.push(`${ruleId} (${name}): ${count} violation${count > 1 ? 's' : ''}`);
    }
    return lines.join('\n');
  }, []);

  // ============================================================================
  // Adversarial loop
  // ============================================================================

  const runAdversarialLoop = useCallback(async () => {
    startTimeRef.current = Date.now();
    let currentContent = content;
    let retryCount = 0;
    let allFindings: ReviewFinding[] = [];
    let round = 0;
    let converged = false;

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    for (round = 1; round <= MAX_ROUNDS; round++) {
      // REVIEW PHASE
      setCurrentRound(round);
      setState('reviewing');
      setRealProgress(0);
      setProgress(() => 0);
      addTerminalLine(`Round ${round}/${MAX_ROUNDS}: starting review...`);
      setMessage(`第 ${round} 轮审查中...`);

      let reviewResult: { findings: ReviewFinding[] } | null = null;
      try {
        reviewResult = await callReview(currentContent, signal);
        retryCount = 0; // Reset retry on success
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;

        retryCount++;
        addTerminalLine(`Round ${round}: review failed (attempt ${retryCount})`);

        if (retryCount <= MAX_RETRIES) {
          addTerminalLine(`Retrying review...`);
          try {
            reviewResult = await callReview(currentContent, signal);
            retryCount = 0;
          } catch (retryErr) {
            if (retryErr instanceof Error && retryErr.name === 'AbortError') return;
            retryCount++;
          }
        }

        if (retryCount > MAX_RETRIES) {
          // Two consecutive failures -> SKIPPED
          const duration = Date.now() - startTimeRef.current;
          const result: ReviewResult = {
            status: 'skipped',
            reviewTarget,
            rounds: round,
            duration,
            timestamp: new Date().toISOString(),
            findings: allFindings,
            highCount: allFindings.filter(f => f.severity === 'HIGH').length,
            mediumCount: allFindings.filter(f => f.severity === 'MEDIUM').length,
            lowCount: allFindings.filter(f => f.severity === 'LOW').length,
          };
          setFindings(allFindings);
          setFinalStatus('skipped');
          setFixedContent(currentContent);
          setReviewResult(result);
          setState('completed');
          setProgress(() => 100);
          setMessage('审查跳过');
          addTerminalLine('Review skipped: consecutive failures');
          return;
        }
      }

      if (!reviewResult) continue;

      allFindings = reviewResult.findings;
      setFindings(reviewResult.findings);

      const highCount = reviewResult.findings.filter(f => f.severity === 'HIGH').length;
      const mediumCount = reviewResult.findings.filter(f => f.severity === 'MEDIUM').length;
      const lowCount = reviewResult.findings.filter(f => f.severity === 'LOW').length;

      addTerminalLine(`Round ${round}: ${highCount} HIGH, ${mediumCount} MEDIUM, ${lowCount} LOW`);

      // CHECK CONVERGENCE
      if (highCount === 0 && mediumCount === 0) {
        converged = true;
        addTerminalLine(`Round ${round}: converged (PASSED)`);
        break;
      }

      // If this is the last round and not converged, don't fix
      if (round === MAX_ROUNDS) {
        addTerminalLine(`Round ${round}: max rounds reached (ACKNOWLEDGED)`);
        break;
      }

      // FIX PHASE
      setState('fixing');
      setRealProgress(0);
      setProgress(() => 0);
      addTerminalLine(`Round ${round}: Claude fixing content...`);
      setMessage(`第 ${round} 轮修正中...`);

      try {
        const fixed = await callFix(currentContent, reviewResult.findings, signal);
        if (fixed) {
          currentContent = fixed;
          setFixedContent(fixed);
          addTerminalLine(`Round ${round}: fix completed`);
        } else {
          addTerminalLine(`Round ${round}: fix returned empty, using original`);
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        addTerminalLine(`Round ${round}: fix failed, continuing with current content`);
      }
    }

    // Build final result
    const duration = Date.now() - startTimeRef.current;
    const status = converged ? 'passed' : 'acknowledged';
    const finalHighCount = allFindings.filter(f => f.severity === 'HIGH').length;
    const finalMediumCount = allFindings.filter(f => f.severity === 'MEDIUM').length;
    const finalLowCount = allFindings.filter(f => f.severity === 'LOW').length;

    const result: ReviewResult = {
      status,
      reviewTarget,
      rounds: round > MAX_ROUNDS ? MAX_ROUNDS : round,
      duration,
      timestamp: new Date().toISOString(),
      findings: allFindings,
      highCount: finalHighCount,
      mediumCount: finalMediumCount,
      lowCount: finalLowCount,
    };

    setFinalStatus(status);
    setFixedContent(currentContent);
    setReviewResult(result);
    setState('completed');
    setProgress(() => 100);
    setMessage(status === 'passed' ? '审查通过' : '审查完成（已确认放行）');
    addTerminalLine(status === 'passed'
      ? `Completed: PASSED in ${round} round${round > 1 ? 's' : ''}`
      : `Completed: ACKNOWLEDGED after ${MAX_ROUNDS} rounds`);
  }, [content, reviewTarget, selectedRuleIds, callReview, callFix, addTerminalLine]);

  // ============================================================================
  // Auto-trigger on mount
  // ============================================================================

  useEffect(() => {
    if (hasStartedRef.current) return;
    if (!content) return;
    hasStartedRef.current = true;
    runAdversarialLoop();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================================================
  // Auto-complete after 1s delay
  // ============================================================================

  useEffect(() => {
    if (state !== 'completed' || !reviewResult || autoCompletedRef.current) return;
    autoCompletedRef.current = true;

    const ruleAuditSummary = extractRuleAuditSummary(findings);

    const timer = setTimeout(() => {
      onComplete({
        status: reviewResult.status,
        fixedContent: fixedContent || content,
        reviewResult,
        ruleAuditSummary,
      });
    }, 1000);

    return () => clearTimeout(timer);
  }, [state, reviewResult, findings, fixedContent, content, onComplete, extractRuleAuditSummary]);

  // ============================================================================
  // Render: Processing state
  // ============================================================================

  if (state === 'idle' || state === 'reviewing' || state === 'fixing' || state === 'error') {
    const isError = state === 'error';
    const title = reviewTarget === 'prd' ? 'PRD 对抗性审查' : 'Enrich 对抗性审查';

    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md">
          {/* Progress Header */}
          <div className="text-center mb-6">
            {isError ? (
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
                <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
            ) : (
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-neutral-200 flex items-center justify-center">
                <div className="animate-spin w-8 h-8 border-4 border-neutral-500 border-t-transparent rounded-full" />
              </div>
            )}
            <h3 className="text-lg font-semibold text-neutral-900">
              {isError ? '审查失败' : title}
            </h3>
            <p className="text-sm text-neutral-500 mt-1">
              {state === 'idle' ? '准备中...' : message}
            </p>
            {currentRound > 0 && !isError && (
              <p className="text-xs text-neutral-400 mt-1">
                Round {currentRound}/{MAX_ROUNDS}
              </p>
            )}
            {error && (
              <p className="text-sm text-red-600 mt-2">{error}</p>
            )}
          </div>

          {/* Progress Bar */}
          <div className="mb-6">
            <div className="flex justify-between text-sm text-neutral-600 mb-2">
              <span>进度</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="w-full h-2 bg-neutral-200 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  isError ? 'bg-red-500' : 'bg-neutral-700'
                }`}
                style={{ width: `${Math.round(progress)}%` }}
              />
            </div>
          </div>

          {/* Terminal Activity Feed */}
          {!isError && (
            <div className="flex justify-center mb-4">
              <TerminalActivityFeed lines={terminalLines} />
            </div>
          )}

          {/* Error action buttons */}
          {isError && (
            <div className="flex justify-center gap-4">
              {onBack && (
                <Button
                  variant="ghost"
                  onClick={onBack}
                >
                  返回
                </Button>
              )}
              <Button
                onClick={() => {
                  hasStartedRef.current = false;
                  autoCompletedRef.current = false;
                  setError(null);
                  setState('idle');
                  setTerminalLines([]);
                  setProgress(() => 0);
                  setRealProgress(0);
                  setCurrentRound(0);
                  hasStartedRef.current = true;
                  runAdversarialLoop();
                }}
                className="bg-neutral-900 text-white hover:bg-neutral-800"
              >
                重试
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ============================================================================
  // Render: Completed state
  // ============================================================================

  if (state === 'completed' && reviewResult) {
    const title = reviewTarget === 'prd' ? 'PRD 对抗性审查' : 'Enrich 对抗性审查';

    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md">
          {/* Header */}
          <div className="text-center mb-6">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-neutral-200 flex items-center justify-center">
              {finalStatus === 'passed' ? (
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : finalStatus === 'skipped' ? (
                <svg className="w-8 h-8 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                </svg>
              ) : (
                <svg className="w-8 h-8 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              )}
            </div>
            <h3 className="text-lg font-semibold text-neutral-900">{title}</h3>
            <p className="text-sm text-neutral-500 mt-1">
              {reviewResult.rounds} 轮审查完成
              {reviewResult.duration > 0 && ` (${Math.round(reviewResult.duration / 1000)}s)`}
            </p>
          </div>

          {/* Findings summary badges */}
          <div className="flex justify-center gap-3 mb-4">
            <Badge variant="error">HIGH: {reviewResult.highCount}</Badge>
            <Badge variant="warning">MEDIUM: {reviewResult.mediumCount}</Badge>
            <Badge variant="neutral">LOW: {reviewResult.lowCount}</Badge>
          </div>

          {/* Status badge */}
          <div className="flex justify-center mb-6">
            {finalStatus === 'passed' && (
              <Badge variant="success" className="text-sm px-3 py-1">PASSED</Badge>
            )}
            {finalStatus === 'acknowledged' && (
              <Badge variant="warning" className="text-sm px-3 py-1">ACKNOWLEDGED</Badge>
            )}
            {finalStatus === 'skipped' && (
              <Badge variant="neutral" className="text-sm px-3 py-1">SKIPPED</Badge>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex justify-center gap-4">
            {onBack && (
              <Button
                variant="ghost"
                onClick={onBack}
              >
                返回
              </Button>
            )}
            <Button
              onClick={() => {
                if (!autoCompletedRef.current) {
                  autoCompletedRef.current = true;
                  const ruleAuditSummary = extractRuleAuditSummary(findings);
                  onComplete({
                    status: reviewResult.status,
                    fixedContent: fixedContent || content,
                    reviewResult,
                    ruleAuditSummary,
                  });
                }
              }}
              className="bg-neutral-900 text-white hover:bg-neutral-800"
            >
              继续
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
