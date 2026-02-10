'use client';

import type { AgentStatus } from '@/hooks/useAgentStatus';

interface AgentDataPanelProps {
  agentStatus: AgentStatus;
  isRunning: boolean;
  isComplete: boolean;
  hasError: boolean;
  progressPercent: number;
  /** Fallback total tasks from PRD (used when agentStatus.total is 0) */
  totalTasks?: number;
}

function getStatusLabel(status: AgentStatus['status']): string {
  switch (status) {
    case 'running':
      return '执行中';
    case 'waiting_network':
      return '等待网络';
    case 'iteration_complete':
      return '迭代完成';
    case 'complete':
      return '全部完成';
    case 'error':
      return '出错';
    case 'failed':
      return '失败';
    case 'timeout':
      return '超时';
    case 'max_iterations':
      return '达到上限';
    case 'idle':
    default:
      return '空闲';
  }
}

function getStatusStyle(
  isRunning: boolean,
  isComplete: boolean,
  hasError: boolean,
): string {
  if (isRunning) return 'bg-blue-100 text-blue-700';
  if (isComplete) return 'bg-green-100 text-green-700';
  if (hasError) return 'bg-red-100 text-red-700';
  return 'bg-neutral-100 text-neutral-600';
}

export default function AgentDataPanel({
  agentStatus,
  isRunning,
  isComplete,
  hasError,
  progressPercent,
  totalTasks = 0,
}: AgentDataPanelProps) {
  const total = agentStatus.total || totalTasks;
  const iterationPercent =
    agentStatus.maxIterations > 0
      ? Math.round(
          (agentStatus.iteration / agentStatus.maxIterations) * 100,
        )
      : 0;

  const retryText =
    agentStatus.retryCount > 0
      ? ` · 第${agentStatus.retryCount}次重试`
      : '';

  return (
    <div className="p-4 space-y-4">
      {/* Iteration Progress */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-neutral-500">迭代进度</span>
          <span className="text-xs font-mono text-neutral-700">
            {agentStatus.iteration}/{agentStatus.maxIterations || '—'}
          </span>
        </div>
        <div className="h-2 bg-neutral-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${iterationPercent}%` }}
          />
        </div>
      </div>

      {/* Task Completion */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-neutral-500">任务完成率</span>
          <span className="text-xs font-mono text-neutral-700">
            {agentStatus.completed}/{total}
          </span>
        </div>
        <div className="h-2 bg-neutral-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Current Task */}
      <div className="rounded-lg border border-neutral-200 bg-white p-3">
        <span className="text-xs text-neutral-400">当前任务</span>
        <p className="text-sm font-medium text-neutral-900 mt-1">
          {agentStatus.currentTask !== 'none'
            ? agentStatus.currentTask
            : '—'}
        </p>
        <div className="flex items-center gap-2 mt-1.5">
          <span
            className={`inline-block text-xs px-1.5 py-0.5 rounded ${getStatusStyle(isRunning, isComplete, hasError)}`}
          >
            {getStatusLabel(agentStatus.status)}
          </span>
          {agentStatus.currentTask !== 'none' && isRunning && (
            <span className="text-xs text-neutral-400">
              第{agentStatus.iteration}次迭代{retryText}
            </span>
          )}
        </div>
      </div>

      {/* Message */}
      {agentStatus.message && agentStatus.status !== 'idle' && (
        <p className="text-xs text-neutral-500 italic">
          {agentStatus.message}
        </p>
      )}
    </div>
  );
}
