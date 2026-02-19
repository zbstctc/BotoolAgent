'use client';

import { useState } from 'react';
import { MoreHorizontal, Archive, Trash2, GitBranch, ExternalLink, X } from 'lucide-react';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { StageTimeline } from '@/components/StageTimeline';
import {
  type Requirement,
  type RequirementStage,
} from '@/lib/requirement-types';

export interface RequirementDrawerProps {
  requirement: Requirement | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate?: (stage: RequirementStage) => void;
  onDelete?: (id: string) => void;
  onArchive?: (id: string) => void;
}

function TaskSection({ requirement }: { requirement: Requirement }) {
  const completed = requirement.tasksCompleted ?? 0;
  const total = requirement.taskCount ?? 0;
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
        任务详情
      </h3>
      <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-neutral-600">任务进度</span>
          <span className="text-sm font-medium text-neutral-900">
            {completed} / {total}
          </span>
        </div>
        {/* Progress bar */}
        <div className="h-1.5 w-full rounded-full bg-neutral-200">
          <div
            className="h-1.5 rounded-full bg-emerald-500 transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <span className="text-xs text-neutral-400">完成率 {progressPct}%</span>
      </div>
    </div>
  );
}

function GitSection({ requirement }: { requirement: Requirement }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
        Git 信息
      </h3>
      <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3 flex flex-col gap-2">
        {requirement.branchName && (
          <div className="flex items-center gap-2">
            <GitBranch className="h-3.5 w-3.5 text-neutral-400 flex-shrink-0" />
            <span className="text-xs font-mono text-neutral-700 truncate">
              {requirement.branchName}
            </span>
          </div>
        )}
        {requirement.prUrl && (
          <a
            href={requirement.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-xs text-neutral-600 hover:text-neutral-900 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="truncate">{requirement.prUrl}</span>
          </a>
        )}
      </div>
    </div>
  );
}

function MoreActionsMenu({
  requirement,
  onArchive,
  onDeleteRequest,
}: {
  requirement: Requirement;
  onArchive?: (id: string) => void;
  onDeleteRequest?: () => void;
}) {
  const [open, setOpen] = useState(false);

  const handleArchive = () => {
    setOpen(false);
    onArchive?.(requirement.id);
  };

  const handleDeleteClick = () => {
    setOpen(false);
    onDeleteRequest?.();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-neutral-500 hover:text-neutral-900"
          aria-label="更多操作"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-44 p-1 bg-white"
        sideOffset={4}
      >
        {onArchive && requirement.status !== 'archived' && (
          <button
            onClick={handleArchive}
            className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50 transition-colors"
          >
            <Archive className="h-3.5 w-3.5 text-neutral-400" />
            归档
          </button>
        )}
        {onDeleteRequest && (
          <button
            onClick={handleDeleteClick}
            className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5 text-neutral-400" />
            删除
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function RequirementDrawer({
  requirement,
  open,
  onOpenChange,
  onNavigate,
  onDelete,
  onArchive,
}: RequirementDrawerProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  if (!requirement) return null;

  const hasTaskInfo = requirement.taskCount != null && requirement.stage >= 2;
  const hasGitInfo = requirement.branchName != null && requirement.stage >= 3;

  const handleConfirmDelete = () => {
    setDeleteDialogOpen(false);
    onDelete?.(requirement.id);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          showCloseButton={false}
          className="flex flex-col bg-white p-0 sm:max-w-[420px]"
        >
          {/* Header */}
          <SheetHeader className="flex flex-row items-center justify-between border-b border-neutral-100 px-5 py-4 gap-2">
            <SheetTitle className="truncate text-base font-semibold text-neutral-900">
              {requirement.name}
            </SheetTitle>
            <div className="flex items-center gap-1 flex-shrink-0">
              <MoreActionsMenu
                requirement={requirement}
                onArchive={onArchive}
                onDeleteRequest={onDelete ? () => setDeleteDialogOpen(true) : undefined}
              />
              <SheetClose asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-neutral-500 hover:text-neutral-900">
                  <X className="h-4 w-4" />
                </Button>
              </SheetClose>
            </div>
          </SheetHeader>

          {/* Scrollable body */}
          <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
            {/* Stage Timeline section */}
            <div className="flex flex-col gap-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                阶段进度
              </h3>
              <StageTimeline
                requirement={requirement}
                onStageAction={onNavigate}
              />
            </div>

            {/* Divider before optional sections */}
            {(hasTaskInfo || hasGitInfo) && (
              <div className="border-t border-neutral-100" />
            )}

            {/* Task details (Stage 2+) */}
            {hasTaskInfo && <TaskSection requirement={requirement} />}

            {/* Git info (Stage 3+) */}
            {hasGitInfo && <GitSection requirement={requirement} />}
          </div>
        </SheetContent>
      </Sheet>

      {/* Delete confirmation dialog — outside Sheet to avoid focus conflicts */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-sm bg-white">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-neutral-600">
            删除后不可恢复，确认删除「{requirement.name}」？
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleConfirmDelete}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
