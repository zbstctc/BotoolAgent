'use client';

interface StageIndicatorProps {
  currentStage: 1 | 2 | 3 | 4 | 5;
  completedStages?: number[];
}

const stages = [
  { id: 1, name: 'PRD 需求确认', available: true },
  { id: 2, name: '开发规划', available: true },
  { id: 3, name: 'Coding', available: true },
  { id: 4, name: '测试', available: true },
  { id: 5, name: 'Review', available: false },
];

export function StageIndicator({ currentStage, completedStages = [] }: StageIndicatorProps) {
  return (
    <div className="w-full bg-white border-b border-neutral-200">
      <div className="mx-auto max-w-5xl px-4 py-4">
        <div className="flex items-center justify-between">
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
                          ? 'bg-blue-600 text-white ring-4 ring-blue-100'
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
                          ? 'text-blue-600'
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
      </div>
    </div>
  );
}
