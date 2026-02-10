'use client';

export interface PipelineStep {
  id: string;
  name: string;
  description: string;
  status: 'pending' | 'current' | 'completed';
}

interface PipelineProgressProps {
  currentStep: number;
  steps: PipelineStep[];
  onStepClick: (stepIndex: number) => void;
}

const DEFAULT_STEPS: PipelineStep[] = [
  { id: 'rule-check', name: '规范选择', description: '选择要应用的编码规范', status: 'pending' },
  { id: 'auto-enrich', name: '自动生成', description: '生成代码示例和测试用例', status: 'pending' },
  { id: 'enrichment-summary', name: '确认', description: '确认并生成 prd.json', status: 'pending' },
];

export function PipelineProgress({
  currentStep,
  steps = DEFAULT_STEPS,
  onStepClick,
}: PipelineProgressProps) {
  return (
    <div className="w-full bg-white border-b border-neutral-200 py-6 px-8">
      <div className="flex items-center justify-between max-w-4xl mx-auto">
        {steps.map((step, index) => {
          const isCompleted = index < currentStep;
          const isCurrent = index === currentStep;
          const isClickable = isCompleted;

          return (
            <div key={step.id} className="flex items-center flex-1">
              {/* Step Circle */}
              <button
                onClick={() => isClickable && onStepClick(index)}
                disabled={!isClickable}
                className={`
                  flex items-center justify-center w-10 h-10 rounded-full text-sm font-medium
                  transition-all duration-200
                  ${isCompleted
                    ? 'bg-green-500 text-white cursor-pointer hover:bg-green-600'
                    : isCurrent
                      ? 'bg-blue-500 text-white ring-4 ring-blue-200'
                      : 'bg-neutral-200 text-neutral-500 cursor-not-allowed'
                  }
                `}
                title={isClickable ? '点击回看' : step.description}
              >
                {isCompleted ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  index + 1
                )}
              </button>

              {/* Step Info */}
              <div className="ml-3 min-w-0">
                <p className={`text-sm font-medium ${
                  isCurrent ? 'text-blue-600' : isCompleted ? 'text-green-600' : 'text-neutral-500'
                }`}>
                  {step.name}
                </p>
                <p className="text-xs text-neutral-400 truncate">{step.description}</p>
              </div>

              {/* Connector Line */}
              {index < steps.length - 1 && (
                <div className="flex-1 mx-4">
                  <div className={`h-0.5 ${
                    index < currentStep ? 'bg-green-500' : 'bg-neutral-200'
                  }`} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { DEFAULT_STEPS };
