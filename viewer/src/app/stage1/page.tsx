'use client';

import { useState, useMemo } from 'react';
import { StageIndicator, ChatInterface } from '@/components';
import { useChat } from '@/hooks';

const INITIAL_MESSAGE = {
  id: '1',
  role: 'assistant' as const,
  content: 'Hi! I\'m here to help you create a **PRD** (Product Requirements Document).\n\nWhat would you like to build? Tell me about your project idea.',
};

export default function Stage1Page() {
  const {
    messages,
    isLoading,
    error,
    sendMessage,
  } = useChat({
    initialMessages: [INITIAL_MESSAGE],
    onError: (err) => console.error('Chat error:', err),
  });

  const [isPrdCollapsed, setIsPrdCollapsed] = useState(false);

  // Extract PRD content from messages when a PRD markdown block is detected
  const prdContent = useMemo(() => {
    // Look for PRD content in the latest assistant message
    const lastAssistantMessage = [...messages].reverse().find((m) => m.role === 'assistant');
    if (lastAssistantMessage) {
      // Look for PRD markdown blocks
      const prdMatch = lastAssistantMessage.content.match(/```markdown\n(# PRD:[\s\S]*?)```/);
      if (prdMatch) {
        return prdMatch[1];
      }
    }
    return '';
  }, [messages]);

  const handleSendMessage = (content: string) => {
    sendMessage(content);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      {/* Stage Indicator */}
      <StageIndicator currentStage={1} completedStages={[]} />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Chat Area */}
        <div className="flex-1 flex flex-col border-r border-neutral-200">
          {error && (
            <div className="mx-4 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}
          <ChatInterface
            messages={messages}
            onSendMessage={handleSendMessage}
            isLoading={isLoading}
            placeholder="Describe what you want to build..."
          />
        </div>

        {/* Right: PRD Preview Area */}
        <div
          className={`border-l border-neutral-200 bg-neutral-50 transition-all duration-200 ${
            isPrdCollapsed ? 'w-12' : 'w-1/3 min-w-[300px]'
          }`}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-3 border-b border-neutral-200 bg-white">
            <button
              onClick={() => setIsPrdCollapsed(!isPrdCollapsed)}
              className="p-1 rounded hover:bg-neutral-100 transition-colors"
              aria-label={isPrdCollapsed ? 'Expand PRD preview' : 'Collapse PRD preview'}
            >
              <svg
                className={`w-5 h-5 text-neutral-500 transition-transform ${
                  isPrdCollapsed ? 'rotate-180' : ''
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
            {!isPrdCollapsed && (
              <h2 className="text-sm font-medium text-neutral-700">PRD Preview</h2>
            )}
            {!isPrdCollapsed && (
              <div className="w-5" /> // Spacer for alignment
            )}
          </div>

          {/* Content */}
          {!isPrdCollapsed && (
            <div className="p-4 overflow-y-auto h-[calc(100%-49px)]">
              {prdContent ? (
                <pre className="whitespace-pre-wrap font-mono text-sm text-neutral-700">
                  {prdContent}
                </pre>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <div className="text-3xl text-neutral-300 mb-2">📄</div>
                  <p className="text-sm text-neutral-500">
                    Your PRD will appear here as we discuss your project.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
