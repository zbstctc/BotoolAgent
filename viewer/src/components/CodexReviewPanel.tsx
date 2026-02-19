'use client';

import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type {
  CodexFinding,
  AdversarialState,
  CodexReviewResponse,
} from '@/app/api/codex-review/route';

export interface CodexReviewPanelProps {
  projectId?: string;
}

// --- Severity helpers ---

const severityVariant: Record<CodexFinding['severity'], 'error' | 'warning' | 'neutral'> = {
  HIGH: 'error',
  MEDIUM: 'warning',
  LOW: 'neutral',
};

const severityLabel: Record<CodexFinding['severity'], string> = {
  HIGH: 'HIGH',
  MEDIUM: 'MED',
  LOW: 'LOW',
};

// --- Sub-components ---

function StatItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-2.5">
      <span className="text-lg font-bold text-neutral-900">{value}</span>
      <span className="text-xs text-neutral-500">{label}</span>
    </div>
  );
}

function FindingCard({
  finding,
  isExpanded,
  onToggle,
}: {
  finding: CodexFinding;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
      {/* Header row */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-start gap-2.5 p-3 text-left hover:bg-neutral-50 transition-colors"
      >
        <Badge variant={severityVariant[finding.severity]} className="mt-0.5 shrink-0">
          {severityLabel[finding.severity]}
        </Badge>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-neutral-700">{finding.rule}</span>
            <span className="text-xs text-neutral-400">
              {finding.file}:{finding.line}
            </span>
          </div>
          <p className="text-sm text-neutral-600 mt-0.5 leading-snug">{finding.message}</p>
        </div>
        <svg
          className={cn(
            'w-4 h-4 text-neutral-400 transition-transform shrink-0 mt-1',
            isExpanded && 'rotate-180'
          )}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {/* Suggestion (collapsible) */}
      {isExpanded && finding.suggestion && (
        <div className="border-t border-neutral-100 bg-neutral-50 px-3 py-2.5">
          <p className="text-xs font-medium text-neutral-500 mb-1">Suggestion</p>
          <p className="text-sm text-neutral-700 leading-snug">{finding.suggestion}</p>
        </div>
      )}
    </div>
  );
}

// --- Main component ---

export function CodexReviewPanel({ projectId }: CodexReviewPanelProps) {
  const [findings, setFindings] = useState<CodexFinding[]>([]);
  const [adversarialState, setAdversarialState] = useState<AdversarialState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!projectId) {
      setIsLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        setIsLoading(true);
        setHasError(false);
        const url = `/api/codex-review?projectId=${encodeURIComponent(projectId)}`;
        const response = await fetch(url);
        if (!response.ok) {
          setHasError(true);
          return;
        }
        const data: CodexReviewResponse = await response.json();
        setFindings(data.findings);
        setAdversarialState(data.adversarialState);
      } catch {
        setHasError(true);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [projectId]);

  // --- Derived stats ---

  const latestRound = adversarialState?.rounds[adversarialState.rounds.length - 1];
  const roundLabel = adversarialState
    ? `${adversarialState.round}/${adversarialState.maxRounds}`
    : '0/3';
  const totalFindings = findings.length;
  const totalFixed = latestRound?.fixed ?? 0;
  const totalRejected = latestRound?.rejected ?? 0;

  // --- Loading state ---

  if (isLoading) {
    return (
      <div className="bg-white border border-neutral-200 rounded-lg p-4 animate-pulse" data-testid="codex-review-loading">
        <div className="h-5 bg-neutral-100 rounded w-40 mb-3" />
        <div className="grid grid-cols-4 gap-2 mb-4">
          <div className="h-14 bg-neutral-100 rounded" />
          <div className="h-14 bg-neutral-100 rounded" />
          <div className="h-14 bg-neutral-100 rounded" />
          <div className="h-14 bg-neutral-100 rounded" />
        </div>
        <div className="space-y-2">
          <div className="h-12 bg-neutral-100 rounded" />
          <div className="h-12 bg-neutral-100 rounded" />
        </div>
      </div>
    );
  }

  // --- Error state ---

  if (hasError) {
    return (
      <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-4 text-center text-neutral-500 text-sm">
        Unable to load Codex review data
      </div>
    );
  }

  // --- Empty state ---

  const isEmpty = totalFindings === 0 && adversarialState === null;

  if (isEmpty) {
    return (
      <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-4 text-center text-neutral-500 text-sm">
        No Codex red-team review results yet
      </div>
    );
  }

  // --- Status badge ---

  const statusBadge = (() => {
    if (!adversarialState) return null;
    switch (adversarialState.status) {
      case 'converged':
        return <Badge variant="success">Converged</Badge>;
      case 'circuit_breaker':
        return <Badge variant="warning">Circuit Breaker</Badge>;
      case 'in_progress':
        return <Badge variant="neutral">In Progress</Badge>;
      default:
        return null;
    }
  })();

  // --- Severity counts ---

  const highCount = findings.filter((f) => f.severity === 'HIGH').length;
  const mediumCount = findings.filter((f) => f.severity === 'MEDIUM').length;
  const lowCount = findings.filter((f) => f.severity === 'LOW').length;

  return (
    <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-neutral-200 flex items-center justify-center">
            <span className="text-sm">🛡</span>
          </div>
          <div>
            <h3 className="font-semibold text-neutral-900 text-sm">Codex Red-Team Review</h3>
            <p className="text-xs text-neutral-500">
              Round {roundLabel}
              {totalFindings > 0 && ` · ${totalFindings} finding${totalFindings !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>
        {statusBadge}
      </div>

      {/* Stats */}
      <div className="border-t border-neutral-200 p-4">
        <div className="grid grid-cols-4 gap-2">
          <StatItem label="Round" value={roundLabel} />
          <StatItem label="Findings" value={totalFindings} />
          <StatItem label="Fixed" value={totalFixed} />
          <StatItem label="Rejected" value={totalRejected} />
        </div>
      </div>

      {/* Severity breakdown */}
      {totalFindings > 0 && (
        <div className="border-t border-neutral-200 px-4 py-2.5 flex items-center gap-3">
          <span className="text-xs text-neutral-500">By severity:</span>
          {highCount > 0 && (
            <Badge variant="error">{highCount} HIGH</Badge>
          )}
          {mediumCount > 0 && (
            <Badge variant="warning">{mediumCount} MED</Badge>
          )}
          {lowCount > 0 && (
            <Badge variant="neutral">{lowCount} LOW</Badge>
          )}
        </div>
      )}

      {/* Findings list */}
      {totalFindings > 0 && (
        <div className="border-t border-neutral-200 p-4 space-y-2">
          <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">
            Findings
          </h4>
          {findings.map((finding, index) => (
            <FindingCard
              key={`${finding.file}-${finding.line}-${finding.rule}-${index}`}
              finding={finding}
              isExpanded={expandedIndex === index}
              onToggle={() =>
                setExpandedIndex(expandedIndex === index ? null : index)
              }
            />
          ))}
        </div>
      )}

      {/* Adversarial rounds history */}
      {adversarialState && adversarialState.rounds.length > 0 && (
        <div className="border-t border-neutral-200 p-4">
          <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">
            Round History
          </h4>
          <div className="space-y-1.5">
            {adversarialState.rounds.map((round) => (
              <div
                key={round.round}
                className="flex items-center justify-between rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2 text-xs"
              >
                <span className="font-medium text-neutral-700">
                  Round {round.round}
                </span>
                <div className="flex items-center gap-3 text-neutral-500">
                  <span>{round.codexFindings} found</span>
                  <span className="text-green-600">{round.fixed} fixed</span>
                  <span className="text-amber-600">{round.rejected} rejected</span>
                  <span>{round.remaining} remaining</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
