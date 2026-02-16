'use client';

import { useState, useEffect } from 'react';
import type { ReviewSummaryData } from '@/app/api/review-summary/route';

export interface ReviewSummaryProps {
  /** Project ID for multi-project support */
  projectId?: string;
  /** Whether to show expanded details by default */
  defaultExpanded?: boolean;
}

function StatCard({ icon, label, value, subtext, color }: {
  icon: string;
  label: string;
  value: string;
  subtext?: string;
  color: 'green' | 'blue' | 'amber' | 'purple' | 'red' | 'neutral';
}) {
  const colorMap = {
    green: 'bg-green-50 border-green-200 text-green-700',
    blue: 'bg-neutral-100 border-neutral-200 text-neutral-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    purple: 'bg-neutral-100 border-neutral-200 text-neutral-700',
    red: 'bg-red-50 border-red-200 text-red-700',
    neutral: 'bg-neutral-50 border-neutral-200 text-neutral-700',
  };

  return (
    <div className={`rounded-lg border p-3 ${colorMap[color]}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">{icon}</span>
        <span className="text-xs font-medium opacity-75">{label}</span>
      </div>
      <div className="text-lg font-bold">{value}</div>
      {subtext && <div className="text-xs opacity-60 mt-0.5">{subtext}</div>}
    </div>
  );
}

export function ReviewSummary({ projectId, defaultExpanded = false }: ReviewSummaryProps) {
  const [data, setData] = useState<ReviewSummaryData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSummary = async () => {
      try {
        setIsLoading(true);
        const reviewUrl = projectId
          ? `/api/review-summary?projectId=${encodeURIComponent(projectId)}`
          : '/api/review-summary';
        const response = await fetch(reviewUrl);
        if (response.ok) {
          const summary = await response.json();
          setData(summary);
        } else {
          setError('无法加载评审摘要');
        }
      } catch {
        setError('网络错误');
      } finally {
        setIsLoading(false);
      }
    };
    fetchSummary();
  }, [projectId]);

  if (isLoading) {
    return (
      <div className="bg-white border border-neutral-200 rounded-lg p-4 animate-pulse">
        <div className="h-5 bg-neutral-100 rounded w-32 mb-3" />
        <div className="grid grid-cols-2 gap-2">
          <div className="h-16 bg-neutral-100 rounded" />
          <div className="h-16 bg-neutral-100 rounded" />
          <div className="h-16 bg-neutral-100 rounded" />
          <div className="h-16 bg-neutral-100 rounded" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-4 text-center text-neutral-500 text-sm">
        {error || '暂无评审数据'}
      </div>
    );
  }

  const specRate = data.totalCriteria > 0
    ? Math.round((data.metCriteria / data.totalCriteria) * 100)
    : 0;

  const hasDeviations = data.deviations.length > 0;
  const hasSecurityItems = data.totalSecurityItems > 0;
  const hasEvals = data.totalEvals > 0;
  const hasRules = data.rulesApplied > 0;
  const hasManualVerifications = data.manualVerifications.length > 0;

  return (
    <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        className="w-full p-4 flex items-center justify-between text-left hover:bg-neutral-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-neutral-200 flex items-center justify-center">
            <span className="text-sm">📊</span>
          </div>
          <div>
            <h3 className="font-semibold text-neutral-900 text-sm">开发评审摘要</h3>
            <p className="text-xs text-neutral-500">
              {data.completedTasks}/{data.totalTasks} 任务完成
              {specRate > 0 && ` · Spec 遵循率 ${specRate}%`}
            </p>
          </div>
        </div>
        <svg
          className={`w-5 h-5 text-neutral-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="border-t border-neutral-200 p-4 space-y-4">
          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-2">
            <StatCard
              icon="✅"
              label="任务完成"
              value={`${data.completedTasks}/${data.totalTasks}`}
              subtext={data.completedTasks === data.totalTasks ? '全部完成' : `还剩 ${data.totalTasks - data.completedTasks} 个`}
              color={data.completedTasks === data.totalTasks ? 'green' : 'amber'}
            />
            <StatCard
              icon="📋"
              label={data.isEstimated ? 'Spec 遵循率 (预估)' : 'Spec 遵循率'}
              value={data.totalCriteria > 0 ? `${specRate}%` : 'N/A'}
              subtext={data.totalCriteria > 0 ? `${data.metCriteria}/${data.totalCriteria} 项满足` : '无验收标准'}
              color={specRate >= 90 ? 'green' : specRate >= 70 ? 'amber' : data.totalCriteria > 0 ? 'red' : 'neutral'}
            />
            <StatCard
              icon="📝"
              label="代码变更"
              value={`${data.filesChanged} 文件`}
              subtext={`+${data.additions} / -${data.deletions}`}
              color="blue"
            />
            {hasEvals ? (
              <StatCard
                icon="🧪"
                label="Eval 验证"
                value={`${data.passedEvals}/${data.totalEvals}`}
                subtext={data.blockingTotal > 0 ? `阻塞: ${data.blockingPassed}/${data.blockingTotal}` : undefined}
                color={data.passedEvals === data.totalEvals ? 'green' : 'amber'}
              />
            ) : (
              <StatCard
                icon="🧪"
                label="Eval 验证"
                value="N/A"
                subtext="未配置 eval"
                color="neutral"
              />
            )}
          </div>

          {/* Coding Standards */}
          {hasRules && (
            <div className="bg-neutral-100 border border-neutral-200 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm">📏</span>
                <span className="text-xs font-semibold text-neutral-800">
                  编码规范：应用了 {data.rulesApplied} 条规则
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {data.ruleNames.map((name) => (
                  <span key={name} className="px-2 py-0.5 bg-neutral-200 text-neutral-700 rounded text-xs">
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Security Checks */}
          {hasSecurityItems && (
            <div className={`border rounded-lg p-3 ${
              data.passedSecurityItems === data.totalSecurityItems
                ? 'bg-green-50 border-green-200'
                : 'bg-amber-50 border-amber-200'
            }`}>
              <div className="flex items-center gap-2">
                <span className="text-sm">🔒</span>
                <span className={`text-xs font-semibold ${
                  data.passedSecurityItems === data.totalSecurityItems ? 'text-green-800' : 'text-amber-800'
                }`}>
                  安全检查：{data.passedSecurityItems}/{data.totalSecurityItems} 项通过{data.isEstimated ? ' (预估)' : ''}
                </span>
              </div>
            </div>
          )}

          {/* Deviations */}
          {hasDeviations && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm">⚠️</span>
                <span className="text-xs font-semibold text-amber-800">
                  {data.deviations.length} 个偏差
                </span>
              </div>
              <ul className="space-y-1.5">
                {data.deviations.map((d, i) => (
                  <li key={i} className="text-xs text-amber-700">
                    <span className="font-medium">{d.taskId}</span>
                    {' '}{d.content}
                    {d.reason && <span className="opacity-75"> — {d.reason}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Manual Verification Suggestions */}
          {hasManualVerifications && (
            <div className="bg-neutral-100 border border-neutral-200 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm">🎯</span>
                <span className="text-xs font-semibold text-neutral-800">建议手动验证</span>
              </div>
              <ol className="space-y-1 list-decimal list-inside">
                {data.manualVerifications.slice(0, 5).map((v, i) => (
                  <li key={i} className="text-xs text-neutral-700">{v}</li>
                ))}
                {data.manualVerifications.length > 5 && (
                  <li className="text-xs text-neutral-500 italic list-none mt-1">
                    +{data.manualVerifications.length - 5} 项更多...
                  </li>
                )}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
