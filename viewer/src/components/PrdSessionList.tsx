'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getAllSessions, deleteSession, type PrdSession } from '@/lib/prd-session-storage';

interface PrdSessionListProps {
  onSessionChange?: () => void;
}

export function PrdSessionList({ onSessionChange }: PrdSessionListProps) {
  const router = useRouter();
  const [sessions, setSessions] = useState<PrdSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load sessions from localStorage
  const loadSessions = useCallback(() => {
    setIsLoading(true);
    try {
      const allSessions = getAllSessions();
      // Filter to only show sessions with some progress (questionAnswers not empty)
      const activeSessions = allSessions.filter(
        (s) => Object.keys(s.questionAnswers).length > 0
      );
      setSessions(activeSessions);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleContinue = useCallback(
    (sessionId: string) => {
      router.push(`/stage1?session=${sessionId}`);
    },
    [router]
  );

  const handleDelete = useCallback(
    (sessionId: string, sessionName: string) => {
      if (!confirm(`确定要删除「${sessionName}」吗？此操作不可撤销。`)) {
        return;
      }

      deleteSession(sessionId);
      loadSessions();
      onSessionChange?.();
    },
    [loadSessions, onSessionChange]
  );

  // Format relative time
  const formatRelativeTime = (timestamp: number): string => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes} 分钟前`;
    if (hours < 24) return `${hours} 小时前`;
    if (days < 7) return `${days} 天前`;

    const date = new Date(timestamp);
    return date.toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2].map((i) => (
          <div
            key={i}
            className="animate-pulse rounded-lg border border-neutral-200 bg-white p-4"
          >
            <div className="h-4 bg-neutral-200 rounded w-3/4 mb-2" />
            <div className="h-3 bg-neutral-100 rounded w-1/3" />
          </div>
        ))}
      </div>
    );
  }

  if (sessions.length === 0) {
    return null; // Don't show section if no active sessions
  }

  return (
    <div className="space-y-2">
      {sessions.map((session) => (
        <div
          key={session.id}
          className="group flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-4 hover:border-neutral-300 hover:shadow-sm transition-all"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-amber-500 text-sm">&#9679;</span>
              <p className="font-medium text-neutral-900 truncate">
                {session.name}
              </p>
            </div>
            <div className="flex items-center gap-4 mt-1.5 text-xs text-neutral-500">
              <span>
                回答进度: {session.answeredQuestions}/{session.totalQuestions || '?'} 个问题
              </span>
              <span>
                更新于 {formatRelativeTime(session.updatedAt)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 ml-4">
            <button
              onClick={() => handleContinue(session.id)}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
            >
              继续
            </button>
            <button
              onClick={() => handleDelete(session.id, session.name)}
              className="rounded-md border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50 hover:border-neutral-300 transition-colors opacity-0 group-hover:opacity-100"
            >
              删除
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
