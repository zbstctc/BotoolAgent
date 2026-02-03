'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { StageIndicator, ChangeSummary, CompletionSummary, StageTransitionModal } from '@/components';
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
  canMerge: boolean;
  message: string;
  reviewDecision: string | null;
  mergeStateStatus: string | null;
}

type PageState = 'loading' | 'creating_pr' | 'ready' | 'merging' | 'merged' | 'error';

export default function Stage5Page() {
  const router = useRouter();
  const { activeProject, updateProject, setActiveProject } = useProject();

  // Project validation
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

  // Completion modal state
  const [showCompletionModal, setShowCompletionModal] = useState(false);

  // Use file watcher for PRD and progress
  const { prd, progress } = useFileWatcher({
    enabled: true,
    onPrdUpdate: (content) => {
      const parsed = parsePrdJson(content);
      if (parsed) {
        setProjectName(parsed.project || '');
      }
    },
    onProgressUpdate: (content) => {
      setProgressContent(content);
      setIsLoadingProgress(false);
    },
  });

  // Initial parse of PRD
  useEffect(() => {
    if (prd) {
      const parsed = parsePrdJson(prd);
      if (parsed) {
        setProjectName(parsed.project || '');
      }
    }
  }, [prd]);

  // Initial parse of progress
  useEffect(() => {
    if (progress !== undefined) {
      setProgressContent(progress);
      setIsLoadingProgress(false);
    }
  }, [progress]);

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

  // Check for existing PR or create one
  useEffect(() => {
    const initializePR = async () => {
      try {
        // First check if PR already exists
        const checkResponse = await fetch('/api/git/pr');
        if (checkResponse.ok) {
          const checkData = await checkResponse.json();
          if (checkData.hasPR && checkData.pr) {
            setPrInfo(checkData.pr);
            setPageState('ready');
            // Fetch merge status
            fetchMergeStatus();
            return;
          }
        }

        // No existing PR, create one
        setPageState('creating_pr');
        const createResponse = await fetch('/api/git/pr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });

        if (createResponse.ok) {
          const createData = await createResponse.json();
          if (createData.pr) {
            setPrInfo(createData.pr);
            setPageState('ready');
            // Fetch merge status
            fetchMergeStatus();
          } else {
            setError(createData.error || '创建 PR 失败');
            setPageState('error');
          }
        } else {
          const errorData = await createResponse.json();
          setError(errorData.error || '创建 PR 失败');
          setPageState('error');
        }
      } catch (err) {
        console.error('Failed to initialize PR:', err);
        setError('网络错误，无法创建 PR');
        setPageState('error');
      }
    };

    if (!isLoadingDiff && !isLoadingProgress) {
      initializePR();
    }
  }, [isLoadingDiff, isLoadingProgress]);

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

  // Handle merge
  const handleMerge = useCallback(async () => {
    if (!prInfo) return;

    try {
      setPageState('merging');
      const response = await fetch('/api/git/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'squash' }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setPageState('merged');
          // Update project status to completed and show completion modal
          if (activeProject) {
            updateProject(activeProject.id, { status: 'completed' });
          }
          setShowCompletionModal(true);
        } else {
          setError(data.error || '合并失败');
          setPageState('error');
        }
      } else {
        const errorData = await response.json();
        setError(errorData.error || '合并失败');
        setPageState('error');
      }
    } catch (err) {
      console.error('Failed to merge:', err);
      setError('网络错误，合并失败');
      setPageState('error');
    }
  }, [prInfo, activeProject, updateProject]);

  // Retry creating PR
  const handleRetry = useCallback(async () => {
    setError(null);
    setPageState('loading');
    // Re-trigger the PR initialization
    const initializePR = async () => {
      try {
        setPageState('creating_pr');
        const createResponse = await fetch('/api/git/pr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });

        if (createResponse.ok) {
          const createData = await createResponse.json();
          if (createData.pr) {
            setPrInfo(createData.pr);
            setPageState('ready');
            fetchMergeStatus();
          } else {
            setError(createData.error || '创建 PR 失败');
            setPageState('error');
          }
        } else {
          const errorData = await createResponse.json();
          setError(errorData.error || '创建 PR 失败');
          setPageState('error');
        }
      } catch (err) {
        console.error('Failed to create PR:', err);
        setError('网络错误，无法创建 PR');
        setPageState('error');
      }
    };
    initializePR();
  }, [fetchMergeStatus]);

  // Handle completion modal confirm - return to dashboard
  const handleCompletionConfirm = useCallback(() => {
    // Clear active project since it's completed
    setActiveProject(null);
    router.push('/');
  }, [setActiveProject, router]);

  // Handle completion modal later - stay on page
  const handleCompletionLater = useCallback(() => {
    setShowCompletionModal(false);
  }, []);

  // Determine if merge button should be enabled
  const canMerge = pageState === 'ready' && mergeStatus?.canMerge && prInfo;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">
      {/* Stage Indicator */}
      <StageIndicator currentStage={5} completedStages={[1, 2, 3, 4]} />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel: Code Changes */}
        <div className="flex-1 border-r border-neutral-200 flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-neutral-200 bg-white">
            <h2 className="text-lg font-semibold text-neutral-900">
              <span className="mr-2">📝</span>
              代码变更
            </h2>
            <p className="text-sm text-neutral-500 mt-1">
              查看本次开发的所有代码修改
            </p>
          </div>

          {/* Diff Content */}
          <div className="flex-1 overflow-auto p-4 bg-neutral-50">
            <ChangeSummary
              diffSummary={diffSummary}
              isLoading={isLoadingDiff}
            />
          </div>
        </div>

        {/* Right Panel: Completion Summary & PR Info */}
        <div className="w-[420px] flex-shrink-0 flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-neutral-200 bg-white">
            <h2 className="text-lg font-semibold text-neutral-900">
              <span className="mr-2">🎉</span>
              完成总结
            </h2>
            <p className="text-sm text-neutral-500 mt-1">
              开发任务完成情况与 PR 信息
            </p>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-auto p-4 bg-neutral-50 space-y-4">
            {/* PR Status Card */}
            <PRStatusCard
              pageState={pageState}
              prInfo={prInfo}
              mergeStatus={mergeStatus}
              error={error}
              onRetry={handleRetry}
            />

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
          {/* Status Summary */}
          <div className="flex items-center gap-6">
            {/* PR Status */}
            <div className="flex items-center gap-2">
              {pageState === 'merged' ? (
                <>
                  <span className="w-3 h-3 rounded-full bg-purple-500" />
                  <span className="text-sm text-purple-700 font-medium">已合并</span>
                </>
              ) : pageState === 'ready' ? (
                <>
                  <span className="w-3 h-3 rounded-full bg-green-500" />
                  <span className="text-sm text-green-700 font-medium">PR 就绪</span>
                </>
              ) : pageState === 'creating_pr' || pageState === 'loading' ? (
                <>
                  <span className="w-3 h-3 rounded-full bg-amber-500 animate-pulse" />
                  <span className="text-sm text-amber-700 font-medium">准备中...</span>
                </>
              ) : pageState === 'merging' ? (
                <>
                  <span className="w-3 h-3 rounded-full bg-blue-500 animate-pulse" />
                  <span className="text-sm text-blue-700 font-medium">合并中...</span>
                </>
              ) : (
                <>
                  <span className="w-3 h-3 rounded-full bg-red-500" />
                  <span className="text-sm text-red-700 font-medium">出错</span>
                </>
              )}
            </div>

            {/* Merge Status */}
            {mergeStatus && pageState !== 'merged' && (
              <div className="flex items-center gap-2">
                {mergeStatus.canMerge ? (
                  <>
                    <span className="w-3 h-3 rounded-full bg-green-500" />
                    <span className="text-sm text-green-700 font-medium">可合并</span>
                  </>
                ) : (
                  <>
                    <span className="w-3 h-3 rounded-full bg-amber-500" />
                    <span className="text-sm text-amber-700 font-medium">{mergeStatus.message}</span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Action Button */}
          {pageState === 'merged' ? (
            <div className="flex items-center gap-3 px-6 py-2.5 rounded-lg bg-purple-50 text-purple-700">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="font-medium">开发完成！</span>
            </div>
          ) : (
            <button
              onClick={handleMerge}
              disabled={!canMerge}
              className={`px-6 py-2.5 rounded-lg font-medium text-sm transition-colors flex items-center gap-2 ${
                canMerge
                  ? 'bg-purple-600 text-white hover:bg-purple-700'
                  : 'bg-neutral-100 text-neutral-400 cursor-not-allowed'
              }`}
            >
              {pageState === 'merging' ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  合并中...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                  </svg>
                  合并到 main
                </>
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
        summary={`项目 "${projectName || activeProject?.name || '未命名项目'}" 已成功完成！代码已合并到 main 分支。`}
        onConfirm={handleCompletionConfirm}
        onLater={handleCompletionLater}
      />
    </div>
  );
}

// PR Status Card Component
function PRStatusCard({
  pageState,
  prInfo,
  mergeStatus,
  error,
  onRetry,
}: {
  pageState: PageState;
  prInfo: PRInfo | null;
  mergeStatus: MergeStatus | null;
  error: string | null;
  onRetry: () => void;
}) {
  // Loading state
  if (pageState === 'loading' || pageState === 'creating_pr') {
    return (
      <div className="bg-white border border-neutral-200 rounded-lg p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-amber-600 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-neutral-900">
              {pageState === 'creating_pr' ? '正在创建 PR...' : '加载中...'}
            </p>
            <p className="text-sm text-neutral-500">请稍候</p>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (pageState === 'error') {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-red-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-red-900">PR 创建失败</p>
            <p className="text-sm text-red-700 mt-1">{error}</p>
            <button
              onClick={onRetry}
              className="mt-3 text-sm text-red-700 font-medium hover:text-red-800 underline"
            >
              重试
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Merged state
  if (pageState === 'merged') {
    return (
      <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-purple-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-purple-900">PR 已合并！</p>
            <p className="text-sm text-purple-700">代码已成功合并到 main 分支</p>
          </div>
        </div>
      </div>
    );
  }

  // Merging state
  if (pageState === 'merging') {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-blue-600 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-blue-900">正在合并...</p>
            <p className="text-sm text-blue-700">请稍候，正在合并代码到 main 分支</p>
          </div>
        </div>
      </div>
    );
  }

  // Ready state with PR info
  if (prInfo) {
    return (
      <div className="bg-white border border-neutral-200 rounded-lg p-4 space-y-3">
        {/* PR Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
              <svg className="w-5 h-5 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-neutral-900">Pull Request #{prInfo.number}</p>
              <p className="text-sm text-neutral-500 truncate max-w-[250px]" title={prInfo.title}>
                {prInfo.title}
              </p>
            </div>
          </div>

          {/* PR State Badge */}
          <span className={`px-2 py-1 rounded text-xs font-medium ${
            prInfo.state === 'OPEN'
              ? 'bg-green-100 text-green-700'
              : prInfo.state === 'MERGED'
                ? 'bg-purple-100 text-purple-700'
                : 'bg-neutral-100 text-neutral-700'
          }`}>
            {prInfo.state === 'OPEN' ? '开放' : prInfo.state === 'MERGED' ? '已合并' : prInfo.state}
          </span>
        </div>

        {/* PR Stats */}
        <div className="flex items-center gap-4 text-sm">
          <span className="text-green-600 font-mono">+{prInfo.additions}</span>
          <span className="text-red-600 font-mono">-{prInfo.deletions}</span>
          {prInfo.draft && (
            <span className="text-amber-600">草稿</span>
          )}
        </div>

        {/* Merge Status */}
        {mergeStatus && (
          <div className={`flex items-center gap-2 text-sm ${
            mergeStatus.canMerge ? 'text-green-600' : 'text-amber-600'
          }`}>
            {mergeStatus.canMerge ? (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            )}
            <span>{mergeStatus.message}</span>
          </div>
        )}

        {/* PR Link */}
        <a
          href={prInfo.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 hover:underline"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          在 GitHub 上查看
        </a>
      </div>
    );
  }

  return null;
}
