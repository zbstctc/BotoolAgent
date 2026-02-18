'use client';

import { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { StageIndicator, StageTransitionModal } from '@/components';
import { useFileWatcher, parsePrdJson, useProjectValidation } from '@/hooks';
import { useProject } from '@/contexts/ProjectContext';
import { useRequirement } from '@/contexts/RequirementContext';

type TestingStatus = 'idle' | 'running' | 'complete' | 'failed' | 'error';

interface AgentStatus {
  status: string;
  message: string;
  iteration: number;
  maxIterations: number;
  completed: number;
  total: number;
  currentTask: string;
}

function Stage4PageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { activeProject, updateProject } = useProject();

  // Requirement context - resolve `req` param
  const { requirements } = useRequirement();
  const reqId = searchParams.get('req') || undefined;
  const activeRequirement = reqId ? requirements.find(r => r.id === reqId) : undefined;

  // projectId: explicit param takes priority, then req.id as fallback
  const rawProjectId = searchParams.get('projectId') || undefined;
  const projectId = rawProjectId ?? (activeRequirement?.id);

  useProjectValidation({ currentStage: 4 });

  const [testingStatus, setTestingStatus] = useState<TestingStatus>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [agentLog, setAgentLog] = useState<string[]>([]);
  const [showTransitionModal, setShowTransitionModal] = useState(false);
  const [projectName, setProjectName] = useState('');
  const logEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // File watcher for PRD
  const { prd } = useFileWatcher({
    projectId,
    enabled: true,
    onPrdUpdate: (content) => {
      const parsed = parsePrdJson(content);
      if (parsed) setProjectName(parsed.project || '');
    },
  });

  useEffect(() => {
    if (prd) {
      const parsed = parsePrdJson(prd);
      if (parsed) setProjectName(parsed.project || '');
    }
  }, [prd]);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [agentLog]);

  // Poll agent status via SSE
  const startStatusPolling = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const params = new URLSearchParams({ stream: 'true' });
    if (projectId) params.set('projectId', projectId);

    const es = new EventSource(`/api/agent/status?${params.toString()}`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        const status: AgentStatus = parsed.data || parsed;

        setStatusMessage(status.message || '');

        if (status.currentTask && status.currentTask !== 'none') {
          setAgentLog(prev => {
            const msg = `[${new Date().toLocaleTimeString()}] ${status.message}`;
            if (prev[prev.length - 1] !== msg) {
              return [...prev, msg];
            }
            return prev;
          });
        }

        // Map agent status to testing status
        if (status.status === 'complete') {
          setTestingStatus('complete');
          es.close();
        } else if (status.status === 'failed' || status.status === 'error') {
          setTestingStatus('failed');
          es.close();
        } else if (status.status === 'running' || status.status === 'iteration_complete') {
          setTestingStatus('running');
        }
      } catch {
        // Ignore parse errors
      }
    };

    es.onerror = () => {
      // Reconnect logic handled by EventSource
    };

    return () => {
      es.close();
    };
  }, [projectId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  // Start testing via agent
  const handleStartTesting = useCallback(async () => {
    setTestingStatus('running');
    setAgentLog([`[${new Date().toLocaleTimeString()}] Starting 4-layer verification pipeline...`]);
    setStatusMessage('Starting testing...');

    try {
      const response = await fetch('/api/agent/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'testing', projectId }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to start testing');
      }

      // Start polling for status
      startStatusPolling();
    } catch (err) {
      setTestingStatus('error');
      setStatusMessage(err instanceof Error ? err.message : 'Failed to start testing');
      setAgentLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] Error: ${err instanceof Error ? err.message : 'Unknown error'}`]);
    }
  }, [projectId, startStatusPolling]);

  // Stop testing
  const handleStopTesting = useCallback(async () => {
    try {
      await fetch('/api/agent/status', { method: 'DELETE' });
      setTestingStatus('idle');
      setStatusMessage('Testing stopped');
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    } catch {
      // Ignore
    }
  }, []);

  // Navigation
  const handleProceedToStage5 = useCallback(() => {
    setShowTransitionModal(true);
  }, []);

  const handleTransitionConfirm = useCallback(() => {
    if (activeProject) {
      updateProject(activeProject.id, { currentStage: 5 });
    }
    const params = projectId ? `?projectId=${projectId}` : '';
    router.push(`/stage5${params}`);
  }, [activeProject, updateProject, router, projectId]);

  const handleTransitionLater = useCallback(() => {
    setShowTransitionModal(false);
    router.push('/');
  }, [router]);

  const handleBackToStage3 = useCallback(() => {
    const params = projectId ? `?projectId=${projectId}` : '';
    router.push(`/stage3${params}`);
  }, [router, projectId]);

  const getStatusColor = () => {
    switch (testingStatus) {
      case 'complete': return 'text-green-600';
      case 'failed': case 'error': return 'text-red-600';
      case 'running': return 'text-neutral-600';
      default: return 'text-neutral-500';
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">
      <StageIndicator
        currentStage={4}
        completedStages={[1, 2, 3]}
        projectName={activeProject?.name || projectName}
        stageStatus={
          testingStatus === 'complete' ? 'Testing passed' :
          testingStatus === 'failed' ? 'Testing failed' :
          testingStatus === 'error' ? 'Error' :
          testingStatus === 'running' ? 'Testing...' :
          'Ready to test'
        }
      />

      {/* Main Content */}
      <div className="flex-1 overflow-hidden flex flex-col p-6">
        <div className="max-w-4xl mx-auto w-full flex-1 flex flex-col">
          <h2 className="text-lg font-semibold text-neutral-900 mb-1">4-Layer Verification Pipeline</h2>
          <p className="text-sm text-neutral-500 mb-4">
            Runs /botoolagent-testing: TypeCheck + Lint → Unit Tests → E2E → Code Review
          </p>

          {/* Status Bar */}
          <div className="flex items-center gap-3 mb-4 p-3 rounded-lg border border-neutral-200 bg-neutral-50">
            {testingStatus === 'running' && (
              <span className="w-4 h-4 border-2 border-neutral-500 border-t-transparent rounded-full animate-spin" />
            )}
            {testingStatus === 'complete' && (
              <span className="text-green-500 text-lg">✓</span>
            )}
            {(testingStatus === 'failed' || testingStatus === 'error') && (
              <span className="text-red-500 text-lg">✗</span>
            )}
            {testingStatus === 'idle' && (
              <span className="w-4 h-4 border-2 border-neutral-300 rounded-full" />
            )}
            <span className={`text-sm font-medium ${getStatusColor()}`}>
              {statusMessage || 'Click "Start Testing" to begin verification'}
            </span>
          </div>

          {/* Log Output */}
          <div className="flex-1 min-h-0 rounded-lg border border-neutral-200 bg-neutral-900 overflow-auto">
            <div className="p-4 font-mono text-xs text-neutral-300 space-y-1">
              {agentLog.length === 0 ? (
                <p className="text-neutral-500 italic">Waiting for testing to start...</p>
              ) : (
                agentLog.map((line, i) => (
                  <p key={i} className={
                    line.includes('Error') || line.includes('FAIL') ? 'text-red-400' :
                    line.includes('PASS') || line.includes('✓') ? 'text-green-400' :
                    line.includes('Running') || line.includes('Starting') ? 'text-neutral-400' :
                    'text-neutral-300'
                  }>
                    {line}
                  </p>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Action Bar */}
      <div className="border-t border-neutral-200 bg-white p-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            {testingStatus === 'idle' && (
              <button
                onClick={handleStartTesting}
                className="px-5 py-2.5 text-sm font-medium text-white bg-neutral-900 rounded-lg hover:bg-neutral-800 transition-colors"
              >
                Start Testing
              </button>
            )}
            {testingStatus === 'running' && (
              <button
                onClick={handleStopTesting}
                className="px-5 py-2.5 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
              >
                Stop
              </button>
            )}
            {(testingStatus === 'failed' || testingStatus === 'error') && (
              <>
                <button
                  onClick={handleBackToStage3}
                  className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
                >
                  Back to Stage 3
                </button>
                <button
                  onClick={() => { setTestingStatus('idle'); setAgentLog([]); }}
                  className="px-4 py-2 text-sm font-medium text-neutral-700 bg-neutral-100 border border-neutral-200 rounded-lg hover:bg-neutral-200 transition-colors"
                >
                  Retry
                </button>
              </>
            )}
          </div>

          <button
            onClick={handleProceedToStage5}
            disabled={testingStatus !== 'complete'}
            className={`px-6 py-2.5 rounded-lg font-medium text-sm transition-colors flex items-center gap-2 ${
              testingStatus === 'complete'
                ? 'bg-neutral-900 text-white hover:bg-neutral-800'
                : 'bg-neutral-100 text-neutral-400 cursor-not-allowed'
            }`}
          >
            Proceed to Finalize
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>

      {/* Stage Transition Modal */}
      <StageTransitionModal
        isOpen={showTransitionModal}
        fromStage={4}
        toStage={5}
        summary="Testing verification complete. Ready to create PR and merge."
        onConfirm={handleTransitionConfirm}
        onLater={handleTransitionLater}
        autoCountdown={3}
      />
    </div>
  );
}

function Stage4Fallback() {
  return (
    <div className="flex h-full items-center justify-center bg-neutral-50 text-sm text-neutral-500">
      加载中...
    </div>
  );
}

export default function Stage4Page() {
  return (
    <Suspense fallback={<Stage4Fallback />}>
      <Stage4PageContent />
    </Suspense>
  );
}
