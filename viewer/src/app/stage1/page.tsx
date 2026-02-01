'use client';

import { useMemo, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { StageIndicator, ChatInterface, PRDPreview } from '@/components';
import { useCliChat, CliChatMessage } from '@/hooks';

const INITIAL_MESSAGE: CliChatMessage = {
  id: '1',
  role: 'assistant',
  content: 'Hi! I\'m here to help you create a **PRD** (Product Requirements Document).\n\nWhat would you like to build? Tell me about your project idea.',
};

export default function Stage1Page() {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();

  // Store session ID for saving with PRD
  const sessionIdRef = useRef<string | undefined>(undefined);

  const {
    messages,
    isLoading,
    error,
    sessionId,
    sendMessage,
  } = useCliChat({
    initialMessages: [INITIAL_MESSAGE],
    mode: 'prd',
    onError: (err) => console.error('Chat error:', err),
    onSessionIdChange: (newSessionId) => {
      sessionIdRef.current = newSessionId;
    },
  });

  // Keep ref in sync with sessionId state
  if (sessionId && sessionIdRef.current !== sessionId) {
    sessionIdRef.current = sessionId;
  }

  // Extract PRD content from messages when a PRD markdown block is detected
  const prdContent = useMemo(() => {
    // Look through all messages for the most recent PRD content
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message.role === 'assistant') {
        // Look for PRD markdown blocks with various patterns
        const prdMatch = message.content.match(/```markdown\n(# PRD:[\s\S]*?)```/) ||
                         message.content.match(/```\n(# PRD:[\s\S]*?)```/) ||
                         message.content.match(/(# PRD:[\s\S]+)/);
        if (prdMatch) {
          return prdMatch[1].trim();
        }
      }
    }
    return '';
  }, [messages]);

  const handleSendMessage = (content: string) => {
    sendMessage(content);
  };

  const handleSavePRD = useCallback(async () => {
    if (!prdContent || isSaving) return;

    setIsSaving(true);
    setSaveError(undefined);

    try {
      const response = await fetch('/api/prd/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: prdContent,
          sessionId: sessionIdRef.current,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save PRD');
      }

      setSaveSuccess(true);

      // Auto-navigate to stage2 after a short delay
      setTimeout(() => {
        router.push(`/stage2?prd=${data.id}`);
      }, 1500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save PRD');
    } finally {
      setIsSaving(false);
    }
  }, [prdContent, isSaving, router]);

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
        <PRDPreview
          content={prdContent}
          onSave={handleSavePRD}
          isSaving={isSaving}
          saveSuccess={saveSuccess}
          saveError={saveError}
        />
      </div>
    </div>
  );
}
