'use client';

import type { ConfirmationSummary } from '@/lib/tool-types';

interface ConfirmationCardProps {
  summary: ConfirmationSummary;
  onConfirm: () => void;
  onRevise: () => void;
  isLoading?: boolean;
}

export function ConfirmationCard({
  summary,
  onConfirm,
  onRevise,
  isLoading,
}: ConfirmationCardProps) {
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="border-b border-neutral-200 pb-4">
        <h2 className="text-xl font-semibold text-neutral-900">
          L5: 确认门控
        </h2>
        <p className="text-sm text-neutral-500 mt-1">
          请确认以下需求摘要，确认后将自动生成 PRD 文档
        </p>
      </div>

      {/* Summary Card */}
      <div className="bg-white border border-neutral-200 rounded-xl shadow-sm overflow-hidden">
        {/* Requirements Summary */}
        <Section title="需求摘要" icon="📋">
          <p className="text-sm text-neutral-700 leading-relaxed">
            {summary.requirementsSummary}
          </p>
        </Section>

        {/* Features */}
        <Section title="功能范围" icon="🎯">
          <ul className="space-y-1.5">
            {summary.features.map((feature, index) => (
              <li key={index} className="flex items-start gap-2 text-sm text-neutral-700">
                <span className="flex-shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full bg-neutral-500" />
                {feature}
              </li>
            ))}
          </ul>
        </Section>

        {/* Technical Approach */}
        <Section title="技术方案" icon="🔧">
          <p className="text-sm text-neutral-700 leading-relaxed">
            {summary.technicalApproach}
          </p>
        </Section>

        {/* Risk Assessment */}
        <Section title="风险评估" icon="⚠️">
          <div className="space-y-3">
            {summary.risks.high.length > 0 && (
              <RiskGroup level="HIGH" items={summary.risks.high} />
            )}
            {summary.risks.medium.length > 0 && (
              <RiskGroup level="MEDIUM" items={summary.risks.medium} />
            )}
            {summary.risks.low.length > 0 && (
              <RiskGroup level="LOW" items={summary.risks.low} />
            )}
            {summary.risks.high.length === 0 &&
              summary.risks.medium.length === 0 &&
              summary.risks.low.length === 0 && (
              <p className="text-sm text-neutral-500">暂无识别到的风险</p>
            )}
          </div>
        </Section>

        {/* Complexity Estimate */}
        <Section title="复杂度估计" icon="📊" noBorder>
          <p className="text-sm text-neutral-700 leading-relaxed">
            {summary.complexityEstimate}
          </p>
        </Section>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3 pt-2">
        <button
          onClick={onRevise}
          disabled={isLoading}
          className="flex-1 py-3 rounded-lg font-medium border border-neutral-300 text-neutral-700 bg-white hover:bg-neutral-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          返回修改
        </button>
        <button
          onClick={onConfirm}
          disabled={isLoading}
          className="flex-1 py-3 rounded-lg font-medium bg-neutral-900 text-white hover:bg-neutral-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? '处理中...' : '确认并生成 PRD'}
        </button>
      </div>
    </div>
  );
}

/** Section wrapper */
function Section({
  title,
  icon,
  children,
  noBorder,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
  noBorder?: boolean;
}) {
  return (
    <div className={`p-4 ${noBorder ? '' : 'border-b border-neutral-100'}`}>
      <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-900 mb-2">
        <span>{icon}</span>
        {title}
      </h3>
      {children}
    </div>
  );
}

/** Risk group by level */
function RiskGroup({ level, items }: { level: 'HIGH' | 'MEDIUM' | 'LOW'; items: string[] }) {
  const colors = {
    HIGH: { bg: 'bg-red-50', text: 'text-red-700', badge: 'bg-red-100 text-red-800' },
    MEDIUM: { bg: 'bg-amber-50', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-800' },
    LOW: { bg: 'bg-neutral-100', text: 'text-neutral-700', badge: 'bg-neutral-200 text-neutral-700' },
  };
  const labels = { HIGH: '高', MEDIUM: '中', LOW: '低' };
  const c = colors[level];

  return (
    <div className={`${c.bg} rounded-lg p-3`}>
      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${c.badge} mb-2`}>
        {labels[level]}风险
      </span>
      <ul className="space-y-1">
        {items.map((item, index) => (
          <li key={index} className={`text-sm ${c.text}`}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
