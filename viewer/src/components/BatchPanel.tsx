'use client';

import { cn } from '@/lib/utils';
import type { DevTask } from '@/hooks';
import type { UseTeammatesReturn, TeammateInfo } from '@/hooks/useTeammates';
import type { UseTaskTimingsReturn, TaskTiming } from '@/hooks/useTaskTimings';

// ---------- Props ----------

export interface BatchPanelProps {
  teammates: UseTeammatesReturn;
  timings: UseTaskTimingsReturn;
  tasks: DevTask[];
  currentTaskId: string | null;
  isRunning: boolean;
  isComplete: boolean;
}

// ---------- Helpers ----------

function formatTime(seconds: number): string {
  if (seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m${s.toString().padStart(2, '0')}s`;
}

function getTimerColorClass(duration: number, avgTime: number): string {
  if (avgTime <= 0) return 'text-neutral-700';
  if (duration >= avgTime * 3) return 'text-red-600';
  if (duration >= avgTime * 2) return 'text-amber-600';
  return 'text-neutral-700';
}

function getGridColsClass(count: number): string {
  switch (count) {
    case 2:
      return 'grid-cols-2';
    case 3:
      return 'grid-cols-3';
    case 4:
      return 'grid-cols-4';
    default:
      return count >= 5 ? 'grid-cols-3' : 'grid-cols-1';
  }
}

function findTaskForTeammate(
  teammate: TeammateInfo,
  tasks: DevTask[],
): DevTask | undefined {
  return tasks.find((t) => t.id === teammate.id);
}

function findTimingForTask(
  taskId: string,
  timings: TaskTiming[],
): TaskTiming | undefined {
  return timings.find((t) => t.taskId === taskId);
}

// ---------- Sub-components ----------

/** A single teammate card in parallel mode (compact) */
function TeammateCard({
  teammate,
  task,
  timing,
  avgTime,
}: {
  teammate: TeammateInfo;
  task: DevTask | undefined;
  timing: TaskTiming | undefined;
  avgTime: number;
}) {
  const isRunning = teammate.status === 'running';
  const isCompleted = teammate.status === 'completed';
  const isFailed = teammate.status === 'failed';

  const duration = timing?.duration ?? 0;
  const timerColor = isRunning
    ? getTimerColorClass(duration, avgTime)
    : 'text-neutral-700';

  return (
    <div
      className={cn(
        'rounded-lg border bg-white p-3 transition-all',
        isRunning && 'border-2 task-card-breathing',
        isCompleted && 'border-2 border-green-400',
        isFailed && 'border-2 border-red-300',
        !isRunning && !isCompleted && !isFailed && 'border-neutral-200',
      )}
    >
      {/* ID + Status indicator */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-mono text-neutral-400">
          {teammate.id}
        </span>
        {isCompleted && (
          <span className="text-green-500 text-sm leading-none">{'\u2713'}</span>
        )}
        {isFailed && (
          <span className="text-red-500 text-xs leading-none">{'\u2717'}</span>
        )}
        {isRunning && (
          <span className="w-2 h-2 bg-neutral-500 rounded-full animate-pulse" />
        )}
      </div>

      {/* Title */}
      <p className="text-sm font-medium text-neutral-900 truncate mb-2">
        {task?.title ?? teammate.id}
      </p>

      {/* Timer */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-neutral-400">{'\u23F1'}</span>
        <span className={cn('text-xs font-mono', timerColor)}>
          {formatTime(duration)}
        </span>
      </div>

      {/* Status label */}
      <div className="mt-1.5">
        {isRunning && (
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 border-2 border-neutral-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-neutral-600">{'\u25CF'} {'\u6267\u884C\u4E2D'}</span>
          </div>
        )}
        {isCompleted && (
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 bg-green-500 rounded-full" />
            <span className="text-xs text-green-700">{'\u25CB'} {'\u5DF2\u5B8C\u6210'}</span>
          </div>
        )}
        {isFailed && (
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 bg-red-500 rounded-full" />
            <span className="text-xs text-red-600">{'\u5931\u8D25'}</span>
          </div>
        )}
        {teammate.status === 'pending' && (
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 border-2 border-neutral-300 rounded-full" />
            <span className="text-xs text-neutral-500">{'\u7B49\u5F85\u4E2D'}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Single task detail card in serial mode */
function SerialDetailCard({
  teammate,
  task,
  timing,
  avgTime,
  iterationCount,
}: {
  teammate: TeammateInfo;
  task: DevTask | undefined;
  timing: TaskTiming | undefined;
  avgTime: number;
  iterationCount: number;
}) {
  const isRunning = teammate.status === 'running';
  const isCompleted = teammate.status === 'completed';
  const isFailed = teammate.status === 'failed';

  const duration = timing?.duration ?? 0;
  const timerColor = isRunning
    ? getTimerColorClass(duration, avgTime)
    : 'text-neutral-700';

  return (
    <div
      className={cn(
        'rounded-lg border bg-white p-4 transition-all',
        isRunning && 'border-2 task-card-breathing',
        isCompleted && 'border-2 border-green-400',
        isFailed && 'border-2 border-red-300',
        !isRunning && !isCompleted && !isFailed && 'border-neutral-200',
      )}
    >
      {/* Header row: ID + PRD Section */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-mono text-neutral-400">
          {teammate.id}
        </span>
        {task?.prdSection && (
          <span className="text-xs text-neutral-400">
            PRD {'\u00A7'}{task.prdSection}
          </span>
        )}
      </div>

      {/* Title */}
      <p className="text-sm font-medium text-neutral-900 mb-3">
        {task?.title ?? teammate.id}
      </p>

      {/* Timer + Iteration row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1">
          <span className="text-xs text-neutral-400">{'\u23F1'}</span>
          <span className={cn('text-sm font-mono', timerColor)}>
            {formatTime(duration)}
          </span>
        </div>
        {iterationCount > 0 && (
          <span className="text-xs text-neutral-500">
            {'\u8FED\u4EE3'} #{iterationCount}
          </span>
        )}
      </div>

      {/* Acceptance criteria */}
      {task?.acceptanceCriteria && task.acceptanceCriteria.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-medium text-neutral-500 mb-1.5">
            {'\u9A8C\u6536\u6807\u51C6'}:
          </p>
          <ul className="space-y-1">
            {task.acceptanceCriteria.map((criterion, idx) => (
              <li
                key={idx}
                className="text-xs flex items-start gap-1.5 text-neutral-600"
              >
                {isCompleted ? (
                  <span className="text-green-500 flex-shrink-0">{'\u2713'}</span>
                ) : isRunning ? (
                  <span className="text-neutral-400 flex-shrink-0">{'\u23F3'}</span>
                ) : (
                  <span className="w-3 h-3 flex-shrink-0 border border-neutral-300 rounded-sm mt-0.5" />
                )}
                <span>{criterion}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Bottom row: Status */}
      <div className="flex items-center justify-between pt-2 border-t border-neutral-100">
        <span className="text-xs text-neutral-400">
          {'\u91CD\u8BD5'}: {'\u65E0'}
        </span>
        <div className="flex items-center gap-1.5">
          {isRunning && (
            <>
              <span className="w-2 h-2 border-2 border-neutral-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-neutral-600">{'\u6267\u884C\u4E2D'}</span>
            </>
          )}
          {isCompleted && (
            <>
              <span className="text-green-500 text-xs">{'\u2713'}</span>
              <span className="text-xs text-green-700">{'\u5DF2\u5B8C\u6210'}</span>
            </>
          )}
          {isFailed && (
            <>
              <span className="text-red-500 text-xs">{'\u2717'}</span>
              <span className="text-xs text-red-600">{'\u5931\u8D25'}</span>
            </>
          )}
          {teammate.status === 'pending' && (
            <>
              <span className="w-2 h-2 border-2 border-neutral-300 rounded-full" />
              <span className="text-xs text-neutral-500">{'\u7B49\u5F85\u4E2D'}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Main component ----------

export default function BatchPanel({
  teammates,
  timings,
  tasks,
  currentTaskId,
  isRunning,
  isComplete,
}: BatchPanelProps) {
  const { batchIndex, teammates: teammateList, isParallel } = teammates;

  // Count iteration entries for the current task from timings
  const iterationCount = currentTaskId
    ? timings.timings.filter((t) => t.taskId === currentTaskId).length
    : 0;

  // --- Empty state: agent not running and no teammates ---
  if (!isRunning && teammateList.length === 0 && !isComplete) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-6">
        <div className="flex flex-col items-center justify-center text-center py-4">
          <div className="w-10 h-10 rounded-full border-2 border-neutral-200 flex items-center justify-center mb-3">
            <span className="text-neutral-300 text-lg">{'\u25B6'}</span>
          </div>
          <p className="text-sm font-medium text-neutral-700">
            {'\u7B49\u5F85\u542F\u52A8\u4EE3\u7406'}...
          </p>
          <p className="text-xs text-neutral-400 mt-1">
            {'\u70B9\u51FB'}{'\u201C'}{'\u542F\u52A8\u4EE3\u7406'}{'\u201D'}{'\u5F00\u59CB\u6267\u884C\u5F00\u53D1\u4EFB\u52A1'}
          </p>
        </div>
      </div>
    );
  }

  // --- Complete state: all tasks done ---
  if (isComplete) {
    return (
      <div className="rounded-lg border-2 border-green-400 bg-white p-6">
        <div className="flex flex-col items-center justify-center text-center py-4">
          <div className="w-10 h-10 rounded-full bg-green-50 border-2 border-green-400 flex items-center justify-center mb-3">
            <span className="text-green-500 text-lg">{'\u2713'}</span>
          </div>
          <p className="text-sm font-medium text-neutral-900">
            {'\u5168\u90E8\u4EFB\u52A1\u5DF2\u5B8C\u6210'}
          </p>
          <p className="text-xs text-neutral-500 mt-1">
            {'\u6240\u6709\u5F00\u53D1\u4EFB\u52A1\u5DF2\u6210\u529F\u5B8C\u6210\uFF0C\u53EF\u4EE5\u8FDB\u5165\u4E0B\u4E00\u9636\u6BB5'}
          </p>
        </div>
      </div>
    );
  }

  // --- Active state ---
  const teammateCount = teammateList.length;

  return (
    <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
      {/* Batch header */}
      <div className="px-4 py-2.5 border-b border-neutral-100 bg-neutral-50">
        <span className="text-xs font-medium text-neutral-700">
          {'\u5F53\u524D\u6279\u6B21'}: Batch {batchIndex + 1}
          {isParallel && (
            <span className="text-neutral-400">
              {' \u00B7 '}{teammateCount} {'\u4E2A'} Teammate {'\u5E76\u884C'}
            </span>
          )}
          {!isParallel && teammateCount === 1 && (
            <span className="text-neutral-400">{' \u00B7 '}{'\u4E32\u884C\u6267\u884C'}</span>
          )}
        </span>
      </div>

      {/* Content */}
      <div className="p-3">
        {isParallel ? (
          /* Parallel mode: card grid */
          <div className={cn('grid gap-3', getGridColsClass(teammateCount))}>
            {teammateList.map((tm) => (
              <TeammateCard
                key={tm.id}
                teammate={tm}
                task={findTaskForTeammate(tm, tasks)}
                timing={findTimingForTask(tm.id, timings.timings)}
                avgTime={timings.avgTime}
              />
            ))}
          </div>
        ) : (
          /* Serial mode: detail card for the single task */
          teammateList.length > 0 && (
            <SerialDetailCard
              teammate={teammateList[0]}
              task={findTaskForTeammate(teammateList[0], tasks)}
              timing={findTimingForTask(teammateList[0].id, timings.timings)}
              avgTime={timings.avgTime}
              iterationCount={iterationCount}
            />
          )
        )}
      </div>
    </div>
  );
}
