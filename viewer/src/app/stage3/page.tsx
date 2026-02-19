'use client';

import { Suspense, useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { StageIndicator, StageTransitionModal } from '@/components';
import { useFileWatcher, parsePrdJson, useProjectValidation, useTeammates, useTaskTimings, useAgentLogs } from '@/hooks';
import type { DevTask, PrdData } from '@/hooks';
import { FlowChart, type AgentPhase } from '@/components/FlowChart';
import { useProject } from '@/contexts/ProjectContext';
import { useRequirement } from '@/contexts/RequirementContext';
import { useTab } from '@/contexts/TabContext';
import { useAgentStatus } from '@/hooks/useAgentStatus';
import AgentDataPanel from '@/components/AgentDataPanel/AgentDataPanel';
import type { GitStats } from '@/components/AgentDataPanel/AgentDataPanel';
import { ProgressStrip } from '@/components/ProgressStrip';
import BatchPanel from '@/components/BatchPanel';
import BatchTimeline from '@/components/BatchTimeline';
import { AgentActivityFeed } from '@/components/AgentActivityFeed';

type TaskStatus = 'pending' | 'in-progress' | 'completed' | 'failed';
type RightPanelTab = 'changes' | 'commits' | 'flowchart' | 'activity';

interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
}

interface GitChangesData {
  branch: string;
  changes: FileChange[];
  totals: {
    files: number;
    additions: number;
    deletions: number;
  };
}

interface Commit {
  hash: string;
  shortHash: string;
  message: string;
  date: string;
  author: string;
  taskId: string | null;
}

interface GitCommitsData {
  branch: string;
  commits: Commit[];
  count: number;
}

function getTaskStatus(task: DevTask, currentTaskId: string | null): TaskStatus {
  if (task.passes) return 'completed';
  if (task.id === currentTaskId) return 'in-progress';
  return 'pending';
}

function getStatusColor(status: TaskStatus): string {
  switch (status) {
    case 'completed':
      return 'bg-green-100 text-green-700 border-green-200';
    case 'in-progress':
      return 'bg-neutral-200 text-neutral-700 border-neutral-300';
    case 'failed':
      return 'bg-red-100 text-red-700 border-red-200';
    default:
      return 'bg-neutral-100 text-neutral-600 border-neutral-200';
  }
}

function getStatusLabel(status: TaskStatus): string {
  switch (status) {
    case 'completed':
      return '已完成';
    case 'in-progress':
      return '执行中';
    case 'failed':
      return '失败';
    default:
      return '等待中';
  }
}

function Stage3PageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Requirement context - resolve `req` param
  const { requirements } = useRequirement();
  const reqId = searchParams.get('req') || undefined;
  const activeRequirement = reqId ? requirements.find(r => r.id === reqId) : undefined;

  // projectId: explicit param takes priority, then req.id as fallback
  const rawProjectId = searchParams.get('projectId') || undefined;
  const projectId = rawProjectId ?? (activeRequirement?.id);

  // Project context
  const { activeProject, updateProject } = useProject();

  // Project validation — skip when navigated via RequirementContext (req param)
  useProjectValidation({ currentStage: 3, skipValidation: Boolean(reqId) });

  // Agent status via SSE
  const agentStatus = useAgentStatus({ stream: true, projectId });

  // Agent logs polling (activity feed)
  const agentLogs = useAgentLogs({ projectId: projectId ?? '', enabled: agentStatus.isRunning });

  // Sync agent status to TabContext
  const { updateTabStatus } = useTab();
  useEffect(() => {
    if (!reqId || !agentStatus.status) return;
    updateTabStatus(
      reqId,
      agentStatus.status.status,
      agentStatus.status.total > 0
        ? { completed: agentStatus.status.completed, total: agentStatus.status.total }
        : undefined
    );
  }, [reqId, agentStatus.status?.status, agentStatus.status?.completed, agentStatus.status?.total, updateTabStatus]);

  const [prdData, setPrdData] = useState<PrdData | null>(null);
  const [progressLog, setProgressLog] = useState<string>('');
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<RightPanelTab>('changes');
  // Ref to ensure auto-switch to activity tab only fires once per agent run
  const hasAutoSwitchedRef = useRef(false);
  const [gitChanges, setGitChanges] = useState<GitChangesData | null>(null);
  const [gitChangesLoading, setGitChangesLoading] = useState(false);
  const [gitCommits, setGitCommits] = useState<GitCommitsData | null>(null);
  const [gitCommitsLoading, setGitCommitsLoading] = useState(false);
  // Stage transition modal state
  const [showTransitionModal, setShowTransitionModal] = useState(false);
  // Track if we've already shown the modal for this completion
  const [hasShownCompletionModal, setHasShownCompletionModal] = useState(false);

  // Agent control state
  const [maxIterations, setMaxIterations] = useState(10);
  // BotoolAgent uses tmux + Agent Teams mode (BotoolAgent.sh)
  const agentMode = 'teams' as const;
  const [showIterationInput, setShowIterationInput] = useState(false);
  const [agentActionLoading, setAgentActionLoading] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);

  // Agent start error state
  const [agentStartError, setAgentStartError] = useState<string | null>(null);

  // Handle start agent
  const handleStartAgent = useCallback(async () => {
    setAgentActionLoading(true);
    setAgentStartError(null);
    agentLogs.reset();
    try {
      await agentStatus.startAgent(maxIterations, agentMode);
      setShowIterationInput(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '启动失败';
      setAgentStartError(msg);
      // Refresh status in case agent is actually running
      agentStatus.refresh();
    } finally {
      setAgentActionLoading(false);
    }
  }, [agentStatus, maxIterations, agentMode, agentLogs]);

  // Handle stop agent (with confirmation)
  const handleStopAgent = useCallback(async () => {
    setAgentActionLoading(true);
    try {
      await agentStatus.stopAgent();
    } catch {
      // Error is handled inside useAgentStatus
    } finally {
      setAgentActionLoading(false);
      setShowStopConfirm(false);
    }
  }, [agentStatus]);

  // Track agent start time for ProgressStrip and useTaskTimings
  const agentStartTimeRef = useRef<number>(0);
  useEffect(() => {
    if (agentStatus.isRunning && agentStartTimeRef.current === 0) {
      agentStartTimeRef.current = Date.now();
    }
    if (!agentStatus.isRunning && !agentStatus.isComplete) {
      agentStartTimeRef.current = 0;
    }
  }, [agentStatus.isRunning, agentStatus.isComplete]);

  // Use file watcher to get real-time updates
  const { prd, progress, teammates: teammatesFile, isConnected, lastUpdated } = useFileWatcher({
    projectId,
    enabled: true,
    onPrdUpdate: (content) => {
      const parsed = parsePrdJson(content);
      if (parsed) {
        setPrdData(parsed);
        // Find current task (first task with passes: false)
        const currentTask = parsed.devTasks.find((t) => !t.passes);
        setCurrentTaskId(currentTask?.id || null);
      }
    },
    onProgressUpdate: (content) => {
      if (content) {
        setProgressLog(content);
      }
    },
  });

  // Initial parse of prd data
  useEffect(() => {
    if (prd) {
      const parsed = parsePrdJson(prd);
      if (parsed) {
        setPrdData(parsed);
        const currentTask = parsed.devTasks.find((t) => !t.passes);
        setCurrentTaskId(currentTask?.id || null);
      }
    }
  }, [prd]);

  // Initial parse of progress
  useEffect(() => {
    if (progress) {
      setProgressLog(progress);
    }
  }, [progress]);

  // Teammate state from file or inferred from PRD
  const teammatesData = useTeammates(teammatesFile, prdData, agentStatus.status);

  // Task timings for BatchPanel + BatchTimeline
  const agentStartIso = agentStartTimeRef.current > 0
    ? new Date(agentStartTimeRef.current).toISOString()
    : undefined;
  const taskTimings = useTaskTimings(
    progressLog,
    teammatesData,
    currentTaskId,
    agentStartIso,
    projectId ?? undefined,
  );

  // Auto-expand current task when currentTaskId changes
  useEffect(() => {
    if (currentTaskId) {
      setExpandedTaskId(currentTaskId);
    }
  }, [currentTaskId]);

  // Auto-switch to activity tab once when agent starts with no file changes.
  // Uses a ref guard so the user can manually switch tabs without being bounced back.
  useEffect(() => {
    if (!agentStatus.isRunning) {
      hasAutoSwitchedRef.current = false;
      return;
    }
    if (!hasAutoSwitchedRef.current && (!gitChanges || gitChanges.changes.length === 0)) {
      hasAutoSwitchedRef.current = true;
      setActiveTab('activity');
    }
  }, [agentStatus.isRunning, gitChanges]);

  // Fetch git changes
  const fetchGitChanges = useCallback(async () => {
    setGitChangesLoading(true);
    try {
      const response = await fetch('/api/git/changes');
      if (response.ok) {
        const data = await response.json();
        setGitChanges(data);
      }
    } catch (error) {
      console.error('Failed to fetch git changes:', error);
    } finally {
      setGitChangesLoading(false);
    }
  }, []);

  // Fetch git changes on mount
  useEffect(() => {
    if (!gitChanges) {
      fetchGitChanges();
    }
  }, [gitChanges, fetchGitChanges]);

  // Refresh git changes periodically only while agent is running
  useEffect(() => {
    if (!agentStatus.isRunning) return;
    const interval = setInterval(fetchGitChanges, 10000);
    return () => clearInterval(interval);
  }, [agentStatus.isRunning, fetchGitChanges]);

  // Fetch git commits
  const fetchGitCommits = useCallback(async () => {
    setGitCommitsLoading(true);
    try {
      const response = await fetch('/api/git/commits');
      if (response.ok) {
        const data = await response.json();
        setGitCommits(data);
      }
    } catch (error) {
      console.error('Failed to fetch git commits:', error);
    } finally {
      setGitCommitsLoading(false);
    }
  }, []);

  // Fetch commits on mount
  useEffect(() => {
    if (!gitCommits) {
      fetchGitCommits();
    }
  }, [gitCommits, fetchGitCommits]);

  // Refresh commits periodically only while agent is running
  useEffect(() => {
    if (!agentStatus.isRunning) return;
    const interval = setInterval(fetchGitCommits, 10000);
    return () => clearInterval(interval);
  }, [agentStatus.isRunning, fetchGitCommits]);

  // Task statistics
  const completedTasks = prdData?.devTasks.filter((t) => t.passes).length || 0;
  const inProgressTasks = currentTaskId ? 1 : 0;
  const pendingTasks = (prdData?.devTasks.length || 0) - completedTasks - inProgressTasks;
  const totalTasks = prdData?.devTasks.length || 0;
  const progressPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // Extract iteration count from progress log
  // Each iteration entry starts with "## YYYY-MM-DD - DT-XXX"
  const iterationCount = progressLog
    ? (progressLog.match(/^## \d{4}-\d{2}-\d{2} - DT-\d+/gm) || []).length
    : 0;

  // Determine agent phase for FlowChart highlighting
  // Prefer agentStatus from SSE; fall back to PRD-derived phase
  const agentPhase: AgentPhase = agentStatus.isComplete
    ? 'done'
    : agentStatus.isRunning
    ? 'running'
    : !prdData
    ? 'idle'
    : completedTasks === totalTasks && totalTasks > 0
    ? 'done'
    : 'idle';

  // Compute git stats for AgentDataPanel
  const gitStatsData: GitStats | undefined = gitChanges || gitCommits
    ? {
        additions: gitChanges?.totals.additions ?? 0,
        deletions: gitChanges?.totals.deletions ?? 0,
        files: gitChanges?.totals.files ?? 0,
        commits: gitCommits?.count ?? 0,
      }
    : undefined;

  // ETA: avg time * remaining tasks
  const remainingTasks = totalTasks - completedTasks;
  const etaSeconds = taskTimings.avgTime > 0 && remainingTasks > 0
    ? taskTimings.avgTime * remainingTasks
    : 0;

  // All tasks completed check
  const allTasksCompleted = totalTasks > 0 && completedTasks === totalTasks;

  // Show transition modal when all tasks are completed
  useEffect(() => {
    if (allTasksCompleted && !hasShownCompletionModal && !showTransitionModal) {
      setShowTransitionModal(true);
      setHasShownCompletionModal(true);
    }
  }, [allTasksCompleted, hasShownCompletionModal, showTransitionModal]);

  // Handle transition modal confirm (continue to Stage 4)
  const handleTransitionConfirm = useCallback(() => {
    // Update project stage
    if (activeProject) {
      updateProject(activeProject.id, { currentStage: 4 });
    }
    // Navigate to Stage 4, preserving req param
    const params = reqId ? `?req=${reqId}` : '';
    router.push(`/stage4${params}`);
  }, [router, activeProject, updateProject, reqId]);

  // Handle transition modal later (go back to Dashboard)
  const handleTransitionLater = useCallback(() => {
    setShowTransitionModal(false);
    router.push('/');
  }, [router]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">
      {/* Stage Indicator + Agent Control */}
      <div className="flex items-center">
        <div className="flex-1">
          <StageIndicator
            currentStage={3}
            completedStages={[1, 2]}
            projectName={activeProject?.name}
            stageStatus={
              totalTasks > 0
                ? `${completedTasks}/${totalTasks} 完成`
                : undefined
            }
          />
        </div>
        <div className="flex items-center gap-2 px-4 flex-shrink-0">
          {agentStatus.isRunning ? (
            <Fragment>
              {showStopConfirm ? (
                <div className="flex items-center gap-2 bg-white border border-red-200 rounded-lg px-3 py-1.5 shadow-sm">
                  <span className="text-xs text-red-600">确认停止代理？</span>
                  <button
                    onClick={handleStopAgent}
                    disabled={agentActionLoading}
                    className="px-2 py-0.5 text-xs font-medium bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50"
                  >
                    {agentActionLoading ? '停止中...' : '确认'}
                  </button>
                  <button
                    onClick={() => setShowStopConfirm(false)}
                    className="px-2 py-0.5 text-xs text-neutral-500 hover:text-neutral-700"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowStopConfirm(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
                >
                  <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                  停止代理
                </button>
              )}
            </Fragment>
          ) : (
            <Fragment>
              {showIterationInput ? (
                <div className="flex items-center gap-2 bg-white border border-neutral-200 rounded-lg px-3 py-1.5 shadow-sm">
                  <span className="text-xs text-neutral-500">最大轮次</span>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={maxIterations}
                    onChange={(e) => {
                      const parsed = Number.parseInt(e.target.value, 10);
                      if (Number.isNaN(parsed)) {
                        setMaxIterations(1);
                        return;
                      }
                      setMaxIterations(Math.max(1, Math.min(50, parsed)));
                    }}
                    className="w-14 rounded border border-neutral-300 px-1.5 py-0.5 text-xs text-neutral-700"
                  />
                  <button
                    onClick={handleStartAgent}
                    disabled={agentActionLoading}
                    className="px-2 py-0.5 text-xs font-medium bg-neutral-900 text-white rounded hover:bg-neutral-800 disabled:opacity-50"
                  >
                    {agentActionLoading ? '启动中...' : '启动'}
                  </button>
                  <button
                    onClick={() => setShowIterationInput(false)}
                    className="px-2 py-0.5 text-xs text-neutral-500 hover:text-neutral-700"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                {agentStartError && (
                  <span className="text-xs text-red-500 max-w-[200px] truncate">{agentStartError}</span>
                )}
                <button
                  onClick={() => { setShowIterationInput(true); setAgentStartError(null); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-neutral-100 text-neutral-700 border border-neutral-200 rounded-lg hover:bg-neutral-200 transition-colors"
                >
                  <span>▶</span>
                  启动代理
                </button>
              </div>
              )}
            </Fragment>
          )}
        </div>
      </div>

      {/* Stage Transition Modal */}
      <StageTransitionModal
        isOpen={showTransitionModal}
        fromStage={3}
        toStage={4}
        summary={`全部 ${totalTasks} 个开发任务已完成，准备进入质量验证阶段。`}
        onConfirm={handleTransitionConfirm}
        onLater={handleTransitionLater}
        autoCountdown={3}
      />

      {/* Main Content - Three Column Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Dev Tasks Status (240px) */}
        <div className="w-[240px] flex-shrink-0 border-r border-neutral-200 flex flex-col bg-neutral-50">
          {/* Header with progress */}
          <div className="p-4 border-b border-neutral-200 bg-white">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-neutral-900">开发任务</h2>
              <div className="flex items-center gap-1">
                <span
                  className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}
                />
                <span className="text-xs text-neutral-400">
                  {isConnected ? '已连接' : '未连接'}
                </span>
              </div>
            </div>

            {/* Task Status Summary */}
            <div className="flex items-center gap-2 mb-3">
              <div className="flex items-center gap-1 px-2 py-1 rounded bg-green-50 border border-green-100">
                <span className="text-green-600 text-xs">✓</span>
                <span className="text-xs font-medium text-green-700">{completedTasks}</span>
              </div>
              <div className="flex items-center gap-1 px-2 py-1 rounded bg-neutral-100 border border-neutral-200">
                <span className="w-2 h-2 border-2 border-neutral-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs font-medium text-neutral-700">{inProgressTasks}</span>
              </div>
              <div className="flex items-center gap-1 px-2 py-1 rounded bg-neutral-50 border border-neutral-200">
                <span className="w-2 h-2 border-2 border-neutral-300 rounded-full" />
                <span className="text-xs font-medium text-neutral-600">{pendingTasks}</span>
              </div>
              {iterationCount > 0 && (
                <div className="ml-auto flex items-center gap-1 px-2 py-1 rounded bg-neutral-100 border border-neutral-200">
                  <span className="text-xs text-neutral-500">#</span>
                  <span className="text-xs font-medium text-neutral-700">{iterationCount}</span>
                </div>
              )}
            </div>

            {/* Progress bar */}
            <div className="h-2 bg-neutral-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-neutral-500">
                {completedTasks}/{totalTasks} 完成{iterationCount > 0 ? ` · 迭代 #${iterationCount}` : ''}
              </span>
              <span className="text-xs text-neutral-400">
                {progressPercent}%
              </span>
            </div>
          </div>

          {/* Task List */}
          <div className="flex-1 overflow-auto p-3">
            {prdData ? (
              <div className="space-y-2">
                {prdData.devTasks.map((task) => {
                  const status = getTaskStatus(task, currentTaskId);
                  const isExpanded = expandedTaskId === task.id;
                  return (
                    <div
                      key={task.id}
                      className={`rounded-lg border bg-white transition-all ${
                        status === 'in-progress' ? 'border-2 task-card-breathing' : ''
                      }`}
                    >
                      <button
                        onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                        className="w-full text-left p-3"
                      >
                        <div className="flex items-start gap-2">
                          {/* Status icon */}
                          <div className="flex-shrink-0 mt-0.5">
                            {status === 'completed' ? (
                              <span className="text-green-500 text-sm">✓</span>
                            ) : status === 'in-progress' ? (
                              <span className="w-3 h-3 border-2 border-neutral-500 border-t-transparent rounded-full animate-spin inline-block" />
                            ) : status === 'failed' ? (
                              <span className="text-red-500 text-sm">✗</span>
                            ) : (
                              <span className="w-3 h-3 border-2 border-neutral-300 rounded-full inline-block" />
                            )}
                          </div>
                          {/* Task info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono text-neutral-400">{task.id}</span>
                              <span
                                className={`text-xs px-1.5 py-0.5 rounded border ${getStatusColor(status)}`}
                              >
                                {getStatusLabel(status)}
                              </span>
                            </div>
                            <p className="text-sm font-medium text-neutral-900 mt-1 truncate">
                              {task.title}
                            </p>
                          </div>
                          {/* Expand icon */}
                          <span className="text-neutral-400 text-xs">
                            {isExpanded ? '▼' : '▶'}
                          </span>
                        </div>
                      </button>
                      {/* Expanded details */}
                      {isExpanded && (
                        <div className="px-3 pb-3 border-t border-neutral-100">
                          {task.description && (
                            <p className="text-xs text-neutral-600 mt-2">{task.description}</p>
                          )}
                          {task.prdSection && !task.description && (
                            <p className="text-xs text-neutral-400 mt-2 italic">PRD § {task.prdSection}</p>
                          )}
                          {(task.acceptanceCriteria?.length ?? 0) > 0 && (
                            <div className="mt-2">
                              <p className="text-xs font-medium text-neutral-500 mb-1">
                                验收标准:
                              </p>
                              <ul className="space-y-1">
                                {(task.acceptanceCriteria || []).map((criterion, idx) => (
                                  <li
                                    key={idx}
                                    className={`text-xs flex items-start gap-1.5 ${
                                      task.passes ? 'text-green-700' : 'text-neutral-600'
                                    }`}
                                  >
                                    {task.passes ? (
                                      <span className="text-green-500 flex-shrink-0">✓</span>
                                    ) : (
                                      <span className="w-3 h-3 flex-shrink-0 border border-neutral-300 rounded-sm mt-0.5" />
                                    )}
                                    <span>{criterion}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {task.testCases && task.testCases.length > 0 && (
                            <div className="mt-2">
                              <p className="text-xs font-medium text-neutral-500 mb-1">
                                测试用例:
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {(() => {
                                  const auto = task.testCases.filter(tc => tc.type !== 'manual').length;
                                  const manual = task.testCases.filter(tc => tc.type === 'manual').length;
                                  return (
                                    <span className="text-xs text-neutral-600 bg-neutral-100 px-1.5 py-0.5 rounded">
                                      {auto > 0 ? `${auto} 个自动测试` : ''}
                                      {auto > 0 && manual > 0 ? ' + ' : ''}
                                      {manual > 0 ? `${manual} 个手动` : ''}
                                    </span>
                                  );
                                })()}
                              </div>
                            </div>
                          )}
                          {task.notes && (
                            <p className="text-xs text-neutral-500 mt-2 italic">{task.notes}</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <div className="text-3xl text-neutral-300 mb-2">📋</div>
                <p className="text-sm font-medium text-neutral-700">未加载 PRD</p>
                <p className="text-xs text-neutral-500 mt-1">
                  等待 prd.json 创建中...
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Center: ProgressStrip + BatchPanel + BatchTimeline + Tabs */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* ProgressStrip - fixed height at top */}
          <ProgressStrip
            completed={completedTasks}
            total={totalTasks}
            isRunning={agentStatus.isRunning}
            agentStartTimestamp={agentStartTimeRef.current || undefined}
          />

          {/* BatchPanel - auto height */}
          <div className="shrink-0 px-3 pt-2">
            <BatchPanel
              teammates={teammatesData}
              timings={taskTimings}
              tasks={prdData?.devTasks ?? []}
              currentTaskId={currentTaskId}
              isRunning={agentStatus.isRunning}
              isComplete={allTasksCompleted}
            />
          </div>

          {/* BatchTimeline - scrollable, constrained height */}
          <div className="shrink-0 px-3 py-2 overflow-y-auto" style={{ maxHeight: '200px' }}>
            <BatchTimeline
              batches={taskTimings.batches}
              tasks={prdData?.devTasks ?? []}
              maxDuration={taskTimings.maxDuration}
              currentBatchIndex={teammatesData.batchIndex}
            />
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 p-2 border-t border-neutral-200 bg-white">
            <button
              onClick={() => setActiveTab('changes')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === 'changes'
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-600 hover:bg-neutral-100'
              }`}
            >
              文件变更
              {gitChanges && (
                <span className="ml-1 px-1.5 py-0.5 text-xs rounded bg-neutral-200 text-neutral-700">
                  {gitChanges.totals.files}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('commits')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === 'commits'
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-600 hover:bg-neutral-100'
              }`}
            >
              提交记录
              {gitCommits && (
                <span className="ml-1 px-1.5 py-0.5 text-xs rounded bg-neutral-200 text-neutral-700">
                  {gitCommits.count}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('flowchart')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === 'flowchart'
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-600 hover:bg-neutral-100'
              }`}
            >
              流程图
            </button>
            <button
              onClick={() => setActiveTab('activity')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === 'activity'
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-600 hover:bg-neutral-100'
              }`}
            >
              {agentLogs.alive && (
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              )}
              活动
            </button>
            {lastUpdated && (
              <span className="ml-auto text-xs text-neutral-400">
                最近更新: {new Date(lastUpdated).toLocaleTimeString()}
              </span>
            )}
          </div>

          {/* Content */}
          {activeTab === 'flowchart' && (
            <div className="flex-1 overflow-hidden">
              <FlowChart agentPhase={agentPhase as AgentPhase} agentStatus={agentStatus.status} currentIteration={iterationCount} />
            </div>
          )}
          {activeTab === 'activity' && (
            <div className="flex-1 overflow-hidden">
              <AgentActivityFeed lines={agentLogs.lines} alive={agentLogs.alive} />
            </div>
          )}
          {activeTab === 'changes' && (
            <div className="flex-1 overflow-auto p-4 bg-white">
              {gitChangesLoading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="animate-spin h-6 w-6 border-2 border-neutral-300 border-t-neutral-600 rounded-full" />
                </div>
              ) : gitChanges ? (
                <div>
                  {/* Summary */}
                  <div className="flex items-center gap-4 mb-4 pb-4 border-b border-neutral-200">
                    <div className="text-sm text-neutral-600">
                      <span className="font-medium">{gitChanges.totals.files}</span> 个文件变更
                    </div>
                    <div className="text-sm text-green-600">
                      <span className="font-medium">+{gitChanges.totals.additions}</span>
                    </div>
                    <div className="text-sm text-red-600">
                      <span className="font-medium">-{gitChanges.totals.deletions}</span>
                    </div>
                    <button
                      onClick={fetchGitChanges}
                      className="ml-auto text-xs text-neutral-500 hover:text-neutral-700"
                    >
                      刷新
                    </button>
                  </div>
                  {/* File list */}
                  <div className="space-y-1">
                    {gitChanges.changes.map((change) => (
                      <div
                        key={change.path}
                        className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-neutral-50"
                      >
                        {/* Status indicator */}
                        <span
                          className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            change.status === 'added'
                              ? 'bg-green-500'
                              : change.status === 'deleted'
                              ? 'bg-red-500'
                              : 'bg-yellow-500'
                          }`}
                        />
                        {/* File path */}
                        <span className="flex-1 text-sm font-mono text-neutral-700 truncate">
                          {change.path}
                        </span>
                        {/* Stats */}
                        <div className="flex items-center gap-2 text-xs flex-shrink-0">
                          {change.additions > 0 && (
                            <span className="text-green-600">+{change.additions}</span>
                          )}
                          {change.deletions > 0 && (
                            <span className="text-red-600">-{change.deletions}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-2">
                  <p className="text-neutral-500 text-sm">暂无文件变更</p>
                  {agentStatus.isRunning && (
                    <button
                      onClick={() => setActiveTab('activity')}
                      className="text-xs text-neutral-500 hover:text-neutral-700 underline"
                    >
                      查看代理活动
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {activeTab === 'commits' && (
            <div className="flex-1 overflow-auto p-4 bg-white">
              {gitCommitsLoading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="animate-spin h-6 w-6 border-2 border-neutral-300 border-t-neutral-600 rounded-full" />
                </div>
              ) : gitCommits && gitCommits.commits.length > 0 ? (
                <div>
                  {/* Header */}
                  <div className="flex items-center gap-4 mb-4 pb-4 border-b border-neutral-200">
                    <div className="text-sm text-neutral-600">
                      <span className="font-mono text-neutral-600">{gitCommits.branch}</span>
                      {' 分支 · '}
                      <span className="font-medium">{gitCommits.count}</span> 个提交
                    </div>
                    <button
                      onClick={fetchGitCommits}
                      className="ml-auto text-xs text-neutral-500 hover:text-neutral-700"
                    >
                      刷新
                    </button>
                  </div>
                  {/* Commits list */}
                  <div className="space-y-3">
                    {gitCommits.commits.map((commit) => (
                      <div
                        key={commit.hash}
                        className="p-3 rounded-lg border border-neutral-200 hover:border-neutral-300 transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          <span className="text-xs font-mono text-neutral-400 flex-shrink-0 mt-0.5">
                            {commit.shortHash}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-neutral-900 font-medium">
                              {commit.message}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              {commit.taskId && (
                                <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-neutral-200 text-neutral-700">
                                  {commit.taskId}
                                </span>
                              )}
                              <span className="text-xs text-neutral-400">
                                {new Date(commit.date).toLocaleDateString('zh-CN', {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-neutral-500 text-sm">该分支暂无提交记录</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Agent Data Panel (260px) */}
        <div className="w-[260px] flex-shrink-0 border-l border-neutral-200 flex flex-col bg-neutral-50 overflow-auto">
          <div className="p-4 border-b border-neutral-200 bg-white">
            <h3 className="text-sm font-semibold text-neutral-900">代理状态</h3>
          </div>
          <AgentDataPanel
            agentStatus={agentStatus.status}
            isRunning={agentStatus.isRunning}
            isComplete={agentStatus.isComplete}
            hasError={agentStatus.hasError}
            progressPercent={agentStatus.progressPercent}
            totalTasks={totalTasks}
            elapsedSeconds={taskTimings.totalElapsed}
            gitStats={gitStatsData}
            avgTaskTime={taskTimings.avgTime}
            eta={etaSeconds}
          />
        </div>
      </div>
    </div>
  );
}

function Stage3Fallback() {
  return (
    <div className="flex h-full items-center justify-center bg-neutral-50 text-sm text-neutral-500">
      加载中...
    </div>
  );
}

export default function Stage3Page() {
  return (
    <Suspense fallback={<Stage3Fallback />}>
      <Stage3PageContent />
    </Suspense>
  );
}
