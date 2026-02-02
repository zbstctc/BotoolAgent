'use client';

import { useState } from 'react';
import Link from 'next/link';

// Task status type
export type TaskStatus = 'running' | 'completed' | 'partial' | 'failed' | 'waiting_merge';

// Task stage type
export type TaskStage = 1 | 2 | 3 | 4 | 5;

// Task history item
export interface TaskHistoryItem {
  id: string;
  name: string;
  description?: string;
  branchName?: string;
  status: TaskStatus;
  stage: TaskStage;
  tasksCompleted: number;
  tasksTotal: number;
  startTime: string;
  endTime?: string;
  isMerged: boolean;
  prUrl?: string;
}

export interface TaskHistoryProps {
  tasks: TaskHistoryItem[];
  loading?: boolean;
  onContinue?: (task: TaskHistoryItem) => void;
  onMerge?: (task: TaskHistoryItem) => void;
  onDelete?: (task: TaskHistoryItem) => void;
  onRefresh?: () => void;
}

// Stage info
const stageInfo: Record<TaskStage, { name: string; shortName: string }> = {
  1: { name: 'PRD 需求确认', shortName: 'PRD' },
  2: { name: '开发规划', shortName: '规划' },
  3: { name: 'Coding', shortName: 'Code' },
  4: { name: '测试', shortName: '测试' },
  5: { name: 'Review', shortName: 'Review' },
};

// Status styles
const statusStyles: Record<TaskStatus, { bg: string; text: string; border: string }> = {
  running: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  completed: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
  partial: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  failed: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  waiting_merge: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
};

const statusLabels: Record<TaskStatus, string> = {
  running: '运行中',
  completed: '已完成',
  partial: '部分完成',
  failed: '失败',
  waiting_merge: '待合并',
};

const statusIcons: Record<TaskStatus, string> = {
  running: '●',
  completed: '✓',
  partial: '◐',
  failed: '✗',
  waiting_merge: '↗',
};

// Format relative time
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins} 分钟前`;
  if (diffHours < 24) return `${diffHours} 小时前`;
  if (diffDays < 7) return `${diffDays} 天前`;

  return date.toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
  });
}

// Format date for timeline
function formatTimelineDate(dateStr: string): { date: string; time: string } {
  const date = new Date(dateStr);
  return {
    date: date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }),
    time: date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
  };
}

// Calculate duration
function calculateDuration(startTime: string, endTime?: string): string {
  const start = new Date(startTime);
  const end = endTime ? new Date(endTime) : new Date();
  const diffMs = end.getTime() - start.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);

  if (diffMins < 60) return `${diffMins} 分钟`;
  if (diffHours < 24) return `${diffHours} 小时 ${diffMins % 60} 分钟`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} 天 ${diffHours % 24} 小时`;
}

// Stage progress indicator
function StageProgress({ stage, status }: { stage: TaskStage; status: TaskStatus }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((s) => (
        <div
          key={s}
          className={`w-2 h-2 rounded-full transition-colors ${
            s < stage
              ? 'bg-emerald-500'
              : s === stage
                ? status === 'running'
                  ? 'bg-blue-500 animate-pulse'
                  : status === 'completed' || status === 'waiting_merge'
                    ? 'bg-emerald-500'
                    : 'bg-amber-500'
                : 'bg-neutral-200'
          }`}
          title={stageInfo[s as TaskStage].name}
        />
      ))}
    </div>
  );
}

// Pending merge badge
function PendingMergeBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700 border border-purple-200">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
      </svg>
      待合并
    </span>
  );
}

// Task card component
function TaskCard({
  task,
  onContinue,
  onMerge,
  onDelete,
}: {
  task: TaskHistoryItem;
  onContinue?: (task: TaskHistoryItem) => void;
  onMerge?: (task: TaskHistoryItem) => void;
  onDelete?: (task: TaskHistoryItem) => void;
}) {
  const [showActions, setShowActions] = useState(false);
  const style = statusStyles[task.status];
  const progress = task.tasksTotal > 0 ? (task.tasksCompleted / task.tasksTotal) * 100 : 0;

  return (
    <div
      className={`relative group rounded-lg border ${style.border} ${style.bg} p-4 transition-all hover:shadow-md`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* Timeline connector */}
      <div className="absolute left-[-20px] top-1/2 -translate-y-1/2 w-4 h-0.5 bg-neutral-200" />

      {/* Main content */}
      <div className="flex flex-col gap-3">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`text-sm font-semibold ${style.text}`}>
                {statusIcons[task.status]}
              </span>
              <h3 className="font-medium text-neutral-900 truncate">{task.name}</h3>
              {!task.isMerged && task.status !== 'running' && task.status !== 'failed' && (
                <PendingMergeBadge />
              )}
            </div>
            {task.description && (
              <p className="text-xs text-neutral-500 mt-1 line-clamp-1">
                {task.description}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-medium ${style.bg} ${style.text}`}
            >
              {statusLabels[task.status]}
            </span>
          </div>
        </div>

        {/* Info row */}
        <div className="flex items-center gap-4 text-xs text-neutral-500 flex-nowrap overflow-x-auto">
          {/* Stage */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="text-neutral-400 whitespace-nowrap">阶段:</span>
            <StageProgress stage={task.stage} status={task.status} />
            <span className="whitespace-nowrap">{stageInfo[task.stage].shortName}</span>
          </div>

          {/* Progress */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="text-neutral-400 whitespace-nowrap">任务:</span>
            <span className="font-medium whitespace-nowrap">{task.tasksCompleted}/{task.tasksTotal}</span>
            <div className="w-16 h-1.5 rounded-full bg-neutral-200 overflow-hidden flex-shrink-0">
              <div
                className={`h-full transition-all ${
                  task.status === 'completed' || task.status === 'waiting_merge'
                    ? 'bg-emerald-500'
                    : task.status === 'running'
                      ? 'bg-blue-500'
                      : 'bg-amber-500'
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Time */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="text-neutral-400 whitespace-nowrap">时间:</span>
            <span className="whitespace-nowrap">{formatRelativeTime(task.startTime)}</span>
            <span className="text-neutral-300">·</span>
            <span className="whitespace-nowrap">{calculateDuration(task.startTime, task.endTime)}</span>
          </div>

          {/* Branch */}
          {task.branchName && (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="font-mono text-[10px] bg-neutral-100 px-1.5 py-0.5 rounded whitespace-nowrap">
                {task.branchName}
              </span>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div
          className={`flex items-center gap-2 pt-2 border-t border-neutral-200/50 transition-opacity ${
            showActions ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {/* Continue button - for partial/failed tasks */}
          {(task.status === 'partial' || task.status === 'failed') && onContinue && (
            <button
              onClick={() => onContinue(task)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              继续
            </button>
          )}

          {/* Merge button - for waiting_merge tasks */}
          {task.status === 'waiting_merge' && onMerge && (
            <button
              onClick={() => onMerge(task)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-md transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
              合并
            </button>
          )}

          {/* View PR button */}
          {task.prUrl && (
            <a
              href={task.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-md transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 16 16">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              查看 PR
            </a>
          )}

          {/* View Stage button */}
          <Link
            href={`/stage${task.stage}?session=${task.id}`}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-md transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            查看
          </Link>

          {/* Delete button */}
          {onDelete && (
            <button
              onClick={() => onDelete(task)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-md transition-colors ml-auto"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              删除
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Timeline marker
function TimelineMarker({ date, isFirst }: { date: string; isFirst: boolean }) {
  const { date: dateStr, time } = formatTimelineDate(date);

  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="flex flex-col items-center">
        <div className={`w-3 h-3 rounded-full ${isFirst ? 'bg-blue-500' : 'bg-neutral-300'}`} />
        {!isFirst && <div className="w-0.5 h-4 bg-neutral-200 -mt-0.5" />}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-medium text-neutral-700">{dateStr}</span>
        <span className="text-xs text-neutral-400">{time}</span>
      </div>
    </div>
  );
}

// Loading skeleton
function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="animate-pulse rounded-lg border border-neutral-200 bg-white p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-5 h-5 rounded-full bg-neutral-200" />
            <div className="h-5 bg-neutral-200 rounded w-1/3" />
          </div>
          <div className="flex items-center gap-4 mb-2">
            <div className="h-3 bg-neutral-100 rounded w-20" />
            <div className="h-3 bg-neutral-100 rounded w-16" />
            <div className="h-3 bg-neutral-100 rounded w-24" />
          </div>
          <div className="h-8 bg-neutral-50 rounded mt-3" />
        </div>
      ))}
    </div>
  );
}

// Empty state
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-neutral-50/50 p-8 text-center">
      <div className="mb-2 text-3xl text-neutral-300">📋</div>
      <h3 className="text-sm font-medium text-neutral-700">暂无任务历史</h3>
      <p className="mt-1 text-xs text-neutral-500 max-w-xs">
        开始一个新的开发任务后，任务历史将显示在这里
      </p>
      <Link
        href="/stage1"
        className="mt-4 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 transition-colors"
      >
        创建新任务
      </Link>
    </div>
  );
}

// Group tasks by date
function groupTasksByDate(tasks: TaskHistoryItem[]): Map<string, TaskHistoryItem[]> {
  const groups = new Map<string, TaskHistoryItem[]>();

  for (const task of tasks) {
    const date = new Date(task.startTime).toLocaleDateString('zh-CN');
    const existing = groups.get(date) || [];
    existing.push(task);
    groups.set(date, existing);
  }

  return groups;
}

// Main component
export function TaskHistory({
  tasks,
  loading = false,
  onContinue,
  onMerge,
  onDelete,
  onRefresh,
}: TaskHistoryProps) {
  if (loading) {
    return <LoadingSkeleton />;
  }

  if (tasks.length === 0) {
    return <EmptyState />;
  }

  // Sort tasks by start time (newest first)
  const sortedTasks = [...tasks].sort(
    (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
  );

  // Group by date
  const groupedTasks = groupTasksByDate(sortedTasks);
  const dateKeys = Array.from(groupedTasks.keys());

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-neutral-900">任务历史</h2>
        <div className="flex items-center gap-2">
          <span className="text-sm text-neutral-500">{tasks.length} 个任务</span>
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="p-1.5 text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 rounded transition-colors"
              title="刷新"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Timeline view */}
      <div className="relative pl-6">
        {/* Vertical line */}
        <div className="absolute left-[5px] top-3 bottom-3 w-0.5 bg-neutral-200" />

        {/* Date groups */}
        {dateKeys.map((date, dateIndex) => {
          const dateTasks = groupedTasks.get(date) || [];
          const firstTask = dateTasks[0];

          return (
            <div key={date} className="mb-6 last:mb-0">
              {/* Date marker */}
              <TimelineMarker date={firstTask.startTime} isFirst={dateIndex === 0} />

              {/* Task cards */}
              <div className="ml-4 space-y-3">
                {dateTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onContinue={onContinue}
                    onMerge={onMerge}
                    onDelete={onDelete}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default TaskHistory;
