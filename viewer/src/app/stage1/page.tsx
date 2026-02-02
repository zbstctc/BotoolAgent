'use client';

import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { StageIndicator, ChatInterface, PRDPreview, SessionResumeDialog, ToolRenderer } from '@/components';
import { useCliChat, CliChatMessage, ToolUse } from '@/hooks';

const INITIAL_MESSAGE: CliChatMessage = {
  id: '1',
  role: 'assistant',
  content: 'Hi! I\'m here to help you create a **PRD** (Product Requirements Document).\n\nWhat would you like to build? Tell me about your project idea.',
};

const RESUME_MESSAGE: CliChatMessage = {
  id: '1',
  role: 'assistant',
  content: 'Welcome back! I\'ve loaded your previous conversation. Feel free to continue where we left off, or let me know if you\'d like to make any changes to your PRD.',
};

export default function Stage1Page() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prdId = searchParams.get('prd');

  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();

  // PRD loading state
  const [loadedPrdContent, setLoadedPrdContent] = useState<string>('');
  const [loadedPrdName, setLoadedPrdName] = useState<string>('');
  const [isLoadingPrd, setIsLoadingPrd] = useState(false);

  // Session resume state
  const [showResumeDialog, setShowResumeDialog] = useState(false);
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [sessionDecisionMade, setSessionDecisionMade] = useState(false);

  // Store session ID for saving with PRD
  const sessionIdRef = useRef<string | undefined>(undefined);
  // Track current PRD ID for session mapping
  const currentPrdIdRef = useRef<string | undefined>(prdId || undefined);

  // Track current tool use for rendering
  const [currentToolUse, setCurrentToolUse] = useState<ToolUse | null>(null);

  const {
    messages,
    isLoading,
    error,
    sessionId,
    pendingToolUse,
    sendMessage,
    setSessionId,
    setMessages,
    respondToTool,
  } = useCliChat({
    initialMessages: [INITIAL_MESSAGE],
    mode: 'prd',
    onError: (err) => console.error('Chat error:', err),
    onSessionIdChange: (newSessionId) => {
      sessionIdRef.current = newSessionId;
      // Update session mapping if we have a PRD ID
      if (currentPrdIdRef.current && newSessionId) {
        fetch('/api/prd-sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prdId: currentPrdIdRef.current,
            sessionId: newSessionId,
          }),
        }).catch(console.error);
      }
    },
    onToolUse: (toolUse) => {
      // Track tool use for rendering
      setCurrentToolUse(toolUse);
    },
  });

  // Keep ref in sync with sessionId state
  if (sessionId && sessionIdRef.current !== sessionId) {
    sessionIdRef.current = sessionId;
  }

  // Load PRD content and check for existing session when prdId is provided
  useEffect(() => {
    if (!prdId || sessionDecisionMade) return;

    const loadPrdAndSession = async () => {
      setIsLoadingPrd(true);
      try {
        // Load PRD content
        const prdResponse = await fetch(`/api/prd/${prdId}`);
        if (prdResponse.ok) {
          const prdData = await prdResponse.json();
          setLoadedPrdContent(prdData.content || '');
          // Extract name from content or use filename
          const nameMatch = prdData.content?.match(/^#\s*PRD:\s*(.+)$/m);
          setLoadedPrdName(nameMatch ? nameMatch[1] : prdId);
          currentPrdIdRef.current = prdId;
        }

        // Check for existing session
        const sessionResponse = await fetch(`/api/prd-sessions?prdId=${prdId}`);
        if (sessionResponse.ok) {
          const sessionData = await sessionResponse.json();
          if (sessionData.sessionId) {
            setPendingSessionId(sessionData.sessionId);
            setShowResumeDialog(true);
          } else {
            // No existing session, proceed normally
            setSessionDecisionMade(true);
          }
        } else {
          setSessionDecisionMade(true);
        }
      } catch (err) {
        console.error('Error loading PRD or session:', err);
        setSessionDecisionMade(true);
      } finally {
        setIsLoadingPrd(false);
      }
    };

    loadPrdAndSession();
  }, [prdId, sessionDecisionMade]);

  // Handle resume session
  const handleResumeSession = useCallback(() => {
    if (pendingSessionId) {
      setSessionId(pendingSessionId);
      sessionIdRef.current = pendingSessionId;
      setMessages([RESUME_MESSAGE]);
    }
    setShowResumeDialog(false);
    setSessionDecisionMade(true);
  }, [pendingSessionId, setSessionId, setMessages]);

  // Handle start new session
  const handleStartNewSession = useCallback(() => {
    // Clear the session mapping for this PRD
    if (currentPrdIdRef.current) {
      fetch(`/api/prd-sessions?prdId=${currentPrdIdRef.current}`, {
        method: 'DELETE',
      }).catch(console.error);
    }
    setShowResumeDialog(false);
    setSessionDecisionMade(true);
  }, []);

  // Extract PRD content from messages when a PRD markdown block is detected
  const prdContent = useMemo(() => {
    // If we have loaded PRD content, prioritize messages for any updates
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
    // Fall back to loaded PRD content if no PRD in messages
    return loadedPrdContent;
  }, [messages, loadedPrdContent]);

  const handleSendMessage = (content: string) => {
    sendMessage(content);
  };

  // Handle tool response from ToolRenderer
  const handleToolRespond = useCallback(
    (toolId: string, response: Record<string, unknown>) => {
      respondToTool(toolId, response);
      // Clear the current tool use after responding
      setCurrentToolUse(null);
    },
    [respondToTool]
  );

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

      // Update current PRD ID ref
      currentPrdIdRef.current = data.id;

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

      {/* Session Resume Dialog */}
      <SessionResumeDialog
        isOpen={showResumeDialog}
        prdName={loadedPrdName}
        onResume={handleResumeSession}
        onStartNew={handleStartNewSession}
      />

      {/* Loading Overlay */}
      {isLoadingPrd && (
        <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-40">
          <div className="text-center">
            <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-2"></div>
            <p className="text-sm text-neutral-600">Loading PRD...</p>
          </div>
        </div>
      )}

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
            isLoading={isLoading && !pendingToolUse}
            placeholder="Describe what you want to build..."
          />
          {/* Tool Renderer for interactive tool calls */}
          {currentToolUse && (
            <div className="px-4 pb-4">
              <ToolRenderer
                tool={{
                  toolId: currentToolUse.id,
                  toolName: currentToolUse.name,
                  toolInput: currentToolUse.input,
                }}
                onRespond={handleToolRespond}
                disabled={!pendingToolUse}
              />
            </div>
          )}
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
