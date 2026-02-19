'use client';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StageProgressBar } from '@/components/StageProgressBar';
import { type Requirement, STAGE_META } from '@/lib/requirement-types';

export interface RequirementCardProps {
  requirement: Requirement;
  isSelected?: boolean;
  onClick?: () => void;    // card click → open drawer
  onAction?: () => void;   // action button click → navigate/open tab
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
}

function getActionLabel(stage: Requirement['stage']): string {
  if (stage === 0) return '开始 →';
  if (stage === 5) return '查看';
  return '继续 →';
}

export function RequirementCard({
  requirement,
  isSelected = false,
  onClick,
  onAction,
}: RequirementCardProps) {
  const { name, stage, status, updatedAt, taskCount, tasksCompleted } = requirement;
  const stageMeta = STAGE_META[stage];

  // Determine stage label: use labelCompleted when merged (status completed)
  // or when all tasks done at a non-final stage (e.g., Stage 3 "开发完成")
  const allTasksDone = typeof taskCount === 'number' && taskCount > 0 && tasksCompleted === taskCount;
  const showCompleted = status === 'completed' || (allTasksDone && stage < 5);
  const stageLabel = showCompleted && stageMeta.labelCompleted
    ? stageMeta.labelCompleted
    : stageMeta.label;

  const hasTaskInfo = typeof taskCount === 'number' && taskCount > 0;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
      className={cn(
        'w-full rounded-lg border bg-white p-4 text-left transition-colors cursor-pointer',
        'hover:border-neutral-300 hover:bg-neutral-50',
        isSelected
          ? 'border-neutral-900 shadow-sm'
          : 'border-neutral-200',
      )}
    >
      {/* Title row */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-neutral-900 leading-snug line-clamp-2">
          {name}
        </h3>
      </div>

      {/* Progress bar + stage label + action button */}
      <div className="mt-3 flex items-center gap-3">
        <StageProgressBar currentStage={stage} allDone={status === 'completed'} />

        <div className="flex flex-1 items-center gap-2">
          <Badge variant={stageMeta.badgeVariant as Parameters<typeof Badge>[0]['variant']}>
            {stageLabel}
          </Badge>
        </div>

        {/* Action button — stopPropagation prevents card click from firing */}
        <Button
          size="sm"
          variant="outline"
          className="flex-shrink-0 h-7 text-xs px-3"
          onClick={(e) => {
            e.stopPropagation();
            onAction?.();
          }}
        >
          {getActionLabel(stage)}
        </Button>
      </div>

      {/* Meta row: date + task count */}
      <div className="mt-2 flex items-center gap-2 text-xs text-neutral-400">
        <span>{formatDate(updatedAt)} 更新</span>
        {hasTaskInfo && (
          <>
            <span>·</span>
            <span>
              {tasksCompleted ?? 0}/{taskCount} 个任务完成
            </span>
          </>
        )}
      </div>
    </div>
  );
}
