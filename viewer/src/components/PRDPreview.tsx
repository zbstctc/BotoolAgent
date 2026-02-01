'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';

export interface PRDPreviewProps {
  content: string;
  title?: string;
  defaultCollapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

export function PRDPreview({
  content,
  title = 'PRD Preview',
  defaultCollapsed = false,
  onCollapsedChange,
}: PRDPreviewProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  const handleToggleCollapse = () => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    onCollapsedChange?.(newState);
  };

  return (
    <div
      className={`border-l border-neutral-200 bg-neutral-50 transition-all duration-200 flex flex-col ${
        isCollapsed ? 'w-12' : 'w-1/3 min-w-[300px]'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-neutral-200 bg-white shrink-0">
        <button
          onClick={handleToggleCollapse}
          className="p-1 rounded hover:bg-neutral-100 transition-colors"
          aria-label={isCollapsed ? 'Expand PRD preview' : 'Collapse PRD preview'}
        >
          <svg
            className={`w-5 h-5 text-neutral-500 transition-transform ${
              isCollapsed ? 'rotate-180' : ''
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
        {!isCollapsed && (
          <h2 className="text-sm font-medium text-neutral-700">{title}</h2>
        )}
        {!isCollapsed && (
          <div className="w-5" /> // Spacer for alignment
        )}
      </div>

      {/* Content */}
      {!isCollapsed && (
        <div className="flex-1 overflow-y-auto p-4">
          {content ? (
            <div className="prose prose-sm prose-neutral max-w-none prose-headings:text-neutral-900 prose-headings:font-semibold prose-h1:text-xl prose-h1:border-b prose-h1:border-neutral-200 prose-h1:pb-2 prose-h2:text-lg prose-h2:mt-6 prose-h3:text-base prose-p:text-neutral-700 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-li:text-neutral-700 prose-strong:text-neutral-900 prose-code:text-neutral-800 prose-code:bg-neutral-200 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none prose-pre:bg-neutral-200 prose-pre:text-neutral-800 prose-blockquote:border-l-neutral-300 prose-blockquote:text-neutral-600">
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-16 h-16 rounded-full bg-neutral-100 flex items-center justify-center mb-4">
                <svg
                  className="w-8 h-8 text-neutral-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
              <p className="text-sm text-neutral-500 mb-1">
                No PRD content yet
              </p>
              <p className="text-xs text-neutral-400">
                Your PRD will appear here as we discuss your project.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
