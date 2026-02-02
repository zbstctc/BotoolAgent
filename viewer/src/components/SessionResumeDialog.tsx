'use client';

import { useCallback } from 'react';

interface SessionResumeDialogProps {
  isOpen: boolean;
  prdName?: string;
  /** Number of questions answered */
  answeredCount?: number;
  /** Total number of questions */
  totalCount?: number;
  /** Last updated timestamp */
  lastUpdated?: number;
  /** Current time for relative time formatting (optional, provided by parent) */
  currentTime?: number;
  onResume: () => void;
  onStartNew: () => void;
}

/**
 * Format a timestamp as a relative time string.
 * This is a pure function that takes both timestamps as arguments.
 */
function formatRelativeTime(timestamp: number, currentTime: number): string {
  const diff = currentTime - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  return `${days} 天前`;
}

export function SessionResumeDialog({
  isOpen,
  prdName,
  answeredCount,
  totalCount,
  lastUpdated,
  currentTime,
  onResume,
  onStartNew,
}: SessionResumeDialogProps) {
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) {
        onStartNew();
      }
    },
    [onStartNew]
  );

  if (!isOpen) return null;

  // Compute formatted time only when rendering (after isOpen check)
  // Use provided currentTime or default to 0 (will show reasonable fallback)
  const formattedLastUpdated =
    lastUpdated !== undefined && currentTime !== undefined
      ? formatRelativeTime(lastUpdated, currentTime)
      : null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
            <svg
              className="w-5 h-5 text-blue-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-neutral-900">
              发现未完成的会话
            </h3>
            {prdName && (
              <p className="text-sm text-neutral-500">{prdName}</p>
            )}
          </div>
        </div>

        {/* Progress info */}
        {(answeredCount !== undefined || lastUpdated !== undefined) && (
          <div className="bg-neutral-50 rounded-lg p-4 mb-4 space-y-2">
            {answeredCount !== undefined && totalCount !== undefined && totalCount > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-neutral-600">回答进度</span>
                <span className="font-medium text-neutral-900">
                  {answeredCount}/{totalCount} 个问题
                </span>
              </div>
            )}
            {formattedLastUpdated !== null && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-neutral-600">上次更新</span>
                <span className="text-neutral-500">{formattedLastUpdated}</span>
              </div>
            )}
          </div>
        )}

        <p className="text-sm text-neutral-600 mb-6">
          您有一个未完成的 PRD 创建会话。是否继续上次的进度，还是重新开始？
        </p>

        <div className="flex gap-3">
          <button
            onClick={onStartNew}
            className="flex-1 px-4 py-2 text-sm font-medium text-neutral-700 bg-neutral-100 rounded-lg hover:bg-neutral-200 transition-colors"
          >
            重新开始
          </button>
          <button
            onClick={onResume}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            继续
          </button>
        </div>
      </div>
    </div>
  );
}
