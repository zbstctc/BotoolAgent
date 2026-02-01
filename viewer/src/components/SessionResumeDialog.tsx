'use client';

import { useCallback } from 'react';

interface SessionResumeDialogProps {
  isOpen: boolean;
  prdName?: string;
  onResume: () => void;
  onStartNew: () => void;
}

export function SessionResumeDialog({
  isOpen,
  prdName,
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
              Resume Previous Conversation?
            </h3>
            {prdName && (
              <p className="text-sm text-neutral-500">for {prdName}</p>
            )}
          </div>
        </div>

        <p className="text-sm text-neutral-600 mb-6">
          A previous conversation session was found for this PRD. Would you like
          to resume where you left off, or start a new conversation?
        </p>

        <div className="flex gap-3">
          <button
            onClick={onStartNew}
            className="flex-1 px-4 py-2 text-sm font-medium text-neutral-700 bg-neutral-100 rounded-lg hover:bg-neutral-200 transition-colors"
          >
            Start New
          </button>
          <button
            onClick={onResume}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Resume Session
          </button>
        </div>
      </div>
    </div>
  );
}
