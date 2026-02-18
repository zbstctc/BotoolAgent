'use client';

import { cn } from '@/lib/utils';
import type { RequirementStage } from '@/lib/requirement-types';

interface StageProgressBarProps {
  currentStage: RequirementStage;
  className?: string;
}

const STAGE_COUNT = 6;

export function StageProgressBar({ currentStage, className }: StageProgressBarProps) {
  return (
    <div className={cn('flex items-center', className)}>
      {Array.from({ length: STAGE_COUNT }, (_, index) => {
        const isCompleted = index < currentStage;
        const isCurrent = index === currentStage;
        const isLast = index === STAGE_COUNT - 1;

        return (
          <div key={index} className="flex items-center">
            {/* Node */}
            <div
              className={cn(
                'w-3 h-3 rounded-full flex-shrink-0',
                isCompleted && 'bg-foreground',
                isCurrent && 'bg-foreground animate-pulse',
                !isCompleted && !isCurrent && 'border border-muted-foreground/30 bg-transparent',
              )}
            />

            {/* Connector line */}
            {!isLast && (
              <div
                className={cn(
                  'h-px w-6 flex-shrink-0',
                  isCompleted
                    ? 'border-b border-foreground'
                    : 'border-b border-dashed border-muted-foreground/30',
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
