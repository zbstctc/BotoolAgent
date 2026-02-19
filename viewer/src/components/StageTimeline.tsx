'use client';

import { Check, Clock, Circle, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  type Requirement,
  type RequirementStage,
  STAGE_META,
} from '@/lib/requirement-types';

export interface StageTimelineProps {
  requirement: Requirement;
  onStageAction?: (stage: RequirementStage) => void;
}

const STAGE_ACTION_LABELS: Record<RequirementStage, string> = {
  0: '开始 PRD',
  1: '继续生成',
  2: '开始开发',
  3: '查看开发',
  4: '查看测试',
  5: '合并代码',
};

function getStageSubtitle(requirement: Requirement, stageIndex: number): string | null {
  switch (stageIndex) {
    case 0:
      return requirement.sourceFile
        ? `来源: ${requirement.sourceFile.split('/').pop()}`
        : null;
    case 1:
      return requirement.prdId ? `prd-${requirement.prdId}.md` : null;
    case 2:
      return requirement.prdJsonPath
        ? requirement.prdJsonPath.split('/').pop() ?? null
        : null;
    case 3:
      return requirement.branchName ? `分支: ${requirement.branchName}` : null;
    case 4:
      return requirement.tasksCompleted != null && requirement.taskCount != null
        ? `完成: ${requirement.tasksCompleted}/${requirement.taskCount}`
        : null;
    case 5:
      return requirement.prUrl ? `PR: ${requirement.prUrl}` : null;
    default:
      return null;
  }
}

type StageState = 'completed' | 'current' | 'upcoming';

function getStageState(requirement: Requirement, stageIndex: number): StageState {
  if (stageIndex < requirement.stage) return 'completed';
  if (stageIndex === requirement.stage) return 'current';
  return 'upcoming';
}

function getStageLabelText(stageIndex: number, state: StageState): string {
  const meta = STAGE_META[stageIndex];
  if (state === 'completed' && meta.labelCompleted) {
    return meta.labelCompleted;
  }
  return meta.label;
}

function StageIcon({ state }: { state: StageState }) {
  if (state === 'completed') {
    return (
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 flex-shrink-0">
        <Check className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2.5} />
      </div>
    );
  }
  if (state === 'current') {
    return (
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900 flex-shrink-0">
        <Clock className="h-3.5 w-3.5 text-white" strokeWidth={2} />
      </div>
    );
  }
  return (
    <div className="flex h-6 w-6 items-center justify-center rounded-full border border-neutral-200 bg-neutral-50 flex-shrink-0">
      <Circle className="h-3 w-3 text-neutral-300" strokeWidth={1.5} />
    </div>
  );
}

export function StageTimeline({ requirement, onStageAction }: StageTimelineProps) {
  const stages: RequirementStage[] = [0, 1, 2, 3, 4, 5];

  return (
    <div className="flex flex-col">
      {stages.map((stageIndex) => {
        const state = getStageState(requirement, stageIndex);
        const label = getStageLabelText(stageIndex, state);
        const subtitle = getStageSubtitle(requirement, stageIndex);
        const isCurrent = state === 'current';
        const isLast = stageIndex === 5;

        return (
          <div key={stageIndex} className="flex gap-3">
            {/* Left: icon + connector line */}
            <div className="flex flex-col items-center">
              <StageIcon state={state} />
              {!isLast && (
                <div
                  className={cn(
                    'mt-1 mb-1 w-px flex-1 min-h-[20px]',
                    state === 'completed' ? 'bg-emerald-200' : 'bg-neutral-100'
                  )}
                />
              )}
            </div>

            {/* Right: content */}
            <div
              className={cn(
                'flex flex-col gap-0.5 pb-4 flex-1 min-w-0',
                isLast && 'pb-0'
              )}
            >
              <div className="flex items-center justify-between gap-2 min-h-[24px]">
                <span
                  className={cn(
                    'text-sm font-medium leading-6',
                    state === 'completed' && 'text-neutral-500',
                    state === 'current' && 'text-neutral-900',
                    state === 'upcoming' && 'text-neutral-300'
                  )}
                >
                  Stage {stageIndex} · {label}
                </span>

                {isCurrent && onStageAction && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-xs flex-shrink-0"
                    onClick={() => onStageAction(stageIndex as RequirementStage)}
                  >
                    {STAGE_ACTION_LABELS[stageIndex as RequirementStage]}
                    <ChevronRight className="ml-0.5 h-3 w-3" />
                  </Button>
                )}
              </div>

              {subtitle && (
                <span
                  className={cn(
                    'text-xs truncate',
                    state === 'completed' && 'text-neutral-400',
                    state === 'current' && 'text-neutral-500',
                    state === 'upcoming' && 'text-neutral-300'
                  )}
                >
                  {subtitle}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
