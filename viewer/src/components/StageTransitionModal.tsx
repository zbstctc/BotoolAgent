'use client';

import { useCallback, useEffect, useState, useRef } from 'react';

export interface StageTransitionModalProps {
  isOpen: boolean;
  /** Current stage number (1-5) */
  fromStage: number;
  /** Next stage number (2-5) or 0 for completion */
  toStage: number;
  /** Summary text to display (e.g., "PRD 已保存到文件") */
  summary: string;
  /** Called when user clicks "Continue" */
  onConfirm: () => void;
  /** Called when user clicks "Later" */
  onLater: () => void;
  /** Auto-countdown in seconds. If set, auto-confirms after countdown. */
  autoCountdown?: number;
}

const STAGE_NAMES: Record<number, string> = {
  0: '完成',
  1: '需求收集',
  2: 'PRD 转换',
  3: '代码开发',
  4: '质量验证',
  5: '合并上线',
};

const STAGE_ICONS: Record<number, React.ReactNode> = {
  1: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  ),
  2: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  3: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
    </svg>
  ),
  4: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  5: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
};

export function StageTransitionModal({
  isOpen,
  fromStage,
  toStage,
  summary,
  onConfirm,
  onLater,
  autoCountdown,
}: StageTransitionModalProps) {
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const onConfirmRef = useRef(onConfirm);

  useEffect(() => {
    onConfirmRef.current = onConfirm;
  }, [onConfirm]);

  // Start countdown when modal opens with autoCountdown
  useEffect(() => {
    if (isOpen && autoCountdown && autoCountdown > 0) {
      setCountdown(autoCountdown);
    } else {
      setCountdown(null);
    }
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [isOpen, autoCountdown]);

  // Countdown timer tick
  useEffect(() => {
    if (countdown === null || countdown <= 0) return;

    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev === null || prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          // Auto-confirm when countdown reaches 0
          setTimeout(() => onConfirmRef.current(), 0);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [countdown]);

  const cancelCountdown = useCallback(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setCountdown(null);
  }, []);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) {
        cancelCountdown();
        onLater();
      }
    },
    [onLater, cancelCountdown]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancelCountdown();
        onLater();
      }
    },
    [onLater, cancelCountdown]
  );

  if (!isOpen) return null;

  const isCompletion = toStage === 0;
  const fromStageName = STAGE_NAMES[fromStage] || `Stage ${fromStage}`;
  const toStageName = STAGE_NAMES[toStage] || `Stage ${toStage}`;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        {/* Header with success indicator */}
        <div className="p-6 pb-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
              <svg
                className="w-6 h-6 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-neutral-900">
                {fromStageName}完成
              </h3>
              <p className="text-sm text-neutral-500">
                {isCompletion ? '项目已全部完成' : `即将进入${toStageName}`}
              </p>
            </div>
          </div>

          {/* Summary section */}
          <div className="bg-neutral-50 rounded-lg p-4 mb-4">
            <p className="text-sm text-neutral-700">{summary}</p>
          </div>

          {/* Next stage preview (if not completion) */}
          {!isCompletion && (
            <div className="flex items-center gap-3 text-sm text-neutral-600">
              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                {STAGE_ICONS[toStage]}
              </div>
              <div>
                <span className="font-medium text-neutral-900">下一步：</span>
                <span>{toStageName}</span>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 p-4 pt-2 border-t border-neutral-100">
          <button
            onClick={() => { cancelCountdown(); onLater(); }}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-neutral-700 bg-neutral-100 rounded-lg hover:bg-neutral-200 transition-colors"
          >
            {countdown !== null && countdown > 0 ? '取消' : '稍后继续'}
          </button>
          <button
            onClick={() => { cancelCountdown(); onConfirm(); }}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            {countdown !== null && countdown > 0
              ? `${countdown}s 后自动继续`
              : isCompletion ? '返回首页' : '继续'}
          </button>
        </div>
      </div>
    </div>
  );
}
