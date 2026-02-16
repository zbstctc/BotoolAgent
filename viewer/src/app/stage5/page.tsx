'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { StageIndicator, ChangeSummary, CompletionSummary, StageTransitionModal, ReviewSummary } from '@/components';
import { useFileWatcher, parsePrdJson, useProjectValidation } from '@/hooks';
import { useProject } from '@/contexts/ProjectContext';
import type { DiffSummary } from '@/components/ChangeSummary';

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
  const projectId = searchParams.get('projectId') || undefined;
  const { activeProject, updateProject, setActiveProject } = useProject();

  useProjectValidation({ currentStage: 5 });

  // Data states
  const [diffSummary, setDiffSummary] = useState<DiffSummary | null>(null);
  const [progressContent, setProgressContent] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string>('');
  const [prInfo, setPrInfo] = useState<PRInfo | null>(null);
  const [mergeStatus, setMergeStatus] = useState<MergeStatus | null>(null);

  // UI states
  const [pageState, setPageState] = useState<PageState>('loading');
  const [isLoadingDiff, setIsLoadingDiff] = useState(true);
  const [isLoadingProgress, setIsLoadingProgress] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCompletionModal, setShowCompletionModal] = useState(false);

  // Use file watcher for PRD and progress
  const { prd, progress } = useFileWatcher({
    projectId,
    enabled: true,
    onPrdUpdate: (content) => {
      const parsed = parsePrdJson(content);
      if (parsed) setProjectName(parsed.project || '');
    },
    onProgressUpdate: (content) => {
      setProgressContent(content);
      setIsLoadingProgress(false);
    },
  });

  useEffect(() => {
    if (prd) {
      const parsed = parsePrdJson(prd);
      if (parsed) setProjectName(parsed.project || '');
    }
  }, [prd]);

  useEffect(() => {
    if (progress !== undefined) {
      setProgressContent(progress);
      setIsLoadingProgress(false);
    }
  }, [progress]);

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

  // Fetch diff summary
  useEffect(() => {
    const fetchDiff = async () => {
      try {
        setIsLoadingDiff(true);
        const response = await fetch('/api/git/diff');
        if (response.ok) {
          const data = await response.json();
          setDiffSummary(data);
        }
      } catch (err) {
        console.error('Failed to fetch diff:', err);
      } finally {
        setIsLoadingDiff(false);
      }
    };
    fetchDiff();
  }, []);

  // Check for existing PR on page load (but don't auto-create)
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

    if (!isLoadingDiff && !isLoadingProgress) {
      checkExistingPR();
    }
  }, [isLoadingDiff, isLoadingProgress, fetchMergeStatus]);

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

  const canMerge = pageState === 'ready' && mergeStatus?.canMerge && prInfo;

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

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel: Code Changes */}
        <div className="flex-1 border-r border-neutral-200 flex flex-col">
          <div className="p-4 border-b border-neutral-200 bg-white">
            <h2 className="text-lg font-semibold text-neutral-900">Code Changes</h2>
            <p className="text-sm text-neutral-500 mt-1">All modifications from this development cycle</p>
          </div>
          <div className="flex-1 overflow-auto p-4 bg-neutral-50">
            <ChangeSummary diffSummary={diffSummary} isLoading={isLoadingDiff} />
          </div>
        </div>

        {/* Right Panel */}
        <div className="w-[420px] flex-shrink-0 flex flex-col">
          <div className="p-4 border-b border-neutral-200 bg-white">
            <h2 className="text-lg font-semibold text-neutral-900">Summary & PR</h2>
            <p className="text-sm text-neutral-500 mt-1">Review summary and manage PR</p>
          </div>

          <div className="flex-1 overflow-auto p-4 bg-neutral-50 space-y-4">
            {/* Review Summary */}
            <ReviewSummary projectId={projectId} defaultExpanded />

            {/* PR Status */}
            <div className="bg-white border border-neutral-200 rounded-lg p-4">
              {pageState === 'loading' && (
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-neutral-100 flex items-center justify-center">
                    <span className="w-4 h-4 border-2 border-neutral-400 border-t-transparent rounded-full animate-spin" />
                  </div>
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
                  <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center">
                    <span className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                  <span className="text-sm text-amber-700 font-medium">Creating PR...</span>
                </div>
              )}

              {pageState === 'error' && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-red-500">✗</span>
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
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      prInfo.state === 'OPEN' ? 'bg-green-100 text-green-700' :
                      prInfo.state === 'MERGED' ? 'bg-neutral-200 text-neutral-700' :
                      'bg-neutral-100 text-neutral-700'
                    }`}>
                      {prInfo.state}
                    </span>
                  </div>
                  <p className="text-sm text-neutral-600 truncate">{prInfo.title}</p>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-green-600 font-mono">+{prInfo.additions}</span>
                    <span className="text-red-600 font-mono">-{prInfo.deletions}</span>
                  </div>
                  {mergeStatus && (
                    <div className={`text-sm ${mergeStatus.canMerge ? 'text-green-600' : 'text-amber-600'}`}>
                      {mergeStatus.message}
                    </div>
                  )}
                  <a
                    href={prInfo.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-neutral-600 hover:underline"
                  >
                    View on GitHub →
                  </a>
                </div>
              )}

              {pageState === 'merged' && (
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-neutral-200 flex items-center justify-center">
                    <span className="text-neutral-600">✓</span>
                  </div>
                  <div>
                    <p className="font-medium text-neutral-900">PR Merged!</p>
                    <p className="text-sm text-neutral-700">Code merged to main</p>
                  </div>
                </div>
              )}
            </div>

            {/* Completion Summary */}
            <CompletionSummary
              progressContent={progressContent}
              isLoading={isLoadingProgress}
              projectName={projectName}
            />
          </div>
        </div>
      </div>

      {/* Bottom Action Bar */}
      <div className="border-t border-neutral-200 bg-white p-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            {pageState === 'merged' ? (
              <div className="flex items-center gap-2 text-neutral-700">
                <span>✓</span>
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
              className={`px-6 py-2.5 rounded-lg font-medium text-sm transition-colors flex items-center gap-2 ${
                canMerge
                  ? 'bg-neutral-900 text-white hover:bg-neutral-800'
                  : 'bg-neutral-100 text-neutral-400 cursor-not-allowed'
              }`}
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
      加载中...
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
