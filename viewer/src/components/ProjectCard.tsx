'use client';

import { useState, useCallback } from 'react';
import { type ProjectState, type ProjectStage, type ProjectStatus } from '../contexts/ProjectContext';

export interface ProjectCardProps {
  project: ProjectState;
  isActive?: boolean;
  onView: (project: ProjectState) => void;
  onDelete: (projectId: string) => void;
  onArchive: (projectId: string) => void;
}

const STAGE_INFO: Record<ProjectStage, { name: string; shortName: string }> = {
  1: { name: 'PRD 需求确认', shortName: '需求' },
  2: { name: '开发规划', shortName: '规划' },
  3: { name: 'Coding', shortName: '开发' },
  4: { name: '测试', shortName: '测试' },
  5: { name: 'Review', shortName: 'Review' },
};

const STATUS_STYLES: Record<ProjectStatus, { bg: string; text: string; label: string }> = {
  active: { bg: 'bg-blue-100', text: 'text-blue-700', label: '进行中' },
  paused: { bg: 'bg-amber-100', text: 'text-amber-700', label: '已暂停' },
  completed: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: '已完成' },
  archived: { bg: 'bg-neutral-100', text: 'text-neutral-500', label: '已归档' },
};

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} 天前`;
  if (hours > 0) return `${hours} 小时前`;
  if (minutes > 0) return `${minutes} 分钟前`;
  return '刚刚';
}

function StageIcon({ stage, className }: { stage: ProjectStage; className?: string }) {
  const iconClass = className || 'w-4 h-4';

  switch (stage) {
    case 1:
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      );
    case 2:
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
    case 3:
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
      );
    case 4:
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case 5:
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      );
  }
}

export function ProjectCard({
  project,
  isActive = false,
  onView,
  onDelete,
  onArchive,
}: ProjectCardProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleView = useCallback(() => {
    onView(project);
  }, [project, onView]);

  const handleDelete = useCallback(() => {
    if (showDeleteConfirm) {
      onDelete(project.id);
      setShowDeleteConfirm(false);
    } else {
      setShowDeleteConfirm(true);
    }
  }, [project.id, onDelete, showDeleteConfirm]);

  const handleArchive = useCallback(() => {
    onArchive(project.id);
  }, [project.id, onArchive]);

  const stageInfo = STAGE_INFO[project.currentStage];
  const statusStyle = STATUS_STYLES[project.status];
  const isCompleted = project.status === 'completed';
  const isArchived = project.status === 'archived';
  const isInProgress = project.status === 'active' && project.currentStage >= 1 && project.currentStage <= 4;
  const isPendingMerge = project.status === 'active' && project.currentStage === 5;

  return (
    <div
      className={`
        group flex items-center justify-between rounded-lg border bg-white p-4 transition-all cursor-pointer
        ${isActive
          ? 'border-blue-300 ring-2 ring-blue-100'
          : 'border-neutral-200 hover:border-neutral-300 hover:shadow-sm'
        }
      `}
      onClick={handleView}
      onMouseLeave={() => setShowDeleteConfirm(false)}
    >
      {/* Left: Project info */}
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="font-medium text-neutral-900 truncate">{project.name}</p>
          {isActive && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-500 text-white rounded flex-shrink-0">
              当前
            </span>
          )}
        </div>
        <p className="text-xs text-neutral-500">
          {isCompleted || isArchived
            ? statusStyle.label
            : `Stage ${project.currentStage} · ${stageInfo.name}`
          }
        </p>
        <p className="text-xs text-neutral-400 mt-0.5">
          {formatRelativeTime(project.updatedAt)} · 进度 {project.currentStage}/5
        </p>
      </div>

      {/* Right: Status and actions */}
      <div className="flex items-center gap-3 ml-4 flex-shrink-0">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}
        >
          {isCompleted || isArchived
            ? statusStyle.label
            : stageInfo.shortName
          }
        </span>

        {/* Action buttons - show on hover */}
        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
          {/* Show archive button for completed or pending merge projects */}
          {(isCompleted || isPendingMerge) && !isArchived && (
            <button
              onClick={(e) => { e.stopPropagation(); handleArchive(); }}
              className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 transition-all"
            >
              归档
            </button>
          )}

          {/* Show delete button for in-progress projects */}
          {isInProgress && (
            <button
              onClick={(e) => { e.stopPropagation(); handleDelete(); }}
              className={`
                rounded-md border px-3 py-1.5 text-xs font-medium transition-all
                ${showDeleteConfirm
                  ? 'border-red-200 bg-red-600 text-white hover:bg-red-700'
                  : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50'
                }
              `}
            >
              {showDeleteConfirm ? '确认删除' : '删除'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
