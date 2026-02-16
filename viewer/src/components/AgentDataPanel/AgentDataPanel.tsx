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

type IndicatorColor = 'green' | 'yellow' | 'red';

interface StatusIndicator {
  label: string;
  description: string;
  color: IndicatorColor;
}

const COLOR_CLASSES: Record<IndicatorColor, string> = {
  green: 'bg-green-500',
  yellow: 'bg-yellow-400',
  red: 'bg-red-500',
};

function computeIndicators(agentStatus: AgentStatus): StatusIndicator[] {
  const indicators: StatusIndicator[] = [];

  // 1. Network status
  if (agentStatus.status === 'waiting_network') {
    indicators.push({
      label: '网络',
      description: '等待网络响应，可能连接异常',
      color: 'red',
    });
  } else {
    indicators.push({
      label: '网络',
      description: '网络连接正常',
      color: 'green',
    });
  }

  // 2. API rate limit
  if (agentStatus.apiRateLimit?.waiting) {
    indicators.push({
      label: 'API 限流',
      description: `API 被限流，${agentStatus.apiRateLimit.remainingSeconds}秒后恢复`,
      color: 'red',
    });
  } else if (
    agentStatus.rateLimit?.enabled &&
    agentStatus.rateLimit.maxCalls > 0 &&
    agentStatus.rateLimit.calls / agentStatus.rateLimit.maxCalls > 0.8
  ) {
    indicators.push({
      label: 'API 限流',
      description: `API 调用接近上限（${agentStatus.rateLimit.calls}/${agentStatus.rateLimit.maxCalls}）`,
      color: 'yellow',
    });
  } else {
    indicators.push({
      label: 'API 限流',
      description: 'API 调用额度充足',
      color: 'green',
    });
  }

  // 3. Progress check (circuit breaker)
  const noProgressCount = agentStatus.circuitBreaker?.noProgressCount ?? 0;
  if (noProgressCount >= 2) {
    indicators.push({
      label: '连续进展',
      description: `连续${noProgressCount}次无进展，可能卡住`,
      color: 'red',
    });
  } else if (noProgressCount === 1) {
    indicators.push({
      label: '连续进展',
      description: '上次迭代无进展，继续观察',
      color: 'yellow',
    });
  } else {
    indicators.push({
      label: '连续进展',
      description: '任务正常推进',
      color: 'green',
    });
  }

  // 4. Retry status
  if (agentStatus.retryCount > 0) {
    indicators.push({
      label: '重试',
      description: `第${agentStatus.retryCount}次重试中`,
      color: 'yellow',
    });
  } else {
    indicators.push({
      label: '重试',
      description: '无需重试',
      color: 'green',
    });
  }

  return indicators;
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
  if (isRunning) return 'bg-neutral-200 text-neutral-700';
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
            className="h-full bg-neutral-700 rounded-full transition-all duration-500 ease-out"
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

      {/* Status Indicators */}
      {agentStatus.status !== 'idle' && (
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <span className="text-xs text-neutral-400">状态指示灯</span>
          <div className="mt-2 space-y-2">
            {computeIndicators(agentStatus).map((ind) => (
              <div key={ind.label} className="flex items-center gap-2">
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${COLOR_CLASSES[ind.color]}`}
                />
                <span className="text-xs text-neutral-700">
                  <span className="font-medium">{ind.label}</span>
                  {' · '}
                  {ind.description}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
