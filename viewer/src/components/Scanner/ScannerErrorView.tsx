'use client';

import { useState } from 'react';
import { AlertTriangle, Terminal, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// --- Types ---

export type ScannerErrorType =
  | 'codex-not-installed'
  | 'analysis-failed'
  | 'json-parse-error';

interface ScannerErrorViewProps {
  errorType: ScannerErrorType;
  detail?: string;
  onRetry?: () => void;
}

// --- Error config ---

interface ErrorConfig {
  icon: typeof AlertTriangle;
  title: string;
  description: string;
  instructions: string[];
  showDetail: boolean;
}

const ERROR_CONFIGS: Record<ScannerErrorType, ErrorConfig> = {
  'codex-not-installed': {
    icon: Terminal,
    title: 'Codex CLI 未安装',
    description: 'Scanner 需要 Codex CLI 来分析项目结构。请先安装 Codex CLI 后再试。',
    instructions: [
      '运行 npm install -g @openai/codex 安装 Codex CLI',
      '安装完成后确认 codex 命令可用：codex --version',
      '返回此页面重新分析',
    ],
    showDetail: false,
  },
  'analysis-failed': {
    icon: AlertTriangle,
    title: '分析过程出错',
    description: 'Codex CLI 在分析过程中返回了错误。这可能是由于网络问题、API 限额或项目结构异常导致的。',
    instructions: [
      '检查网络连接是否正常',
      '确认 Codex API 密钥已正确配置',
      '尝试重新分析，如果问题持续请查看下方错误详情',
    ],
    showDetail: true,
  },
  'json-parse-error': {
    icon: AlertTriangle,
    title: 'JSON 解析失败',
    description: 'Codex CLI 返回的分析结果无法解析为有效的 JSON 格式。这通常是 Codex 输出格式异常导致的。',
    instructions: [
      '尝试重新分析，Codex 的输出可能因网络波动而不完整',
      '如果问题反复出现，请检查 Codex CLI 版本是否最新',
      '可展开下方详情查看原始输出以便排查',
    ],
    showDetail: true,
  },
};

const MAX_DETAIL_LENGTH = 2000;

// --- Component ---

export function ScannerErrorView({ errorType, detail, onRetry }: ScannerErrorViewProps) {
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const config = ERROR_CONFIGS[errorType];
  const Icon = config.icon;

  const truncatedDetail =
    detail && detail.length > MAX_DETAIL_LENGTH
      ? detail.slice(0, MAX_DETAIL_LENGTH) + '\n... (已截断)'
      : detail;

  return (
    <div className="flex flex-col items-center justify-center h-full px-6">
      <div className="w-full max-w-md">
        {/* Icon */}
        <div className="flex justify-center mb-4">
          <div className="rounded-lg bg-red-50 p-3">
            <Icon className="h-6 w-6 text-red-500" />
          </div>
        </div>

        {/* Title & description */}
        <div className="text-center mb-6">
          <h2 className="text-base font-semibold text-neutral-900">{config.title}</h2>
          <p className="mt-2 text-sm text-neutral-500 leading-relaxed">
            {config.description}
          </p>
        </div>

        {/* Instructions */}
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 mb-4">
          <p className="text-xs font-medium text-neutral-700 mb-2">操作指引</p>
          <ol className="list-decimal list-inside space-y-1.5">
            {config.instructions.map((instruction, i) => (
              <li key={i} className="text-xs text-neutral-600 leading-relaxed">
                {instruction}
              </li>
            ))}
          </ol>
        </div>

        {/* Detail collapsible panel */}
        {config.showDetail && truncatedDetail && (
          <div className="rounded-lg border border-neutral-200 bg-white mb-4">
            <button
              type="button"
              className={cn(
                'flex w-full items-center gap-2 px-4 py-2.5 text-left',
                'hover:bg-neutral-50 transition-colors',
                isDetailOpen && 'border-b border-neutral-200'
              )}
              onClick={() => setIsDetailOpen((prev) => !prev)}
            >
              {isDetailOpen ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
              )}
              <span className="text-xs font-medium text-neutral-600">
                错误详情
              </span>
            </button>
            {isDetailOpen && (
              <div className="px-4 py-3">
                <pre className="whitespace-pre-wrap break-words text-xs text-neutral-500 font-mono leading-relaxed max-h-60 overflow-y-auto">
                  {truncatedDetail}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Retry button */}
        {onRetry && (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              重新分析
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
