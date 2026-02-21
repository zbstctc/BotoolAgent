'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { RefreshCw, AlertTriangle, Clock, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ScanResult } from '@/types/scanner';

// --- Types ---

interface ScannerToolbarProps {
  scanResult: ScanResult | null;
  currentPrNumber: number | null;
  needsUpdate: boolean;
  onAnalysisComplete: (result: ScanResult) => void;
  onError: (errorType: string, message: string) => void;
}

// --- Helpers ---

function formatTimeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

const TIMEOUT_MS = 180_000;

// --- Component ---

export function ScannerToolbar({
  scanResult,
  currentPrNumber,
  needsUpdate,
  onAnalysisComplete,
  onError,
}: ScannerToolbarProps) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');
  const [showTimeout, setShowTimeout] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refresh "time ago" display every 30 seconds
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!scanResult) return;
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, [scanResult]);

  const clearTimeoutTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const startTimeoutTimer = useCallback(() => {
    clearTimeoutTimer();
    timeoutRef.current = setTimeout(() => {
      setShowTimeout(true);
    }, TIMEOUT_MS);
  }, [clearTimeoutTimer]);

  const cancelAnalysis = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    clearTimeoutTimer();
    setIsAnalyzing(false);
    setProgressMessage('');
    setShowTimeout(false);
  }, [clearTimeoutTimer]);

  const startAnalysis = useCallback(() => {
    setIsAnalyzing(true);
    setProgressMessage('正在准备分析...');
    setShowTimeout(false);

    const abortController = new AbortController();
    abortRef.current = abortController;

    startTimeoutTimer();

    fetch('/api/scanner/analyze', {
      method: 'POST',
      signal: abortController.signal,
      headers: { 'Content-Type': 'application/json' },
    })
      .then(async (res) => {
        if (res.status === 409) {
          setProgressMessage('已有分析正在进行中...');
          clearTimeoutTimer();
          setIsAnalyzing(false);
          setShowTimeout(false);
          return;
        }

        if (!res.ok) {
          throw new Error(`Server error: ${res.status}`);
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Parse SSE events from buffer
          const events = buffer.split('\n\n');
          buffer = events.pop()!; // Keep incomplete event in buffer

          for (const event of events) {
            const eventMatch = event.match(/^event: (\w+)\ndata: ([\s\S]+)$/);
            if (!eventMatch) continue;
            const [, eventType, dataStr] = eventMatch;

            try {
              const data = JSON.parse(dataStr);

              if (eventType === 'progress') {
                setProgressMessage(data.message);
              } else if (eventType === 'result') {
                onAnalysisComplete(data.scanResult);
                clearTimeoutTimer();
                setIsAnalyzing(false);
                setProgressMessage('');
                setShowTimeout(false);
              } else if (eventType === 'error') {
                onError(data.errorType, data.message);
                clearTimeoutTimer();
                setIsAnalyzing(false);
                setProgressMessage('');
                setShowTimeout(false);
              }
            } catch {
              // Ignore malformed JSON
            }
          }
        }
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') {
          // User cancelled, already handled
          return;
        }
        onError(
          'analysis-failed',
          err instanceof Error ? err.message : 'Unknown error'
        );
        clearTimeoutTimer();
        setIsAnalyzing(false);
        setProgressMessage('');
        setShowTimeout(false);
      });
  }, [onAnalysisComplete, onError, startTimeoutTimer, clearTimeoutTimer]);

  const handleContinueWaiting = useCallback(() => {
    setShowTimeout(false);
    startTimeoutTimer();
  }, [startTimeoutTimer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // --- Timeout UI ---
  if (isAnalyzing && showTimeout) {
    return (
      <div className="absolute top-4 right-4 z-10 max-w-sm rounded-lg border border-amber-200 bg-white p-3 shadow-md">
        <div className="flex items-start gap-2">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-700">
              分析耗时较长
            </p>
            <p className="mt-1 text-xs text-amber-600">
              Codex 分析可能需要较长时间，请耐心等待
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                variant="outline"
                size="xs"
                onClick={handleContinueWaiting}
              >
                继续等待
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={cancelAnalysis}
              >
                <X className="h-3 w-3" />
                取消
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- Analyzing UI ---
  if (isAnalyzing) {
    return (
      <div className="absolute top-4 right-4 z-10 max-w-sm rounded-lg border border-neutral-200 bg-white p-3 shadow-md">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
          </span>
          <p className="flex-1 text-sm text-neutral-700">
            {progressMessage}
          </p>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={cancelAnalysis}
            title="取消分析"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  // --- Normal/needsUpdate UI ---
  return (
    <div className="absolute top-4 right-4 z-10 max-w-sm rounded-lg border border-neutral-200 bg-white shadow-md">
      {/* needsUpdate banner */}
      {needsUpdate && (
        <div className="flex items-center gap-2 rounded-t-lg border-b border-amber-200 bg-amber-50 px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          <p className="flex-1 text-xs text-amber-700">
            PR 已更新，建议重新分析
          </p>
          <Button
            variant="outline"
            size="xs"
            className="border-amber-300 text-amber-700 hover:bg-amber-100"
            onClick={startAnalysis}
          >
            立即分析
          </Button>
        </div>
      )}

      {/* Main toolbar row */}
      <div className="flex items-center gap-2 p-3">
        {currentPrNumber != null && (
          <span className="text-sm font-medium text-neutral-700">
            PR #{currentPrNumber}
          </span>
        )}

        {scanResult != null && (
          <>
            {currentPrNumber != null && (
              <span className="text-neutral-300">&middot;</span>
            )}
            <span className="text-xs text-neutral-500">
              {formatTimeAgo(scanResult.analyzedAt)}
            </span>
          </>
        )}

        <Button
          variant="outline"
          size="xs"
          className={cn(
            'ml-auto',
            !scanResult && !currentPrNumber && 'ml-0'
          )}
          onClick={startAnalysis}
          disabled={isAnalyzing}
        >
          <RefreshCw className="h-3 w-3" />
          {scanResult ? '重新分析' : '开始分析'}
        </Button>
      </div>
    </div>
  );
}
