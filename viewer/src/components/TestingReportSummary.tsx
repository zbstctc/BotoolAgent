'use client';

import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface LayerResult {
  id: string;
  name: string;
  status: 'pass' | 'fail' | 'skipped';
  fixCount?: number;
  rounds?: number;
  adversarialRounds?: number;
  findingsTotal?: number;
  fixed?: number;
  rejected?: number;
  prUrl?: string;
  agentComments?: number;
  fixRounds?: number;
}

interface TestingReport {
  layers: LayerResult[];
  verdict: 'all_pass' | 'has_failures' | 'circuit_breaker';
  prReady: boolean;
  prUrl?: string;
  timestamp: string;
}

export interface TestingReportSummaryProps {
  projectId?: string;
  /** Called when report data is loaded, exposing verdict to parent */
  onReportLoaded?: (report: TestingReport | null) => void;
}

const STATUS_CONFIG = {
  pass: { icon: '\u2713', className: 'text-green-600', badgeVariant: 'success' as const },
  fail: { icon: '\u2717', className: 'text-red-600', badgeVariant: 'error' as const },
  skipped: { icon: '\u2013', className: 'text-neutral-400', badgeVariant: 'neutral' as const },
} as const;

const VERDICT_CONFIG = {
  all_pass: { label: '全部通过', badgeVariant: 'success' as const },
  has_failures: { label: '有失败项', badgeVariant: 'error' as const },
  circuit_breaker: { label: '需人工介入', badgeVariant: 'warning' as const },
} as const;

export function TestingReportSummary({ projectId, onReportLoaded }: TestingReportSummaryProps) {
  const [report, setReport] = useState<TestingReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setIsLoading(false);
      return;
    }

    const fetchReport = async () => {
      try {
        setIsLoading(true);
        setHasError(false);
        const response = await fetch(`/api/testing-report?projectId=${encodeURIComponent(projectId)}`);
        if (response.ok) {
          const data = await response.json();
          setReport(data.report || null);
          onReportLoaded?.(data.report || null);
        } else {
          setHasError(true);
          onReportLoaded?.(null);
        }
      } catch {
        console.error('Failed to fetch testing report');
        setHasError(true);
        onReportLoaded?.(null);
      } finally {
        setIsLoading(false);
      }
    };

    fetchReport();
    // onReportLoaded is intentionally excluded from deps to avoid infinite loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Loading state
  if (isLoading) {
    return (
      <div className="bg-white border border-neutral-200 rounded-lg p-4">
        <div className="flex items-center gap-3">
          <span className="w-4 h-4 border-2 border-neutral-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-neutral-500">Loading testing report...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (hasError) {
    return (
      <div className="bg-white border border-neutral-200 rounded-lg p-4">
        <p className="text-sm text-red-600">Failed to load testing report.</p>
      </div>
    );
  }

  // Empty state (no report file)
  if (!report) {
    return (
      <div className="bg-white border border-neutral-200 rounded-lg p-4">
        <p className="text-sm text-neutral-500">No testing report available yet. Run the testing pipeline first.</p>
      </div>
    );
  }

  const verdictConfig = VERDICT_CONFIG[report.verdict];

  return (
    <div className="bg-white border border-neutral-200 rounded-lg p-4 space-y-4">
      {/* Header with verdict */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-900">Quality Report</h3>
        <Badge variant={verdictConfig.badgeVariant}>{verdictConfig.label}</Badge>
      </div>

      {/* Layer results */}
      <div className="space-y-2">
        {report.layers.map((layer) => {
          const config = STATUS_CONFIG[layer.status];
          return (
            <div
              key={layer.id}
              className="flex items-center justify-between py-1.5 border-b border-neutral-100 last:border-b-0"
            >
              <div className="flex items-center gap-2">
                <span className={cn('text-sm font-medium w-5 text-center', config.className)}>
                  {config.icon}
                </span>
                <span className="text-sm text-neutral-700">
                  {layer.id}: {layer.name}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {layer.fixCount !== undefined && layer.fixCount > 0 && (
                  <span className="text-xs text-neutral-500">
                    {layer.fixCount} fix{layer.fixCount > 1 ? 'es' : ''}
                  </span>
                )}
                <Badge variant={config.badgeVariant} className="text-[10px] px-1.5 py-0">
                  {layer.status}
                </Badge>
              </div>
            </div>
          );
        })}
      </div>

      {/* PR URL if available */}
      {report.prUrl && (
        <div className="pt-2 border-t border-neutral-100">
          <a
            href={report.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-neutral-600 hover:underline"
          >
            View PR on GitHub &rarr;
          </a>
        </div>
      )}
    </div>
  );
}
