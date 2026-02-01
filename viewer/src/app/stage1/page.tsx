'use client';

import { useState } from 'react';
import { StageIndicator, ChatInterface, Message } from '@/components';

export default function Stage1Page() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Hi! I\'m here to help you create a **PRD** (Product Requirements Document).\n\nWhat would you like to build? Tell me about your project idea.',
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [prdContent, setPrdContent] = useState<string>('');
  const [isPrdCollapsed, setIsPrdCollapsed] = useState(false);

  const handleSendMessage = (content: string) => {
    const newMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content,
    };

    setMessages((prev) => [...prev, newMessage]);

    // TODO: Integrate with AI API in DT-012
    // For now, simulate a response
    setIsLoading(true);
    setTimeout(() => {
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Thanks for sharing! I'll help you flesh out the requirements.\n\n**To better understand your needs, let me ask:**\n\n1. Who is the target audience for this feature?\n2. What problem does it solve?\n3. Are there any technical constraints we should consider?`,
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setIsLoading(false);
    }, 1500);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      {/* Stage Indicator */}
      <StageIndicator currentStage={1} completedStages={[]} />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Chat Area */}
        <div className="flex-1 flex flex-col border-r border-neutral-200">
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
