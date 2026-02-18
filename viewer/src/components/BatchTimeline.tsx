'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import type { TaskTiming } from '@/hooks/useTaskTimings';
import type { DevTask } from '@/hooks/useFileWatcher';

// ---------- Types ----------

interface BatchTimelineProps {
  batches: TaskTiming[][];
  tasks: DevTask[];
  maxDuration: number;
  currentBatchIndex: number;
}

type TaskStatus = 'completed' | 'in-progress' | 'failed' | 'pending';

// ---------- Helpers ----------

function formatTime(seconds: number): string {
  if (seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m${s.toString().padStart(2, '0')}s`;
}

function getTaskStatus(timing: TaskTiming, task?: DevTask): TaskStatus {
  // Failed: task exists and has explicit fail markers (passes false + endTime set)
  if (task && !task.passes && timing.endTime !== undefined) {
    return 'failed';
  }
  // Completed: has an endTime
  if (timing.endTime !== undefined) {
    return 'completed';
  }
  // In-progress: has a startTime but no endTime, and duration > 0
  if (timing.startTime > 0 && timing.duration > 0) {
    return 'in-progress';
  }
  // Pending: no meaningful timing data
  return 'pending';
}

function getStatusIcon(status: TaskStatus): string {
  switch (status) {
    case 'completed':
      return '\u2713'; // checkmark
    case 'in-progress':
      return '\u2026'; // ellipsis
    case 'failed':
      return '\u2717'; // cross
    case 'pending':
      return '\u2014'; // em dash
  }
}

// ---------- Component ----------

export default function BatchTimeline({
  batches,
  tasks,
  maxDuration,
  currentBatchIndex,
}: BatchTimelineProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const currentBatchRef = useRef<HTMLDivElement>(null);

  // Build a task map for quick lookup
  const taskMap = new Map<string, DevTask>();
  for (const task of tasks) {
    taskMap.set(task.id, task);
  }

  // Ensure maxDuration has a minimum to avoid division by zero
  const effectiveMaxDuration = Math.max(maxDuration, 1);

  // Auto-scroll to current batch
  useEffect(() => {
    if (currentBatchRef.current) {
      currentBatchRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [currentBatchIndex]);

  if (batches.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-neutral-400">
        等待任务数据...
      </div>
    );
  }

  return (
    <div
      ref={scrollContainerRef}
      className="overflow-y-auto"
      style={{ maxHeight: '100%' }}
    >
      {batches.map((batch, batchIdx) => {
        const isCurrent = batchIdx === currentBatchIndex;
        const batchLabel = `B${batchIdx + 1}`;

        return (
          <div
            key={batchIdx}
            ref={isCurrent ? currentBatchRef : undefined}
            className={cn(
              batchIdx > 0 && 'border-t border-neutral-200',
              isCurrent && 'bg-neutral-50',
            )}
          >
            {batch.map((timing, taskIdx) => {
              const task = taskMap.get(timing.taskId);
              const status = getTaskStatus(timing, task);
              const title = task?.title ?? timing.taskId;
              const isFirstInBatch = taskIdx === 0;

              // Bar width as percentage of maxDuration
              const barPercent =
                status === 'pending'
                  ? 0
                  : Math.min(100, (timing.duration / effectiveMaxDuration) * 100);

              return (
                <div
                  key={timing.taskId}
                  className="h-8 flex items-center gap-2 px-3"
                >
                  {/* Batch label or indent */}
                  <span className="w-6 shrink-0 text-xs text-neutral-400 font-mono text-right">
                    {isFirstInBatch ? batchLabel : ''}
                  </span>

                  {/* Task ID */}
                  <span className="w-14 shrink-0 text-xs font-mono text-neutral-500 truncate">
                    {timing.taskId}
                  </span>

                  {/* Task title */}
                  <span className="w-32 shrink-0 text-xs text-neutral-700 truncate" title={title}>
                    {title}
                  </span>

                  {/* Progress bar */}
                  <div className="flex-1 min-w-0" style={{ maxWidth: '50%' }}>
                    <div className="h-3 rounded-full overflow-hidden bg-neutral-100">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all duration-500',
                          status === 'completed' && 'bg-green-500',
                          status === 'in-progress' && 'bg-neutral-700 animate-pulse',
                          status === 'failed' && 'bg-red-500',
                          status === 'pending' && 'bg-neutral-200',
                        )}
                        style={{ width: `${barPercent}%` }}
                      />
                    </div>
                  </div>

                  {/* Duration */}
                  <span className="w-14 shrink-0 text-xs font-mono text-neutral-500 text-right">
                    {status === 'pending'
                      ? '\u2014'
                      : status === 'in-progress'
                        ? `${formatTime(timing.duration)}...`
                        : formatTime(timing.duration)}
                  </span>

                  {/* Status icon */}
                  <span
                    className={cn(
                      'w-4 shrink-0 text-xs text-center',
                      status === 'completed' && 'text-green-600',
                      status === 'in-progress' && 'text-neutral-500',
                      status === 'failed' && 'text-red-600',
                      status === 'pending' && 'text-neutral-300',
                    )}
                  >
                    {getStatusIcon(status)}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
