'use client';

export interface LevelInfo {
  id: number;
  name: string;
  status: 'completed' | 'current' | 'locked';
  questionsTotal: number;
  questionsAnswered: number;
  summary?: string;
}

export interface CollectedSummaryItem {
  dimension: string;
  summary: string;
}

interface PyramidNavigationProps {
  currentLevel: number;
  levels: LevelInfo[];
  collectedSummary: CollectedSummaryItem[];
  onLevelClick: (level: number) => void;
}

const LEVEL_NAMES: Record<number, string> = {
  1: 'L1 核心识别',
  2: 'L2 领域分支',
  3: 'L3 细节深入',
  4: 'L4 边界确认',
};

const LEVEL_DESCRIPTIONS: Record<number, string> = {
  1: '明确需求类型和目标用户',
  2: '确定涉及的技术领域',
  3: '深入具体实现细节',
  4: '确认边界和验收标准',
};

export function PyramidNavigation({
  currentLevel,
  levels,
  collectedSummary,
  onLevelClick,
}: PyramidNavigationProps) {
  return (
    <div className="flex flex-col h-full bg-white border-r border-neutral-200">
      {/* Header */}
      <div className="p-4 border-b border-neutral-200">
        <h2 className="text-sm font-semibold text-neutral-900">问答进度</h2>
        <p className="text-xs text-neutral-500 mt-1">
          当前：第 {currentLevel} 层
        </p>
      </div>

      {/* Levels */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-2 space-y-1">
          {levels.map((level) => (
            <LevelItem
              key={level.id}
              level={level}
              isCurrent={level.id === currentLevel}
              onClick={() => {
                if (level.status !== 'locked') {
                  onLevelClick(level.id);
                }
              }}
            />
          ))}
        </div>
      </div>

      {/* Collected Summary */}
      {collectedSummary.length > 0 && (
        <div className="border-t border-neutral-200 p-4 max-h-48 overflow-y-auto">
          <h3 className="text-xs font-medium text-neutral-700 mb-2">
            已收集信息
          </h3>
          <div className="space-y-2">
            {collectedSummary.map((item, index) => (
              <div key={index} className="text-xs">
                <span className="font-medium text-neutral-600">
                  {item.dimension}：
                </span>
                <span className="text-neutral-500">{item.summary}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LevelItem({
  level,
  isCurrent,
  onClick,
}: {
  level: LevelInfo;
  isCurrent: boolean;
  onClick: () => void;
}) {
  const isLocked = level.status === 'locked';
  const isCompleted = level.status === 'completed';
  const progress = level.questionsTotal > 0
    ? (level.questionsAnswered / level.questionsTotal) * 100
    : 0;

  return (
    <button
      onClick={onClick}
      disabled={isLocked}
      className={`w-full text-left p-3 rounded-lg transition-colors ${
        isCurrent
          ? 'bg-blue-50 border border-blue-200'
          : isCompleted
          ? 'bg-neutral-50 hover:bg-neutral-100'
          : isLocked
          ? 'bg-neutral-50 opacity-60 cursor-not-allowed'
          : 'hover:bg-neutral-50'
      }`}
    >
      <div className="flex items-start gap-2">
        {/* Status Icon */}
        <span className={`flex-shrink-0 w-5 h-5 flex items-center justify-center text-sm ${
          isCurrent
            ? 'text-blue-600'
            : isCompleted
            ? 'text-green-600'
            : 'text-neutral-400'
        }`}>
          {isCurrent ? '▶' : isCompleted ? '✓' : '○'}
        </span>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-medium ${
            isLocked ? 'text-neutral-400' : 'text-neutral-900'
          }`}>
            {LEVEL_NAMES[level.id] || `Level ${level.id}`}
          </div>
          <div className={`text-xs mt-0.5 ${
            isLocked ? 'text-neutral-300' : 'text-neutral-500'
          }`}>
            {LEVEL_DESCRIPTIONS[level.id]}
          </div>

          {/* Progress Bar */}
          {!isLocked && level.questionsTotal > 0 && (
            <div className="mt-2">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className={isCompleted ? 'text-green-600' : 'text-neutral-500'}>
                  {level.questionsAnswered}/{level.questionsTotal} 问题
                </span>
                {isCompleted && (
                  <span className="text-green-600">完成</span>
                )}
              </div>
              <div className="h-1.5 bg-neutral-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    isCompleted ? 'bg-green-500' : 'bg-blue-500'
                  }`}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Summary */}
          {isCompleted && level.summary && (
            <p className="text-xs text-neutral-500 mt-2 line-clamp-2">
              {level.summary}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}
