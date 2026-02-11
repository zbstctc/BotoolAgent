'use client';

import { useState } from 'react';
import type { PipelineMode } from '@/lib/tool-types';

interface ModeSelectorProps {
  recommendedMode?: PipelineMode;
  recommendReason?: string;
  onSelect: (mode: PipelineMode) => void;
}

interface ModeConfig {
  mode: PipelineMode;
  name: string;
  time: string;
  suitable: string;
  flow: string;
  colorClass: string;
  hoverColorClass: string;
  selectedBorderClass: string;
  selectedBgClass: string;
  dotClass: string;
}

const MODE_CONFIGS: ModeConfig[] = [
  {
    mode: 'quick',
    name: '快速修复',
    time: '约 2 分钟',
    suitable: '改 bug、调样式、小调整',
    flow: '描述需求 → 确认任务 → 自动执行',
    colorClass: 'text-green-700',
    hoverColorClass: 'hover:border-green-400',
    selectedBorderClass: 'border-green-500',
    selectedBgClass: 'bg-green-50',
    dotClass: 'bg-green-500',
  },
  {
    mode: 'feature',
    name: '功能开发',
    time: '约 10-15 分钟',
    suitable: '新功能、新页面、多文件变更',
    flow: '核心问答 → 任务规划 → 确认 → 自动执行',
    colorClass: 'text-amber-700',
    hoverColorClass: 'hover:border-amber-400',
    selectedBorderClass: 'border-amber-500',
    selectedBgClass: 'bg-amber-50',
    dotClass: 'bg-amber-500',
  },
  {
    mode: 'full',
    name: '完整规划',
    time: '约 30-45 分钟',
    suitable: '架构级变更、新模块、复杂系统',
    flow: '5层金字塔问答 → 富化规格 → 确认 → 自动执行',
    colorClass: 'text-red-700',
    hoverColorClass: 'hover:border-red-400',
    selectedBorderClass: 'border-red-500',
    selectedBgClass: 'bg-red-50',
    dotClass: 'bg-red-500',
  },
];

export function ModeSelector({ recommendedMode, recommendReason, onSelect }: ModeSelectorProps) {
  const [hoveredMode, setHoveredMode] = useState<PipelineMode | null>(null);
  const [selectedMode, setSelectedMode] = useState<PipelineMode | null>(null);

  const handleSelect = (mode: PipelineMode) => {
    setSelectedMode(mode);
  };

  const handleConfirm = () => {
    if (selectedMode) {
      onSelect(selectedMode);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 py-12">
      <div className="max-w-4xl w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <h2 className="text-2xl font-semibold text-neutral-900 mb-2">
            选择开发模式
          </h2>
          <p className="text-sm text-neutral-500">
            根据需求复杂度选择合适的模式，决定问答深度和生成策略
          </p>
        </div>

        {/* Mode Cards */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {MODE_CONFIGS.map((config) => {
            const isRecommended = config.mode === recommendedMode;
            const isSelected = config.mode === selectedMode;
            const isHovered = config.mode === hoveredMode;

            return (
              <button
                key={config.mode}
                onClick={() => handleSelect(config.mode)}
                onMouseEnter={() => setHoveredMode(config.mode)}
                onMouseLeave={() => setHoveredMode(null)}
                className={`
                  relative text-left p-5 rounded-xl border-2 transition-all duration-200
                  bg-white cursor-pointer
                  ${isSelected
                    ? `${config.selectedBorderClass} ${config.selectedBgClass} shadow-md`
                    : isHovered
                      ? `border-neutral-300 shadow-sm`
                      : 'border-neutral-200'
                  }
                  ${!isSelected ? config.hoverColorClass : ''}
                `}
              >
                {/* Recommended Badge */}
                {isRecommended && (
                  <span className="absolute -top-2.5 right-3 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 border border-blue-200">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                    推荐
                  </span>
                )}

                {/* Color Dot + Mode Name */}
                <div className="flex items-center gap-2.5 mb-3">
                  <span className={`w-3 h-3 rounded-full ${config.dotClass}`} />
                  <h3 className={`text-lg font-semibold ${config.colorClass}`}>
                    {config.name}
                  </h3>
                </div>

                {/* Time Estimate */}
                <p className="text-xs text-neutral-400 mb-3">
                  {config.time}
                </p>

                {/* Suitable For */}
                <p className="text-sm text-neutral-700 mb-3">
                  {config.suitable}
                </p>

                {/* Flow Description */}
                <div className="pt-3 border-t border-neutral-100">
                  <p className="text-xs text-neutral-500">
                    {config.flow}
                  </p>
                </div>

                {/* Selected checkmark */}
                {isSelected && (
                  <div className="absolute top-3 left-3">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center ${config.dotClass}`}>
                      <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </span>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Recommend Reason */}
        {recommendReason && (
          <div className="mb-6 p-3 rounded-lg bg-blue-50 border border-blue-200">
            <div className="flex items-start gap-2">
              <svg className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              <p className="text-sm text-blue-700">{recommendReason}</p>
            </div>
          </div>
        )}

        {/* Confirm Button */}
        <div className="text-center">
          <button
            onClick={handleConfirm}
            disabled={!selectedMode}
            className={`px-8 py-3 rounded-lg font-medium transition-colors ${
              selectedMode
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
            }`}
          >
            {selectedMode ? '确认选择' : '请选择一个模式'}
          </button>
        </div>
      </div>
    </div>
  );
}
