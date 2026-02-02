'use client';

import { useState } from 'react';

// Test result types matching the API response
export type TestType = 'typecheck' | 'unit' | 'integration' | 'e2e' | 'lint';

export interface TestResult {
  type: TestType;
  name: string;
  status: 'running' | 'passed' | 'failed' | 'skipped';
  output: string;
  passed?: number;
  failed?: number;
  skipped?: number;
  duration?: number;
  coverage?: number;
}

export interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  results: TestResult[];
}

export interface TestResultsProps {
  results: TestResult[];
  summary?: TestSummary | null;
  isRunning?: boolean;
  currentTest?: string;
}

// Status badge component
function StatusBadge({ status }: { status: TestResult['status'] }) {
  const config = {
    running: {
      bg: 'bg-blue-100',
      text: 'text-blue-700',
      label: '运行中',
      icon: (
        <svg className="animate-spin w-3.5 h-3.5 mr-1" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ),
    },
    passed: {
      bg: 'bg-green-100',
      text: 'text-green-700',
      label: '通过',
      icon: (
        <svg className="w-3.5 h-3.5 mr-1" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      ),
    },
    failed: {
      bg: 'bg-red-100',
      text: 'text-red-700',
      label: '失败',
      icon: (
        <svg className="w-3.5 h-3.5 mr-1" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      ),
    },
    skipped: {
      bg: 'bg-neutral-100',
      text: 'text-neutral-600',
      label: '跳过',
      icon: (
        <svg className="w-3.5 h-3.5 mr-1" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM7 9a1 1 0 000 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
        </svg>
      ),
    },
  };

  const { bg, text, label, icon } = config[status];

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${bg} ${text}`}>
      {icon}
      {label}
    </span>
  );
}

// Test type icon
function TestTypeIcon({ type }: { type: TestType }) {
  const icons: Record<TestType, React.ReactNode> = {
    typecheck: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    lint: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
    unit: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
      </svg>
    ),
    integration: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
    e2e: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
  };

  return icons[type];
}

// Format duration
function formatDuration(ms?: number): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// Single test result item
function TestResultItem({ result }: { result: TestResult }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const canExpand = result.status === 'failed' && result.output;

  return (
    <div className="border border-neutral-200 rounded-lg bg-white overflow-hidden">
      {/* Header */}
      <button
        onClick={() => canExpand && setIsExpanded(!isExpanded)}
        disabled={!canExpand}
        className={`w-full px-4 py-3 flex items-center justify-between ${
          canExpand ? 'hover:bg-neutral-50 cursor-pointer' : 'cursor-default'
        }`}
      >
        <div className="flex items-center gap-3">
          {/* Type Icon */}
          <span className="text-neutral-500">
            <TestTypeIcon type={result.type} />
          </span>

          {/* Name */}
          <span className="font-medium text-neutral-900">{result.name}</span>

          {/* Status Badge */}
          <StatusBadge status={result.status} />
        </div>

        <div className="flex items-center gap-4">
          {/* Statistics */}
          {result.status !== 'running' && (result.passed !== undefined || result.failed !== undefined) && (
            <div className="flex items-center gap-2 text-sm">
              {result.passed !== undefined && result.passed > 0 && (
                <span className="text-green-600">{result.passed} 通过</span>
              )}
              {result.failed !== undefined && result.failed > 0 && (
                <span className="text-red-600">{result.failed} 失败</span>
              )}
              {result.skipped !== undefined && result.skipped > 0 && (
                <span className="text-neutral-500">{result.skipped} 跳过</span>
              )}
            </div>
          )}

          {/* Coverage */}
          {result.coverage !== undefined && (
            <span className="text-sm text-neutral-600">
              覆盖率: {result.coverage.toFixed(1)}%
            </span>
          )}

          {/* Duration */}
          {result.duration !== undefined && (
            <span className="text-xs text-neutral-400">
              {formatDuration(result.duration)}
            </span>
          )}

          {/* Expand Arrow */}
          {canExpand && (
            <svg
              className={`w-5 h-5 text-neutral-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          )}
        </div>
      </button>

      {/* Expanded Output */}
      {isExpanded && result.output && (
        <div className="border-t border-neutral-200 bg-neutral-900 p-4 overflow-x-auto">
          <pre className="text-xs text-neutral-100 font-mono whitespace-pre-wrap">
            {result.output}
          </pre>
        </div>
      )}
    </div>
  );
}

// Summary card
function SummaryCard({ summary }: { summary: TestSummary }) {
  const passRate = summary.total > 0
    ? Math.round((summary.passed / summary.total) * 100)
    : 0;

  const allPassed = summary.passed === summary.total && summary.total > 0;

  return (
    <div className={`rounded-lg p-4 ${allPassed ? 'bg-green-50 border border-green-200' : 'bg-neutral-50 border border-neutral-200'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {allPassed ? (
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-green-600" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
          ) : (
            <div className="w-10 h-10 rounded-full bg-neutral-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-neutral-600" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
          )}
          <div>
            <p className={`font-semibold ${allPassed ? 'text-green-900' : 'text-neutral-900'}`}>
              {allPassed ? '所有测试通过！' : '测试完成'}
            </p>
            <p className={`text-sm ${allPassed ? 'text-green-700' : 'text-neutral-600'}`}>
              {summary.passed}/{summary.total} 项测试通过
            </p>
          </div>
        </div>

        {/* Progress Ring */}
        <div className="relative w-16 h-16">
          <svg className="w-16 h-16 transform -rotate-90" viewBox="0 0 36 36">
            {/* Background circle */}
            <circle
              cx="18"
              cy="18"
              r="16"
              fill="none"
              stroke={allPassed ? '#d1fae5' : '#e5e7eb'}
              strokeWidth="3"
            />
            {/* Progress circle */}
            <circle
              cx="18"
              cy="18"
              r="16"
              fill="none"
              stroke={allPassed ? '#10b981' : (summary.failed > 0 ? '#ef4444' : '#6b7280')}
              strokeWidth="3"
              strokeDasharray={`${passRate}, 100`}
              strokeLinecap="round"
            />
          </svg>
          <span className={`absolute inset-0 flex items-center justify-center text-sm font-semibold ${allPassed ? 'text-green-700' : 'text-neutral-700'}`}>
            {passRate}%
          </span>
        </div>
      </div>
    </div>
  );
}

// Main component
export function TestResults({ results, summary, isRunning, currentTest }: TestResultsProps) {
  if (results.length === 0 && !isRunning) {
    return (
      <div className="text-center py-8 text-neutral-500">
        <svg className="w-12 h-12 mx-auto mb-3 text-neutral-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
        </svg>
        <p>暂无测试结果</p>
        <p className="text-sm text-neutral-400 mt-1">点击上方按钮运行测试</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Running indicator */}
      {isRunning && currentTest && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center gap-3">
          <svg className="animate-spin w-5 h-5 text-blue-600" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-blue-700">正在运行: {currentTest}</span>
        </div>
      )}

      {/* Summary */}
      {summary && !isRunning && <SummaryCard summary={summary} />}

      {/* Results list */}
      <div className="space-y-2">
        {results.map((result, index) => (
          <TestResultItem key={`${result.type}-${index}`} result={result} />
        ))}
      </div>
    </div>
  );
}
