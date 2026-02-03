'use client';

import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { StageIndicator, ChatInterface, PRDPreview, SessionResumeDialog, ToolRenderer, StageTransitionModal } from '@/components';
import { useCliChat, CliChatMessage, ToolUse, useProjectValidation } from '@/hooks';
import { useProject } from '@/contexts/ProjectContext';
import {
  getSession,
  updateSession,
  deleteSession,
  type PrdSession,
} from '@/lib/prd-session-storage';

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
  const localSessionId = searchParams.get('session');

  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();

  // Stage transition modal state
  const [showTransitionModal, setShowTransitionModal] = useState(false);
  const [savedPrdId, setSavedPrdId] = useState<string | null>(null);

  // Project context
  const { createProject, updateProject, activeProject, setActiveProject } = useProject();

  // Project validation - skip if we have URL params (prdId or session)
  const hasUrlContext = Boolean(prdId || localSessionId);
  useProjectValidation({ currentStage: 1, skipValidation: hasUrlContext });

  // PRD loading state (for editing existing PRD)
  const [loadedPrdContent, setLoadedPrdContent] = useState<string>('');
  const [loadedPrdName, setLoadedPrdName] = useState<string>('');
  const [isLoadingPrd, setIsLoadingPrd] = useState(false);

  // Session resume state (server-side session for PRD editing)
  const [showResumeDialog, setShowResumeDialog] = useState(false);
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [sessionDecisionMade, setSessionDecisionMade] = useState(false);

  // Local session (from multi-session storage)
  const [currentLocalSession, setCurrentLocalSession] = useState<PrdSession | null>(null);

  // Store session ID for saving with PRD
  const sessionIdRef = useRef<string | undefined>(undefined);
  // Track current PRD ID for session mapping
  const currentPrdIdRef = useRef<string | undefined>(prdId || undefined);
  // Track the localStorage session ID
  const localSessionIdRef = useRef<string | undefined>(localSessionId || undefined);

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
      // Save CLI session ID to localStorage for session resume
      if (localSessionIdRef.current && newSessionId) {
        updateSession(localSessionIdRef.current, {
          cliSessionId: newSessionId,
        });
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

  // Redirect to Dashboard if no session or prd parameter
  useEffect(() => {
    if (!prdId && !localSessionId) {
      // No session specified, redirect to Dashboard
      router.replace('/');
    }
  }, [prdId, localSessionId, router]);

  // Load local session from localStorage when session param is provided
  useEffect(() => {
    if (!localSessionId) return;

    const session = getSession(localSessionId);
    if (session) {
      setCurrentLocalSession(session);
      localSessionIdRef.current = localSessionId;

      // Restore messages if available
      if (session.messages && session.messages.length > 0) {
        setMessages(session.messages);
      }

      // Restore CLI session ID for resuming Claude conversation
      if (session.cliSessionId) {
        setSessionId(session.cliSessionId);
        sessionIdRef.current = session.cliSessionId;
      }
    } else {
      // Session not found, redirect to Dashboard
      console.warn(`Session ${localSessionId} not found, redirecting to Dashboard`);
      router.replace('/');
    }
  }, [localSessionId, router, setMessages, setSessionId]);

  // Save messages to localStorage for context (only for local session)
  useEffect(() => {
    if (!localSessionIdRef.current) return;

    // Only save if we have more than the initial message
    if (messages.length > 1) {
      updateSession(localSessionIdRef.current, {
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
        })),
      });
    }
  }, [messages]);

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

  // Extract project name
  const projectName = useMemo(() => {
    // First check local session name
    if (currentLocalSession?.name) {
      return currentLocalSession.name;
    }
    // Fall back to extracting from messages
    const firstUserMessage = messages.find((m) => m.role === 'user');
    if (firstUserMessage) {
      const name = firstUserMessage.content.substring(0, 50).trim();
      return name.length < firstUserMessage.content.length ? name + '...' : name;
    }
    return loadedPrdName || undefined;
  }, [messages, currentLocalSession, loadedPrdName]);

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

      // Delete the localStorage session after successful save
      if (localSessionIdRef.current) {
        deleteSession(localSessionIdRef.current);
      }

      // Create or update project state
      if (activeProject) {
        // Update existing project
        updateProject(activeProject.id, {
          prdId: data.id,
          name: projectName || activeProject.name,
        });
      } else {
        // Create new project
        createProject(projectName || '未命名项目', data.id);
      }

      // Store the saved PRD ID for navigation
      setSavedPrdId(data.id);
      setSaveSuccess(true);

      // Show transition modal instead of auto-navigating
      setShowTransitionModal(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save PRD');
    } finally {
      setIsSaving(false);
    }
  }, [prdContent, isSaving, projectName, activeProject, updateProject, createProject]);

  // Handle transition modal confirm (continue to Stage 2)
  const handleTransitionConfirm = useCallback(() => {
    if (activeProject) {
      updateProject(activeProject.id, { currentStage: 2 });
    }
    router.push(`/stage2?prd=${savedPrdId}`);
  }, [activeProject, updateProject, router, savedPrdId]);

  // Handle transition modal later (go back to Dashboard)
  const handleTransitionLater = useCallback(() => {
    setShowTransitionModal(false);
    router.push('/');
  }, [router]);

  // Don't render if we should redirect
  if (!prdId && !localSessionId) {
    return (
      <div className="flex flex-col h-full bg-white">
        <StageIndicator currentStage={1} completedStages={[]} projectName={projectName} />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-neutral-500">Redirecting to Dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">
      {/* Stage Indicator */}
      <StageIndicator currentStage={1} completedStages={[]} projectName={projectName} />

      {/* Session Resume Dialog (server-side session for existing PRD) */}
      <SessionResumeDialog
        isOpen={showResumeDialog}
        prdName={loadedPrdName}
        onResume={handleResumeSession}
        onStartNew={handleStartNewSession}
      />

      {/* Stage Transition Modal */}
      <StageTransitionModal
        isOpen={showTransitionModal}
        fromStage={1}
        toStage={2}
        summary="PRD 已保存成功，可以开始将需求转换为开发任务。"
        onConfirm={handleTransitionConfirm}
        onLater={handleTransitionLater}
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
        <div className="flex-1 flex flex-col min-h-0 border-r border-neutral-200">
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
            toolRenderer={
              currentToolUse && (
                <ToolRenderer
                  tool={{
                    toolId: currentToolUse.id,
                    toolName: currentToolUse.name,
                    toolInput: currentToolUse.input,
                  }}
                  onRespond={handleToolRespond}
                  disabled={!pendingToolUse}
                  projectName={projectName}
                  sessionId={localSessionIdRef.current}
                />
              )
            }
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
