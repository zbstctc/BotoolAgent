'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { StageIndicator, TaskEditor, ChatInterface, SessionResumeDialog } from '@/components';
import { useCliChat, CliChatMessage } from '@/hooks';

interface PRDItem {
  id: string;
  name: string;
  filename: string;
  createdAt: string;
  status: 'draft' | 'ready' | 'in-progress' | 'completed';
  preview?: string;
}

interface DevTask {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  priority: number;
  passes: boolean;
  notes: string;
}

interface PrdJson {
  project: string;
  branchName: string;
  description: string;
  devTasks: DevTask[];
}

type ConversionStatus = 'idle' | 'converting' | 'success' | 'error';

const INITIAL_MESSAGE: CliChatMessage = {
  id: '1',
  role: 'assistant',
  content: 'Select a PRD from the list, then click "Convert to JSON" to start the conversion process. I can help you convert your PRD into structured development tasks.',
};

const RESUME_MESSAGE: CliChatMessage = {
  id: '1',
  role: 'assistant',
  content: 'Welcome back! I\'ve loaded your previous conversation. Feel free to continue adjusting the tasks or convert the PRD again if needed.',
};

export default function Stage2Page() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedPrdId = searchParams.get('prd');

  const [prds, setPrds] = useState<PRDItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPrd, setSelectedPrd] = useState<PRDItem | null>(null);
  const [prdContent, setPrdContent] = useState<string>('');
  const [loadingContent, setLoadingContent] = useState(false);

  // Conversion state
  const [conversionStatus, setConversionStatus] = useState<ConversionStatus>('idle');
  const [convertedPrd, setConvertedPrd] = useState<PrdJson | null>(null);
  const [conversionError, setConversionError] = useState<string>('');

  // Task editing state
  const [editableTasks, setEditableTasks] = useState<DevTask[]>([]);
  const [isSavingTasks, setIsSavingTasks] = useState(false);
  const [showTaskEditor, setShowTaskEditor] = useState(false);

  // Agent start state
  const [isStartingAgent, setIsStartingAgent] = useState(false);

  // Session resume state
  const [showResumeDialog, setShowResumeDialog] = useState(false);
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [pendingPrd, setPendingPrd] = useState<PRDItem | null>(null);

  // Store session ID for continuing conversation
  const sessionIdRef = useRef<string | undefined>(undefined);
  // Track current PRD ID for session mapping
  const currentPrdIdRef = useRef<string | undefined>(undefined);

  // CLI Chat hook for conversion
  const {
    messages,
    isLoading: isChatLoading,
    error: chatError,
    sessionId,
    sendMessage,
    setMessages,
    setSessionId,
  } = useCliChat({
    initialMessages: [INITIAL_MESSAGE],
    mode: 'convert',
    onError: (err) => {
      console.error('Chat error:', err);
      setConversionError(err);
      setConversionStatus('error');
    },
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
  });

  // Keep ref in sync with sessionId state
  if (sessionId && sessionIdRef.current !== sessionId) {
    sessionIdRef.current = sessionId;
  }

  // Extract JSON from messages when conversion is in progress
  const extractedJson = useMemo(() => {
    if (conversionStatus !== 'converting') return null;

    // Look through messages for JSON content
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message.role === 'assistant') {
        // Look for JSON blocks
        const jsonMatch = message.content.match(/```json\n([\s\S]*?)```/) ||
                         message.content.match(/```\n(\{[\s\S]*?\})\n```/) ||
                         message.content.match(/(\{[\s\S]*"devTasks"[\s\S]*\})/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[1]);
            if (parsed.devTasks && Array.isArray(parsed.devTasks)) {
              return parsed as PrdJson;
            }
          } catch {
            // Continue looking
          }
        }
      }
    }
    return null;
  }, [messages, conversionStatus]);

  // When JSON is extracted, update state
  useEffect(() => {
    if (extractedJson && conversionStatus === 'converting' && !isChatLoading) {
      setConvertedPrd(extractedJson);
      setEditableTasks(extractedJson.devTasks);
      setConversionStatus('success');
      setShowTaskEditor(true);

      // Save the JSON to prd.json
      savePrdJson(extractedJson);
    }
  }, [extractedJson, conversionStatus, isChatLoading]);

  async function savePrdJson(prdJson: PrdJson) {
    try {
      const response = await fetch('/api/prd/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(prdJson),
      });

      if (!response.ok) {
        console.error('Failed to save prd.json');
      }
    } catch (error) {
      console.error('Save prd.json error:', error);
    }
  }

  useEffect(() => {
    fetchPRDs();
  }, []);

  // Auto-select PRD from URL query param
  useEffect(() => {
    if (preselectedPrdId && prds.length > 0) {
      const prd = prds.find((p) => p.id === preselectedPrdId);
      if (prd && !selectedPrd) {
        handlePrdSelect(prd);
      }
    }
  }, [preselectedPrdId, prds, selectedPrd]);

  async function fetchPRDs() {
    try {
      const response = await fetch('/api/prd');
      const data = await response.json();
      setPrds(data.prds || []);
    } catch (error) {
      console.error('Failed to fetch PRDs:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handlePrdSelect(prd: PRDItem) {
    setLoadingContent(true);

    try {
      // Load PRD content first
      const response = await fetch(`/api/prd/${prd.id}`);
      const data = await response.json();
      const content = data.content || '';

      // Check for existing session
      const sessionResponse = await fetch(`/api/prd-sessions?prdId=${prd.id}`);
      if (sessionResponse.ok) {
        const sessionData = await sessionResponse.json();
        if (sessionData.sessionId) {
          // Found existing session, ask user if they want to resume
          setPendingSessionId(sessionData.sessionId);
          setPendingPrd(prd);
          setPrdContent(content);
          setShowResumeDialog(true);
          setLoadingContent(false);
          return;
        }
      }

      // No existing session, proceed normally
      finishPrdSelection(prd, content, false);
    } catch (error) {
      console.error('Failed to fetch PRD content:', error);
      setPrdContent('Failed to load PRD content');
    } finally {
      setLoadingContent(false);
    }
  }

  function finishPrdSelection(prd: PRDItem, content: string, resumeSession: boolean) {
    setSelectedPrd(prd);
    setPrdContent(content);
    currentPrdIdRef.current = prd.id;

    // Reset conversion state when selecting a new PRD
    setConversionStatus('idle');
    setConvertedPrd(null);
    setConversionError('');
    // Reset task editor state
    setEditableTasks([]);
    setShowTaskEditor(false);

    if (resumeSession && pendingSessionId) {
      // Resume existing session
      setSessionId(pendingSessionId);
      sessionIdRef.current = pendingSessionId;
      setMessages([RESUME_MESSAGE]);
    } else {
      // Start fresh
      setMessages([INITIAL_MESSAGE]);
      // Clear session mapping if starting new
      if (prd.id) {
        fetch(`/api/prd-sessions?prdId=${prd.id}`, {
          method: 'DELETE',
        }).catch(console.error);
      }
    }
  }

  // Handle resume session
  const handleResumeSession = useCallback(() => {
    if (pendingPrd && prdContent) {
      finishPrdSelection(pendingPrd, prdContent, true);
    }
    setShowResumeDialog(false);
    setPendingSessionId(null);
    setPendingPrd(null);
  }, [pendingPrd, prdContent, pendingSessionId]);

  // Handle start new session
  const handleStartNewSession = useCallback(() => {
    if (pendingPrd && prdContent) {
      finishPrdSelection(pendingPrd, prdContent, false);
    }
    setShowResumeDialog(false);
    setPendingSessionId(null);
    setPendingPrd(null);
  }, [pendingPrd, prdContent]);

  const handleConvert = useCallback(async () => {
    if (!selectedPrd || !prdContent || conversionStatus === 'converting' || isChatLoading) {
      return;
    }

    setConversionStatus('converting');
    setConvertedPrd(null);
    setConversionError('');

    // Send the PRD content to CLI for conversion
    const conversionPrompt = `Please convert this PRD to JSON format:

${prdContent}

Output the result as a JSON code block with the following structure:
\`\`\`json
{
  "project": "[Project Name]",
  "branchName": "botool/[feature-name-kebab-case]",
  "description": "[Feature description]",
  "devTasks": [...]
}
\`\`\``;

    sendMessage(conversionPrompt);
  }, [selectedPrd, prdContent, conversionStatus, isChatLoading, sendMessage]);

  const handleSendChatMessage = useCallback((content: string) => {
    sendMessage(content);
  }, [sendMessage]);

  const handleProceedToStage3 = useCallback(async () => {
    if (isStartingAgent) return;

    setIsStartingAgent(true);
    try {
      // Start the BotoolAgent in background
      const response = await fetch('/api/agent/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          maxIterations: 10,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        // If agent is already running, just navigate to stage 3
        if (response.status === 409) {
          console.log('Agent already running, proceeding to Stage 3');
        } else {
          console.error('Failed to start agent:', data.error);
          // Still navigate to stage 3 - user can start agent manually
        }
      } else {
        console.log('Agent started with PID:', data.pid);
      }

      // Navigate to Stage 3
      router.push('/stage3');
    } catch (error) {
      console.error('Error starting agent:', error);
      // Still navigate to stage 3 even if agent start fails
      router.push('/stage3');
    } finally {
      setIsStartingAgent(false);
    }
  }, [router, isStartingAgent]);

  const handleTasksChange = useCallback((tasks: DevTask[]) => {
    setEditableTasks(tasks);
  }, []);

  const handleSaveTasks = useCallback(async () => {
    if (!convertedPrd || isSavingTasks) return;

    setIsSavingTasks(true);
    try {
      const response = await fetch('/api/prd/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...convertedPrd,
          devTasks: editableTasks,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save tasks');
      }

      // Update the convertedPrd with new tasks
      setConvertedPrd({
        ...convertedPrd,
        devTasks: editableTasks,
      });
    } catch (error) {
      console.error('Save error:', error);
      alert('Failed to save changes. Please try again.');
    } finally {
      setIsSavingTasks(false);
    }
  }, [convertedPrd, editableTasks, isSavingTasks]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const statusStyles: Record<PRDItem['status'], string> = {
    draft: 'bg-neutral-100 text-neutral-600',
    ready: 'bg-green-100 text-green-700',
    'in-progress': 'bg-blue-100 text-blue-700',
    completed: 'bg-neutral-100 text-neutral-600',
  };

  const statusLabels: Record<PRDItem['status'], string> = {
    draft: 'Draft',
    ready: 'Ready',
    'in-progress': 'In Progress',
    completed: 'Completed',
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">
      {/* Stage Indicator */}
      <StageIndicator currentStage={2} completedStages={[1]} />

      {/* Session Resume Dialog */}
      <SessionResumeDialog
        isOpen={showResumeDialog}
        prdName={pendingPrd?.name}
        onResume={handleResumeSession}
        onStartNew={handleStartNewSession}
      />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: PRD List */}
        <div className="w-80 flex-shrink-0 border-r border-neutral-200 flex flex-col bg-neutral-50">
          <div className="p-4 border-b border-neutral-200 bg-white">
            <h2 className="text-sm font-semibold text-neutral-900">
              Select PRD
            </h2>
            <p className="text-xs text-neutral-500 mt-1">
              Choose a PRD to convert to development tasks
            </p>
          </div>

          <div className="flex-1 overflow-auto p-3">
            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="animate-pulse rounded-lg border border-neutral-200 bg-white p-3"
                  >
                    <div className="h-4 bg-neutral-200 rounded w-3/4 mb-2" />
                    <div className="h-3 bg-neutral-100 rounded w-1/2" />
                  </div>
                ))}
              </div>
            ) : prds.length > 0 ? (
              <div className="space-y-2">
                {prds.map((prd) => (
                  <button
                    key={prd.id}
                    onClick={() => handlePrdSelect(prd)}
                    className={`
                      w-full text-left rounded-lg border p-3 transition-all
                      ${
                        selectedPrd?.id === prd.id
                          ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                          : 'border-neutral-200 bg-white hover:border-neutral-300 hover:shadow-sm'
                      }
                    `}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-neutral-900 truncate">
                          {prd.name}
                        </p>
                        <p className="text-xs text-neutral-500 mt-0.5">
                          {formatDate(prd.createdAt)}
                        </p>
                      </div>
                      <span
                        className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${statusStyles[prd.status]}`}
                      >
                        {statusLabels[prd.status]}
                      </span>
                    </div>
                    {prd.preview && (
                      <p className="text-xs text-neutral-400 mt-2 line-clamp-2">
                        {prd.preview}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <div className="text-3xl text-neutral-300 mb-2">&#128196;</div>
                <p className="text-sm font-medium text-neutral-700">
                  No PRD documents
                </p>
                <p className="text-xs text-neutral-500 mt-1">
                  Create a PRD first in Stage 1
                </p>
                <a
                  href="/stage1"
                  className="mt-4 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 transition-colors"
                >
                  Create PRD
                </a>
              </div>
            )}
          </div>
        </div>

        {/* Middle: Chat / PRD Preview */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedPrd ? (
            <>
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-neutral-200 bg-white">
                <div>
                  <h2 className="text-lg font-semibold text-neutral-900">
                    {selectedPrd.name}
                  </h2>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {selectedPrd.filename}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {conversionStatus === 'success' && (
                    <button
                      onClick={handleProceedToStage3}
                      disabled={isStartingAgent}
                      className={`rounded-md px-4 py-2 text-sm font-medium text-white transition-colors ${
                        isStartingAgent
                          ? 'bg-green-400 cursor-wait'
                          : 'bg-green-600 hover:bg-green-700'
                      }`}
                    >
                      {isStartingAgent ? 'Starting...' : 'Start Development'}
                    </button>
                  )}
                  <button
                    onClick={handleConvert}
                    disabled={conversionStatus === 'converting' || loadingContent || isChatLoading}
                    className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                      conversionStatus === 'converting' || isChatLoading
                        ? 'bg-blue-100 text-blue-600 cursor-wait'
                        : conversionStatus === 'success'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {conversionStatus === 'converting' || isChatLoading
                      ? 'Converting...'
                      : conversionStatus === 'success'
                      ? 'Converted'
                      : 'Convert to JSON'}
                  </button>
                </div>
              </div>

              {/* Success Banner */}
              {conversionStatus === 'success' && convertedPrd && (
                <div className="p-3 bg-green-50 border-b border-green-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-green-600">&#10003;</span>
                    <span className="text-sm font-medium text-green-700">
                      prd.json created
                    </span>
                    <span className="text-xs text-neutral-500">|</span>
                    <span className="text-xs text-neutral-600">
                      {convertedPrd.project}
                    </span>
                    <span className="text-xs font-mono text-blue-600">
                      {convertedPrd.branchName}
                    </span>
                    <span className="text-xs text-neutral-500">|</span>
                    <span className="text-xs text-neutral-600">
                      {editableTasks.length} tasks
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowTaskEditor(!showTaskEditor)}
                      className="text-xs text-neutral-600 hover:text-neutral-900 underline"
                    >
                      {showTaskEditor ? 'View Chat' : 'Edit Tasks'}
                    </button>
                  </div>
                </div>
              )}

              {/* Error Banner */}
              {conversionStatus === 'error' && (
                <div className="p-4 bg-red-50 border-b border-red-100">
                  <div className="flex items-center gap-2">
                    <span className="text-red-500 text-lg">&#10007;</span>
                    <span className="text-sm font-medium text-red-700">
                      Conversion failed
                    </span>
                  </div>
                  {(conversionError || chatError) && (
                    <p className="text-sm text-red-600 mt-2">{conversionError || chatError}</p>
                  )}
                  <button
                    onClick={() => setConversionStatus('idle')}
                    className="mt-3 text-sm text-red-600 hover:text-red-700 underline"
                  >
                    Try again
                  </button>
                </div>
              )}

              {/* Content */}
              {showTaskEditor && editableTasks.length > 0 ? (
                <div className="flex-1 overflow-hidden">
                  <TaskEditor
                    tasks={editableTasks}
                    onTasksChange={handleTasksChange}
                    onSave={handleSaveTasks}
                    isSaving={isSavingTasks}
                  />
                </div>
              ) : conversionStatus === 'idle' && !isChatLoading ? (
                // Show PRD Preview when idle
                <div className="flex-1 overflow-auto p-6 bg-white">
                  {loadingContent ? (
                    <div className="animate-pulse space-y-3">
                      <div className="h-6 bg-neutral-200 rounded w-1/2" />
                      <div className="h-4 bg-neutral-100 rounded w-full" />
                      <div className="h-4 bg-neutral-100 rounded w-4/5" />
                      <div className="h-4 bg-neutral-100 rounded w-3/4" />
                      <div className="h-4 bg-neutral-100 rounded w-full" />
                      <div className="h-4 bg-neutral-100 rounded w-2/3" />
                    </div>
                  ) : (
                    <pre className="whitespace-pre-wrap font-mono text-sm text-neutral-700 leading-relaxed">
                      {prdContent}
                    </pre>
                  )}
                </div>
              ) : (
                // Show Chat Interface during/after conversion
                <div className="flex-1 flex flex-col overflow-hidden">
                  <ChatInterface
                    messages={messages}
                    onSendMessage={handleSendChatMessage}
                    isLoading={isChatLoading}
                    placeholder="Ask to adjust the tasks or provide more details..."
                  />
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center bg-neutral-50">
              <div className="text-center px-4">
                <div className="text-5xl text-neutral-200 mb-4">&#8592;</div>
                <p className="text-sm font-medium text-neutral-600">
                  Select a PRD from the list
                </p>
                <p className="text-xs text-neutral-400 mt-1">
                  Choose a PRD document to preview and convert to development tasks
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
