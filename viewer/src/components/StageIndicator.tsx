'use client';

interface StageIndicatorProps {
  currentStage: 1 | 2 | 3 | 4 | 5;
  completedStages?: number[];
  projectName?: string;
  stageStatus?: string;
  autoMode?: boolean;
  onAutoModeChange?: (checked: boolean) => void;
  showAutoMode?: boolean;
}

const stages = [
  { id: 1, name: '需求收集', available: true },
  { id: 2, name: '任务规划', available: true },
  { id: 3, name: '自动开发', available: true },
  { id: 4, name: '自动验收', available: true },
  { id: 5, name: '确认合并', available: true },
];

export function StageIndicator({ currentStage, completedStages = [], projectName, stageStatus, autoMode, onAutoModeChange, showAutoMode }: StageIndicatorProps) {
  return (
    <div className="w-full bg-white border-b border-neutral-200">
      <div className="px-6 py-4">
        <div className="flex items-center gap-6">
          {/* Project Name and Stage Status */}
          <div className="flex items-center gap-3">
            {projectName && (
              <span className="text-base font-semibold text-neutral-900 truncate max-w-[240px]">
                {projectName}
              </span>
            )}
            {stageStatus && (
              <>
                <span className="text-neutral-300">·</span>
                <span className="text-xs text-neutral-500 whitespace-nowrap">
                  {stageStatus}
                </span>
              </>
            )}
          </div>

          {/* Stage indicators */}
          <div className="flex items-center justify-between flex-1">
          {stages.map((stage, index) => {
            const isCompleted = completedStages.includes(stage.id);
            const isCurrent = stage.id === currentStage;
            const isComingSoon = !stage.available;

            return (
              <div key={stage.id} className="flex items-center flex-1">
                {/* Stage circle and content */}
                <div className="flex flex-col items-center relative">
                  {/* Circle */}
                  <div
                    className={`
                      w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
                      transition-colors duration-200
                      ${isCompleted
                        ? 'bg-emerald-500 text-white'
                        : isCurrent
                          ? 'bg-neutral-900 text-white ring-4 ring-neutral-200'
                          : isComingSoon
                            ? 'bg-neutral-100 text-neutral-400 border-2 border-dashed border-neutral-300'
                            : 'bg-neutral-200 text-neutral-500'
                      }
                    `}
                  >
                    {isCompleted ? (
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    ) : (
                      stage.id
                    )}
                  </div>

                  {/* Stage name */}
                  <div className="mt-2 text-center">
                    <span
                      className={`
                        text-xs font-medium whitespace-nowrap
                        ${isCurrent
                          ? 'text-neutral-900'
                          : isCompleted
                            ? 'text-emerald-600'
                            : isComingSoon
                              ? 'text-neutral-400'
                              : 'text-neutral-500'
                        }
                      `}
                    >
                      {stage.name}
                    </span>
                    {isComingSoon && (
                      <span className="block text-[10px] text-neutral-400 mt-0.5">
                        即将推出
                      </span>
                    )}
                  </div>
                </div>

                {/* Connector line */}
                {index < stages.length - 1 && (
                  <div
                    className={`
                      flex-1 h-0.5 mx-3 mt-[-1.5rem]
                      ${completedStages.includes(stage.id) && (completedStages.includes(stages[index + 1].id) || stages[index + 1].id === currentStage)
                        ? 'bg-emerald-500'
                        : 'bg-neutral-200'
                      }
                    `}
                  />
                )}
              </div>
            );
          })}
          </div>

          {/* Auto Mode checkbox */}
          {showAutoMode && (
            <label className="flex items-center gap-2 cursor-pointer whitespace-nowrap">
              <input
                type="checkbox"
                checked={autoMode ?? false}
                onChange={(e) => onAutoModeChange?.(e.target.checked)}
                className="accent-neutral-900"
              />
              <span className="text-sm text-neutral-600">全自动模式</span>
            </label>
          )}
        </div>
      </div>
    </div>
  );
}
