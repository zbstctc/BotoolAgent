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
  const [isHovered, setIsHovered] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleMouseEnter = useCallback(() => setIsHovered(true), []);
  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
    setShowDeleteConfirm(false);
  }, []);

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
        relative bg-white rounded-lg border transition-all duration-200 overflow-hidden
        ${isActive
          ? 'border-blue-300 ring-2 ring-blue-100'
          : 'border-neutral-200 hover:border-neutral-300'
        }
        ${isHovered ? 'shadow-md' : 'shadow-sm'}
      `}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Active indicator */}
      {isActive && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-blue-500" />
      )}

      {/* Main card content */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Stage icon */}
          <div className={`
            w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0
            ${isCompleted || isArchived
              ? 'bg-emerald-100 text-emerald-600'
              : 'bg-blue-100 text-blue-600'
            }
          `}>
            {isCompleted || isArchived ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <StageIcon stage={project.currentStage} className="w-5 h-5" />
            )}
          </div>

          {/* Project info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-neutral-900 truncate">
                {project.name}
              </h3>
              {isActive && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-500 text-white rounded">
                  当前
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className={`
                px-2 py-0.5 text-xs font-medium rounded-full
                ${statusStyle.bg} ${statusStyle.text}
              `}>
                {isCompleted || isArchived
                  ? statusStyle.label
                  : `Stage ${project.currentStage} · ${stageInfo.shortName}`
                }
              </span>
              <span className="text-xs text-neutral-400">
                {formatRelativeTime(project.updatedAt)}
              </span>
            </div>
          </div>
        </div>

        {/* Hover details panel */}
        {isHovered && (
          <div className="mt-4 pt-3 border-t border-neutral-100 space-y-2 animate-in fade-in duration-150">
            {/* Full stage info */}
            <div className="flex items-center gap-2 text-xs text-neutral-600">
              <span className="font-medium">阶段：</span>
              <span>{stageInfo.name}</span>
              <span className="text-neutral-300">|</span>
              <span className="font-medium">进度：</span>
              <span>{project.currentStage}/5</span>
            </div>

            {/* Branch name */}
            {project.branchName && (
              <div className="flex items-center gap-2 text-xs text-neutral-600">
                <svg className="w-3.5 h-3.5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2" />
                </svg>
                <span className="font-mono text-neutral-500 truncate">{project.branchName}</span>
              </div>
            )}

            {/* Update time */}
            <div className="flex items-center gap-2 text-xs text-neutral-600">
              <svg className="w-3.5 h-3.5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>更新于 {new Date(project.updatedAt).toLocaleString('zh-CN', {
                month: 'numeric',
                day: 'numeric',
                hour: 'numeric',
                minute: 'numeric'
              })}</span>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={handleView}
                className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
              >
                查看
              </button>

              {/* Show archive button for completed or pending merge projects */}
              {(isCompleted || isPendingMerge) && !isArchived && (
                <button
                  onClick={handleArchive}
                  className="px-3 py-1.5 text-xs font-medium text-neutral-600 bg-neutral-100 rounded-md hover:bg-neutral-200 transition-colors"
                >
                  归档
                </button>
              )}

              {/* Show delete button for in-progress projects */}
              {isInProgress && (
                <button
                  onClick={handleDelete}
                  className={`
                    px-3 py-1.5 text-xs font-medium rounded-md transition-colors
                    ${showDeleteConfirm
                      ? 'text-white bg-red-600 hover:bg-red-700'
                      : 'text-neutral-600 bg-neutral-100 hover:bg-neutral-200'
                    }
                  `}
                >
                  {showDeleteConfirm ? '确认删除' : '删除'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
