'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createSession } from '@/lib/prd-session-storage';
import { useProject } from '@/contexts/ProjectContext';

interface NewPrdDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NewPrdDialog({ isOpen, onClose }: NewPrdDialogProps) {
  const router = useRouter();
  const { createProject } = useProject();
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus textarea when dialog opens
  useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isOpen]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setDescription('');
      setIsCreating(false);
    }
  }, [isOpen]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      const trimmedDescription = description.trim();
      if (!trimmedDescription) return;

      setIsCreating(true);

      try {
        // Use first 30 characters of description as temporary name
        const tempName = trimmedDescription.slice(0, 30) + (trimmedDescription.length > 30 ? '...' : '');

        // Create a new session with the temp name (legacy storage)
        const sessionId = createSession(tempName);

        // Also create a project in ProjectContext (new storage)
        // Store description in metadata for Stage 1 to use
        createProject(tempName, sessionId);

        // Store description in sessionStorage for Stage 1 to pick up
        sessionStorage.setItem(`botool-initial-description-${sessionId}`, trimmedDescription);

        // Navigate to Stage 1 with the session ID
        router.push(`/stage1?session=${sessionId}`);
        onClose();
      } catch (error) {
        console.error('Failed to create session:', error);
        setIsCreating(false);
      }
    },
    [description, router, onClose, createProject]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="relative w-full max-w-md bg-white rounded-lg shadow-xl mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-neutral-200">
          <h2 className="text-lg font-semibold text-neutral-900">
            新建 PRD
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
            aria-label="关闭"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit}>
          <div className="p-4">
            <label
              htmlFor="requirement-description"
              className="block text-sm font-medium text-neutral-700 mb-2"
            >
              需求描述
            </label>
            <textarea
              ref={textareaRef}
              id="requirement-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="请描述你想要构建的功能或解决的问题..."
              maxLength={500}
              rows={5}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all resize-none"
              disabled={isCreating}
            />
            <div className="mt-2 flex items-center justify-between">
              <p className="text-xs text-neutral-500">
                描述你想要的功能，系统会引导你完善需求
              </p>
              <span className="text-xs text-neutral-400">
                {description.length}/500
              </span>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 p-4 border-t border-neutral-200 bg-neutral-50">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 transition-colors"
              disabled={isCreating}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!description.trim() || isCreating}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed transition-colors"
            >
              {isCreating ? '创建中...' : '开始创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
