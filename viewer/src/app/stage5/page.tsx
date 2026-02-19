'use client';

import { Suspense, useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { StageIndicator, StageTransitionModal } from '@/components';
import { TestingReportSummary } from '@/components/TestingReportSummary';
import { Badge } from '@/components/ui/badge';
import { useFileWatcher, parsePrdJson, useProjectValidation } from '@/hooks';
import { useProject } from '@/contexts/ProjectContext';
import { useRequirement } from '@/contexts/RequirementContext';
import { useTab } from '@/contexts/TabContext';
import { cn } from '@/lib/utils';

interface PRInfo {
  number: number;
  title: string;
  url: string;
  state: string;
  draft: boolean;
  mergeable: string | null;
  additions: number;
  deletions: number;
  reviewDecision: string | null;
}

interface MergeStatus {
  hasPR: boolean;
  canMerge: boolean;
  message: string;
  prNumber?: number;
  prUrl?: string;
}

type PageState = 'loading' | 'no_pr' | 'creating_pr' | 'ready' | 'merging' | 'merged' | 'error';

function Stage5PageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { activeProject, updateProject, setActiveProject } = useProject();

  // Requirement context - resolve `req` param
  const { requirements } = useRequirement();
  const reqId = searchParams.get('req') || undefined;
  const activeRequirement = reqId ? requirements.find(r => r.id === reqId) : undefined;

  // projectId: explicit param takes priority, then req.id as fallback
  const rawProjectId = searchParams.get('projectId') || undefined;
  const projectId = rawProjectId ?? (activeRequirement?.id);

  // Skip validation when navigated via RequirementContext (req param)
  useProjectValidation({ currentStage: 5, skipValidation: Boolean(reqId) });

  // Data states
  const [prInfo, setPrInfo] = useState<PRInfo | null>(null);
  const [mergeStatus, setMergeStatus] = useState<MergeStatus | null>(null);

  // Testing report verdict state (from child component callback)
  const [isAllPass, setIsAllPass] = useState<boolean | null>(null);

  // UI states
  const [pageState, setPageState] = useState<PageState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [showCompletionModal, setShowCompletionModal] = useState(false);

  // Sync page state to TabContext
  const { updateTabStatus } = useTab();
  useEffect(() => {
    if (!reqId) return;
    const statusMap: Record<string, string> = {
      loading: 'idle',
      no_pr: 'idle',
      creating_pr: 'running',
      ready: 'session_done',
      merging: 'running',
      merged: 'complete',
      error: 'error',
    };
    const mapped = statusMap[pageState] || 'idle';
    updateTabStatus(reqId, mapped);
  }, [reqId, pageState, updateTabStatus]);

  // Use file watcher for PRD
  const { prd } = useFileWatcher({
    projectId,
    enabled: true,
  });

  // Derive projectName from prd (avoids setState-in-effect lint error)
  const projectName = useMemo(() => {
    if (prd) {
      const parsed = parsePrdJson(prd);
      return parsed?.project || '';
    }
    return '';
  }, [prd]);

  // Fetch merge status
  const fetchMergeStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/git/merge');
      if (response.ok) {
        const data = await response.json();
        setMergeStatus(data);
      }
    } catch (err) {
      console.error('Failed to fetch merge status:', err);
    }
  }, []);

  // Check for existing PR on page load
  useEffect(() => {
    const checkExistingPR = async () => {
      try {
        const response = await fetch('/api/git/pr');
        if (response.ok) {
          const data = await response.json();
          if (data.hasPR && data.pr) {
            setPrInfo(data.pr);
            setPageState('ready');
            fetchMergeStatus();
            return;
          }
        }
        // No existing PR - user needs to create one
        setPageState('no_pr');
      } catch {
        setPageState('no_pr');
      }
    };

    checkExistingPR();
  }, [fetchMergeStatus]);

  // Create PR (user-initiated)
  const handleCreatePR = useCallback(async () => {
    try {
      setPageState('creating_pr');
      setError(null);

      const response = await fetch('/api/git/pr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.pr) {
          setPrInfo(data.pr);
          setPageState('ready');
          fetchMergeStatus();
        } else {
          setError(data.error || 'Failed to create PR');
          setPageState('error');
        }
      } else {
        const errorData = await response.json().catch(() => ({}));
        setError(errorData.error || 'Failed to create PR');
        setPageState('error');
      }
    } catch (err) {
      console.error('Failed to create PR:', err);
      setError('Network error');
      setPageState('error');
    }
  }, [projectId, fetchMergeStatus]);

  // Handle merge
  const handleMerge = useCallback(async () => {
    if (!prInfo) return;

    try {
      setPageState('merging');
      const response = await fetch('/api/git/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'merge', projectId }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setPageState('merged');
          if (activeProject) {
            updateProject(activeProject.id, { status: 'completed' });
          }
          setShowCompletionModal(true);
        } else {
          setError(data.error || 'Merge failed');
          setPageState('error');
        }
      } else {
        const errorData = await response.json().catch(() => ({}));
        setError(errorData.error || 'Merge failed');
        setPageState('error');
      }
    } catch (err) {
      console.error('Failed to merge:', err);
      setError('Network error');
      setPageState('error');
    }
  }, [prInfo, projectId, activeProject, updateProject]);

  // Completion handlers
  const handleCompletionConfirm = useCallback(() => {
    setActiveProject(null);
    router.push('/');
  }, [setActiveProject, router]);

  const handleCompletionLater = useCallback(() => {
    setShowCompletionModal(false);
  }, []);

  // Callback from TestingReportSummary
  const handleReportLoaded = useCallback((report: { verdict: string } | null) => {
    if (report) {
      setIsAllPass(report.verdict === 'all_pass');
    } else {
      setIsAllPass(null);
    }
  }, []);

  // Merge is allowed only when PR is ready, merge status allows it, AND testing passed
  const isMergeBlocked = isAllPass === false || isAllPass === null;
  const canMerge = pageState === 'ready' && mergeStatus?.canMerge && prInfo && !isMergeBlocked;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">
      <StageIndicator
        currentStage={5}
        completedStages={[1, 2, 3, 4]}
        projectName={activeProject?.name || projectName}
        stageStatus={
          pageState === 'merged' ? 'Merged' :
          pageState === 'merging' ? 'Merging...' :
          pageState === 'ready' ? 'PR Ready' :
          pageState === 'creating_pr' ? 'Creating PR...' :
          pageState === 'error' ? 'Error' :
          pageState === 'no_pr' ? 'No PR yet' :
          'Loading...'
        }
      />

      {/* Main Content — single centered panel */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-2xl mx-auto py-8 px-4 space-y-4">
          {/* Testing Report Summary */}
          <TestingReportSummary projectId={projectId} onReportLoaded={handleReportLoaded} />

          {/* PR Status Card */}
          <div className="bg-white border border-neutral-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-neutral-900 mb-3">Pull Request</h3>

            {pageState === 'loading' && (
              <div className="flex items-center gap-3">
                <span className="w-4 h-4 border-2 border-neutral-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-neutral-500">Checking PR status...</span>
              </div>
            )}

            {pageState === 'no_pr' && (
              <div className="space-y-3">
                <p className="text-sm text-neutral-600">No PR exists for this branch yet.</p>
                <button
                  onClick={handleCreatePR}
                  className="w-full px-4 py-2.5 text-sm font-medium text-white bg-neutral-900 rounded-lg hover:bg-neutral-800 transition-colors"
                >
                  Create Pull Request
                </button>
              </div>
            )}

            {pageState === 'creating_pr' && (
              <div className="flex items-center gap-3">
                <span className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-amber-700 font-medium">Creating PR...</span>
              </div>
            )}

            {pageState === 'error' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-red-500">{'\u2717'}</span>
                  <span className="text-sm text-red-700">{error}</span>
                </div>
                <button
                  onClick={handleCreatePR}
                  className="text-sm text-neutral-600 hover:underline"
                >
                  Retry
                </button>
              </div>
            )}

            {(pageState === 'ready' || pageState === 'merging') && prInfo && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-neutral-900">PR #{prInfo.number}</span>
                  <Badge
                    variant={
                      prInfo.state === 'OPEN' ? 'success' :
                      prInfo.state === 'MERGED' ? 'neutral' :
                      'neutral'
                    }
                  >
                    {prInfo.state}
                  </Badge>
                </div>
                <p className="text-sm text-neutral-600 truncate">{prInfo.title}</p>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-green-600 font-mono">+{prInfo.additions}</span>
                  <span className="text-red-600 font-mono">-{prInfo.deletions}</span>
                </div>
                {mergeStatus && (
                  <div className={cn('text-sm', mergeStatus.canMerge ? 'text-green-600' : 'text-amber-600')}>
                    {mergeStatus.message}
                  </div>
                )}
                <a
                  href={prInfo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-neutral-600 hover:underline"
                >
                  View on GitHub &rarr;
                </a>
              </div>
            )}

            {pageState === 'merged' && (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-neutral-200 flex items-center justify-center">
                  <span className="text-neutral-600">{'\u2713'}</span>
                </div>
                <div>
                  <p className="font-medium text-neutral-900">PR Merged!</p>
                  <p className="text-sm text-neutral-700">Code merged to main</p>
                </div>
              </div>
            )}
          </div>

          {/* Merge blocked warning */}
          {isMergeBlocked && pageState === 'ready' && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-sm text-amber-800">
                {isAllPass === false
                  ? 'Testing report has failures. All quality checks must pass before merging.'
                  : 'No testing report found. Run the testing pipeline before merging.'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Action Bar */}
      <div className="border-t border-neutral-200 bg-white p-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            {pageState === 'merged' ? (
              <div className="flex items-center gap-2 text-neutral-700">
                <span>{'\u2713'}</span>
                <span className="font-medium text-sm">Complete!</span>
              </div>
            ) : pageState === 'ready' ? (
              <div className="flex items-center gap-2 text-green-700">
                <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
                <span className="font-medium text-sm">PR Ready</span>
              </div>
            ) : null}
          </div>

          {pageState === 'merged' ? (
            <button
              onClick={handleCompletionConfirm}
              className="px-6 py-2.5 rounded-lg font-medium text-sm bg-neutral-900 text-white hover:bg-neutral-800 transition-colors"
            >
              Return to Dashboard
            </button>
          ) : (
            <button
              onClick={handleMerge}
              disabled={!canMerge}
              className={cn(
                'px-6 py-2.5 rounded-lg font-medium text-sm transition-colors flex items-center gap-2',
                canMerge
                  ? 'bg-neutral-900 text-white hover:bg-neutral-800'
                  : 'bg-neutral-100 text-neutral-400 cursor-not-allowed'
              )}
            >
              {pageState === 'merging' ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Merging...
                </>
              ) : (
                'Merge to main'
              )}
            </button>
          )}
        </div>
      </div>

      {/* Completion Modal */}
      <StageTransitionModal
        isOpen={showCompletionModal}
        fromStage={5}
        toStage={0}
        summary={`Project "${projectName || activeProject?.name || 'Unnamed'}" completed! Code merged to main.`}
        onConfirm={handleCompletionConfirm}
        onLater={handleCompletionLater}
      />
    </div>
  );
}

function Stage5Fallback() {
  return (
    <div className="flex h-full items-center justify-center bg-neutral-50 text-sm text-neutral-500">
      Loading...
    </div>
  );
}

export default function Stage5Page() {
  return (
    <Suspense fallback={<Stage5Fallback />}>
      <Stage5PageContent />
    </Suspense>
  );
}
