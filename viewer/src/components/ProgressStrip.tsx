'use client';

import { useState, useEffect, useCallback } from 'react';

interface ProgressStripProps {
  completed: number;
  total: number;
  isRunning: boolean;
  agentStartTimestamp?: number;
}

function formatTime(seconds: number): string {
  if (seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m${s.toString().padStart(2, '0')}s`;
}

function formatEta(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  if (minutes <= 1) return '约 1 分钟剩余';
  return `约 ${minutes} 分钟剩余`;
}

export function ProgressStrip({
  completed,
  total,
  isRunning,
  agentStartTimestamp,
}: ProgressStripProps) {
  const [elapsed, setElapsed] = useState(0);

  const computeElapsed = useCallback(() => {
    if (!agentStartTimestamp) return 0;
    return Math.max(0, Math.floor((Date.now() - agentStartTimestamp) / 1000));
  }, [agentStartTimestamp]);

  useEffect(() => {
    if (!isRunning || !agentStartTimestamp) {
      return;
    }

    // Use async callback to avoid synchronous setState in effect body
    const timeout = setTimeout(() => setElapsed(computeElapsed()), 0);

    const interval = setInterval(() => {
      setElapsed(computeElapsed());
    }, 1000);

    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [isRunning, agentStartTimestamp, computeElapsed]);

  // Derive display elapsed: 0 when not running, actual elapsed when running
  const displayElapsed = !isRunning || !agentStartTimestamp ? 0 : elapsed;

  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const isComplete = completed >= total && total > 0;

  const avgTime = completed > 0 ? displayElapsed / completed : 0;
  const eta = completed > 0 ? avgTime * (total - completed) : 0;

  return (
    <div className="h-12 px-4 flex flex-col justify-center gap-0.5">
      {/* Row 1: Progress bar + basic stats */}
      <div className="flex items-center gap-3">
        {/* Progress bar */}
        <div className="flex-1 h-2 rounded-full bg-neutral-200 overflow-hidden">
          <div
            className="h-full rounded-full bg-green-500 transition-all duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>

        {/* Stats text */}
        <span className="text-sm text-neutral-900 whitespace-nowrap font-medium">
          {completed}/{total} 任务 · {percent}%
          {isComplete && (
            <span className="text-neutral-500 font-normal">
              {' '}· 总耗时 {formatTime(displayElapsed)}
            </span>
          )}
        </span>
      </div>

      {/* Row 2: Time info (only when running and not complete) */}
      {isRunning && !isComplete && (
        <div className="text-xs text-neutral-500 flex items-center gap-1">
          <span>⏱</span>
          <span>
            已运行 {formatTime(displayElapsed)}
            {' · '}
            {completed > 0 ? (
              <>
                均速 {formatTime(avgTime)}/任务 · ETA {formatEta(eta)}
              </>
            ) : (
              'ETA 计算中...'
            )}
          </span>
        </div>
      )}
    </div>
  );
}
