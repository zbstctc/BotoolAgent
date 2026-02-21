'use client';

import { useState, useEffect, useCallback } from 'react';
import { Scan, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScannerErrorView, type ScannerErrorType } from '@/components/Scanner/ScannerErrorView';
import { ScannerFlowChart } from '@/components/Scanner/ScannerFlowChart';
import { ScannerToolbar } from '@/components/Scanner/ScannerToolbar';
import type { ScanResult } from '@/types/scanner';

interface StatusResponse {
  hasResult: boolean;
  scanResult?: ScanResult;
  currentPrNumber: number | null;
  needsUpdate: boolean;
}

interface FatalError {
  errorType: ScannerErrorType;
  detail?: string;
}

/** Map SSE error types to fatal ScannerErrorType (non-fatal types return undefined) */
const FATAL_ERROR_MAP: Record<string, ScannerErrorType | undefined> = {
  'codex-not-installed': 'codex-not-installed',
  'analysis-failed': 'analysis-failed',
  'parse-error': 'json-parse-error',
};

export function ScannerPanel() {
  const [isLoading, setIsLoading] = useState(true);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [needsUpdate, setNeedsUpdate] = useState(false);
  const [currentPrNumber, setCurrentPrNumber] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fatalError, setFatalError] = useState<FatalError | null>(null);

  const clearFatalError = useCallback(() => {
    setFatalError(null);
  }, []);

  const handleAnalysisComplete = useCallback((result: ScanResult) => {
    setScanResult(result);
    setNeedsUpdate(false);
  }, []);

  const handleError = useCallback((errorType: string, message: string) => {
    const fatalType = FATAL_ERROR_MAP[errorType];
    if (fatalType) {
      setFatalError({ errorType: fatalType, detail: message });
    }
    // Non-fatal errors (e.g., 'concurrent-request') handled by ScannerToolbar
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      setFatalError(null);
      const res = await fetch('/api/scanner/status');
      if (!res.ok) {
        throw new Error(`Status check failed: ${res.status}`);
      }
      const data: StatusResponse = await res.json();
      setScanResult(data.scanResult ?? null);
      setNeedsUpdate(data.needsUpdate);
      setCurrentPrNumber(data.currentPrNumber);
    } catch (err) {
      console.error('Failed to fetch scanner status:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch status');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-neutral-200 bg-white">
          <Scan className="h-4 w-4 text-neutral-500" />
          <h1 className="text-sm font-medium text-neutral-900">Scanner</h1>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
        </div>
      </div>
    );
  }

  // Fatal error state — render ScannerErrorView
  if (fatalError) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-neutral-200 bg-white">
          <Scan className="h-4 w-4 text-neutral-500" />
          <h1 className="text-sm font-medium text-neutral-900">Scanner</h1>
        </div>
        <div className="flex-1">
          <ScannerErrorView
            errorType={fatalError.errorType}
            detail={fatalError.detail}
            onRetry={clearFatalError}
          />
        </div>
      </div>
    );
  }

  // Error state (non-fatal, just retry)
  if (error) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-neutral-200 bg-white">
          <Scan className="h-4 w-4 text-neutral-500" />
          <h1 className="text-sm font-medium text-neutral-900">Scanner</h1>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <p className="text-sm text-neutral-500">无法获取扫描状态</p>
          <Button variant="outline" size="sm" onClick={fetchStatus}>
            重试
          </Button>
        </div>
      </div>
    );
  }

  // Empty state — no cached result
  if (!scanResult) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-neutral-200 bg-white">
          <Scan className="h-4 w-4 text-neutral-500" />
          <h1 className="text-sm font-medium text-neutral-900">Scanner</h1>
        </div>
        <div className="flex-1 relative">
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="text-4xl text-neutral-200">
              <Scan className="h-12 w-12" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-neutral-700">
                尚未分析项目结构
              </p>
              <p className="mt-1 text-xs text-neutral-500 max-w-xs">
                Scanner 通过 Codex CLI 分析项目结构，生成交互式架构图谱
              </p>
            </div>
          </div>
          <ScannerToolbar
            scanResult={null}
            currentPrNumber={currentPrNumber}
            needsUpdate={false}
            onAnalysisComplete={handleAnalysisComplete}
            onError={handleError}
          />
        </div>
      </div>
    );
  }

  // Has cached result — show flow chart + toolbar
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-neutral-200 bg-white">
        <Scan className="h-4 w-4 text-neutral-500" />
        <h1 className="text-sm font-medium text-neutral-900">Scanner</h1>
        <span className="text-xs text-neutral-400">
          {scanResult.projectName}
        </span>
      </div>
      <div className="flex-1 relative">
        <ScannerFlowChart key={scanResult.analyzedAt} scanResult={scanResult} />
        <ScannerToolbar
          scanResult={scanResult}
          currentPrNumber={currentPrNumber}
          needsUpdate={needsUpdate}
          onAnalysisComplete={handleAnalysisComplete}
          onError={handleError}
        />
      </div>
    </div>
  );
}
