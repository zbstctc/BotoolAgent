'use client';

import Link from 'next/link';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { TaskHistory, NewPrdDialog, ProjectCard, type TaskHistoryItem, type TaskStatus, type TaskStage } from '@/components';
import { useProject, type ProjectState } from '@/contexts/ProjectContext';

interface PRDItem {
  id: string;
  name: string;
  filename: string;
  createdAt: string;
  status: 'draft' | 'ready' | 'in-progress' | 'completed';
  preview?: string;
}

interface SessionItem {
  id: string;
  name: string;
  date: string;
  status: 'completed' | 'failed' | 'partial';
  tasksCompleted: number;
  tasksTotal: number;
  branchName?: string;
  description?: string;
}

// Extended session item from API
interface ExtendedSessionItem extends SessionItem {
  taskStatus: TaskStatus;
  stage: TaskStage;
  startTime: string;
  endTime?: string;
  isMerged: boolean;
  prUrl?: string;
}

interface SessionDetails {
  id: string;
  name: string;
  description?: string;
  branchName?: string;
  date: string;
  status: 'completed' | 'failed' | 'partial';
  tasksCompleted: number;
  tasksTotal: number;
  devTasks: {
    id: string;
    title: string;
    description?: string;
    passes: boolean;
    acceptanceCriteria?: string[];
  }[];
  progressLog?: string;
}

export default function Dashboard() {
  const router = useRouter();
  const {
    activeProject,
    activeProjectId,
    getAllProjects,
    deleteProject,
    archiveProject,
    setActiveProject,
    isLoading: projectsLoading,
  } = useProject();

  const [prds, setPrds] = useState<PRDItem[]>([]);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [taskHistory, setTaskHistory] = useState<TaskHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [taskHistoryLoading, setTaskHistoryLoading] = useState(true);
  const [selectedPRD, setSelectedPRD] = useState<PRDItem | null>(null);
  const [prdContent, setPrdContent] = useState<string>('');
  const [loadingContent, setLoadingContent] = useState(false);
  const [selectedSession, setSelectedSession] = useState<SessionItem | null>(null);
  const [sessionDetails, setSessionDetails] = useState<SessionDetails | null>(null);
  const [loadingSessionDetails, setLoadingSessionDetails] = useState(false);
  const [viewMode, setViewMode] = useState<'timeline' | 'list'>('timeline');
  const [showNewPrdDialog, setShowNewPrdDialog] = useState(false);

  // Get all projects from context
  const allProjects = getAllProjects();
  // Filter out archived projects for the active list
  const visibleProjects = allProjects.filter((p) => p.status !== 'archived');

  // Note: Auto-redirect removed - user can freely navigate Dashboard
  // and choose which project to continue via the "继续工作" button or project cards

  const fetchTaskHistory = useCallback(async () => {
    setTaskHistoryLoading(true);
    try {
      const response = await fetch('/api/sessions?extended=true');
      const data = await response.json();
      if (data.extended && data.sessions) {
        // Convert ExtendedSessionItem to TaskHistoryItem
        const historyItems: TaskHistoryItem[] = data.sessions.map((s: ExtendedSessionItem) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          branchName: s.branchName,
          status: s.taskStatus,
          stage: s.stage,
          tasksCompleted: s.tasksCompleted,
          tasksTotal: s.tasksTotal,
          startTime: s.startTime,
          endTime: s.endTime,
          isMerged: s.isMerged,
          prUrl: s.prUrl,
        }));
        setTaskHistory(historyItems);
      }
    } catch (error) {
      console.error('Failed to fetch task history:', error);
    } finally {
      setTaskHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPRDs();
    fetchSessions();
    fetchTaskHistory();
  }, [fetchTaskHistory]);

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

  async function fetchSessions() {
    try {
      const response = await fetch('/api/sessions');
      const data = await response.json();
      setSessions(data.sessions || []);
    } catch (error) {
      console.error('Failed to fetch sessions:', error);
    } finally {
      setSessionsLoading(false);
    }
  }

  // Handle continue task
  function handleContinueTask(task: TaskHistoryItem) {
    // Navigate to the appropriate stage
    window.location.href = `/stage${task.stage}?session=${task.id}`;
  }

  // Handle merge task
  async function handleMergeTask(task: TaskHistoryItem) {
    if (!task.branchName) return;
    // Navigate to stage 5 for merge
    window.location.href = `/stage5?session=${task.id}`;
  }

  // Handle view project - navigate to corresponding stage
  function handleViewProject(project: ProjectState) {
    setActiveProject(project.id);
    router.push(`/stage${project.currentStage}`);
  }

  // Handle delete project
  function handleDeleteProject(projectId: string) {
    deleteProject(projectId);
  }

  // Handle archive project
  function handleArchiveProject(projectId: string) {
    archiveProject(projectId);
  }

  // Handle delete task
  async function handleDeleteTask(task: TaskHistoryItem) {
    if (!confirm(`确定要删除任务 "${task.name}" 吗？此操作不可撤销。`)) {
      return;
    }

    try {
      const response = await fetch(`/api/sessions/${task.id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        // Refresh the task history
        fetchTaskHistory();
        fetchSessions();
      } else {
        const error = await response.json();
        alert(`删除失败: ${error.error || '未知错误'}`);
      }
    } catch (error) {
      console.error('Failed to delete task:', error);
      alert('删除失败，请稍后重试');
    }
  }

  async function handlePRDClick(prd: PRDItem) {
    setSelectedPRD(prd);
    setLoadingContent(true);
    try {
      const response = await fetch(`/api/prd/${prd.id}`);
      const data = await response.json();
      setPrdContent(data.content || '');
    } catch (error) {
      console.error('Failed to fetch PRD content:', error);
      setPrdContent('Failed to load PRD content');
    } finally {
      setLoadingContent(false);
    }
  }

  function closePreview() {
    setSelectedPRD(null);
    setPrdContent('');
  }

  async function handleSessionClick(session: SessionItem) {
    setSelectedSession(session);
    setLoadingSessionDetails(true);
    try {
      const response = await fetch(`/api/sessions/${session.id}`);
      const data = await response.json();
      setSessionDetails(data);
    } catch (error) {
      console.error('Failed to fetch session details:', error);
      setSessionDetails(null);
    } finally {
      setLoadingSessionDetails(false);
    }
  }

  function closeSessionDetails() {
    setSelectedSession(null);
    setSessionDetails(null);
  }

  return (
    <div className="flex flex-col gap-6 py-6 px-4 mx-auto max-w-7xl h-full overflow-y-auto bg-neutral-50">
      {/* Active Project Status Banner */}
      {activeProject ? (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-blue-500" />
              <div>
                <p className="text-sm font-medium text-blue-900">
                  {activeProject.name}
                </p>
                <p className="text-xs text-blue-700">
                  Stage {activeProject.currentStage} · {getStageLabel(activeProject.currentStage)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-32 h-2 rounded-full bg-blue-200 overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all"
                  style={{ width: `${(activeProject.currentStage / 5) * 100}%` }}
                />
              </div>
              <span className="text-sm font-medium text-blue-700">
                {activeProject.currentStage}/5
              </span>
              <Link
                href={`/stage${activeProject.currentStage}`}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
              >
                继续工作
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-2.5 w-2.5 rounded-full bg-neutral-300" />
              <p className="text-sm text-neutral-600">
                暂无进行中的项目
              </p>
            </div>
            <button
              onClick={() => setShowNewPrdDialog(true)}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 transition-colors"
            >
              + 新建 PRD
            </button>
          </div>
        </div>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left: Active Projects + PRD Documents */}
        <section className="flex flex-col gap-6">
          {/* Active Projects */}
          <div className="flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-neutral-900">
                我的项目
              </h2>
              <span className="text-xs text-neutral-400">
                {visibleProjects.length} 个项目
              </span>
            </div>
            {projectsLoading ? (
              <div className="space-y-2">
                {[1, 2].map((i) => (
                  <div
                    key={i}
                    className="animate-pulse rounded-lg border border-neutral-200 bg-white p-4"
                  >
                    <div className="h-4 bg-neutral-200 rounded w-3/4 mb-2" />
                    <div className="h-3 bg-neutral-100 rounded w-1/3" />
                  </div>
                ))}
              </div>
            ) : visibleProjects.length > 0 ? (
              <div className="space-y-2">
                {visibleProjects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    isActive={project.id === activeProjectId}
                    onView={handleViewProject}
                    onDelete={handleDeleteProject}
                    onArchive={handleArchiveProject}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                title="暂无进行中的项目"
                description="创建你的第一个 PRD，开始自主开发流程。"
                actionLabel="新建 PRD"
                onAction={() => setShowNewPrdDialog(true)}
              />
            )}
          </div>

          {/* PRD Documents */}
          <div className="flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-neutral-900">
                PRD Documents
              </h2>
              <button
                onClick={() => setShowNewPrdDialog(true)}
                className="text-sm font-medium text-neutral-500 hover:text-neutral-900 transition-colors"
              >
                + New PRD
              </button>
            </div>

            {loading ? (
              <div className="flex flex-col gap-2">
                {[1, 2].map((i) => (
                  <div
                    key={i}
                    className="animate-pulse rounded-lg border border-neutral-200 bg-white p-4"
                  >
                    <div className="h-4 bg-neutral-200 rounded w-3/4 mb-2" />
                    <div className="h-3 bg-neutral-100 rounded w-1/3" />
                  </div>
                ))}
              </div>
            ) : prds.length > 0 ? (
              <div className="flex flex-col gap-2">
                {prds.map((prd) => (
                  <PRDCard
                    key={prd.id}
                    prd={prd}
                    onClick={() => handlePRDClick(prd)}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No PRD documents yet"
                description="Create your first PRD to start the autonomous development process."
                actionLabel="Create PRD"
                onAction={() => setShowNewPrdDialog(true)}
              />
            )}
          </div>
        </section>

        {/* Right: Task History */}
        <section className="flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-neutral-900">
              任务历史
            </h2>
            <div className="flex items-center gap-2">
              {/* View mode toggle */}
              <div className="flex items-center bg-neutral-100 rounded-md p-0.5">
                <button
                  onClick={() => setViewMode('timeline')}
                  className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                    viewMode === 'timeline'
                      ? 'bg-white text-neutral-900 shadow-sm'
                      : 'text-neutral-500 hover:text-neutral-700'
                  }`}
                >
                  时间线
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                    viewMode === 'list'
                      ? 'bg-white text-neutral-900 shadow-sm'
                      : 'text-neutral-500 hover:text-neutral-700'
                  }`}
                >
                  列表
                </button>
              </div>
            </div>
          </div>

          {viewMode === 'timeline' ? (
            <TaskHistory
              tasks={taskHistory}
              loading={taskHistoryLoading}
              onContinue={handleContinueTask}
              onMerge={handleMergeTask}
              onDelete={handleDeleteTask}
              onRefresh={fetchTaskHistory}
            />
          ) : (
            // Legacy list view
            sessionsLoading ? (
              <div className="flex flex-col gap-2">
                {[1, 2].map((i) => (
                  <div
                    key={i}
                    className="animate-pulse rounded-lg border border-neutral-200 bg-white p-4"
                  >
                    <div className="h-4 bg-neutral-200 rounded w-3/4 mb-2" />
                    <div className="h-3 bg-neutral-100 rounded w-1/3" />
                  </div>
                ))}
              </div>
            ) : sessions.length > 0 ? (
              <div className="flex flex-col gap-2">
                {sessions.map((session) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    onClick={() => handleSessionClick(session)}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No sessions yet"
                description="Completed development sessions will appear here."
              />
            )
          )}
        </section>
      </div>

      {/* PRD Preview Modal */}
      {selectedPRD && (
        <PRDPreviewModal
          prd={selectedPRD}
          content={prdContent}
          loading={loadingContent}
          onClose={closePreview}
        />
      )}

      {/* Session Details Modal */}
      {selectedSession && (
        <SessionDetailsModal
          session={selectedSession}
          details={sessionDetails}
          loading={loadingSessionDetails}
          onClose={closeSessionDetails}
        />
      )}

      {/* New PRD Dialog */}
      <NewPrdDialog
        isOpen={showNewPrdDialog}
        onClose={() => setShowNewPrdDialog(false)}
      />
    </div>
  );
}

function PRDCard({
  prd,
  onClick,
}: {
  prd: PRDItem;
  onClick: () => void;
}) {
  const statusStyles = {
    draft: 'bg-neutral-100 text-neutral-600',
    ready: 'bg-green-100 text-green-700',
    'in-progress': 'bg-blue-100 text-blue-700',
    completed: 'bg-neutral-100 text-neutral-600',
  };

  const statusLabels = {
    draft: 'Draft',
    ready: 'Ready',
    'in-progress': 'In Progress',
    completed: 'Completed',
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div
      className="group flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-4 hover:border-neutral-300 hover:shadow-sm transition-all cursor-pointer"
      onClick={onClick}
    >
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <p className="font-medium text-neutral-900 truncate">{prd.name}</p>
        <p className="text-xs text-neutral-500">{formatDate(prd.createdAt)}</p>
        {prd.preview && (
          <p className="text-xs text-neutral-400 truncate mt-1">{prd.preview}</p>
        )}
      </div>
      <div className="flex items-center gap-3 ml-4 flex-shrink-0">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyles[prd.status]}`}
        >
          {statusLabels[prd.status]}
        </span>
        <Link
          href={`/stage2?prd=${prd.id}`}
          className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 opacity-0 group-hover:opacity-100 hover:bg-neutral-50 transition-all"
          onClick={(e) => e.stopPropagation()}
        >
          Execute
        </Link>
      </div>
    </div>
  );
}

function SessionCard({
  session,
  onClick,
}: {
  session: SessionItem;
  onClick: () => void;
}) {
  const statusStyles = {
    completed: 'text-green-600',
    failed: 'text-red-600',
    partial: 'text-amber-600',
  };

  const statusIcons = {
    completed: '✓',
    failed: '✗',
    partial: '◐',
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div
      className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-4 hover:border-neutral-300 hover:shadow-sm transition-all cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        <span className={`text-lg ${statusStyles[session.status]}`}>
          {statusIcons[session.status]}
        </span>
        <div className="flex flex-col gap-0.5">
          <p className="font-medium text-neutral-900">{session.name}</p>
          <p className="text-xs text-neutral-500">{formatDate(session.date)}</p>
        </div>
      </div>
      <div className="text-sm text-neutral-500">
        {session.tasksCompleted}/{session.tasksTotal} tasks
      </div>
    </div>
  );
}

function PRDPreviewModal({
  prd,
  content,
  loading,
  onClose,
}: {
  prd: PRDItem;
  content: string;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="relative max-w-3xl w-full max-h-[80vh] bg-white rounded-lg shadow-xl mx-4 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-neutral-200">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">{prd.name}</h2>
            <p className="text-xs text-neutral-500">{prd.filename}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/stage2?prd=${prd.id}`}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 transition-colors"
            >
              Select for Execution
            </Link>
            <button
              onClick={onClose}
              className="rounded-md p-2 text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
              aria-label="Close"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="animate-pulse space-y-3">
              <div className="h-6 bg-neutral-200 rounded w-1/2" />
              <div className="h-4 bg-neutral-100 rounded w-full" />
              <div className="h-4 bg-neutral-100 rounded w-4/5" />
              <div className="h-4 bg-neutral-100 rounded w-3/4" />
            </div>
          ) : (
            <pre className="whitespace-pre-wrap font-mono text-sm text-neutral-700 leading-relaxed">
              {content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

function SessionDetailsModal({
  session,
  details,
  loading,
  onClose,
}: {
  session: SessionItem;
  details: SessionDetails | null;
  loading: boolean;
  onClose: () => void;
}) {
  const statusStyles = {
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
    partial: 'bg-amber-100 text-amber-700',
  };

  const statusLabels = {
    completed: 'Completed',
    failed: 'Failed',
    partial: 'Partial',
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="relative max-w-4xl w-full max-h-[85vh] bg-white rounded-lg shadow-xl mx-4 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-neutral-200">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-lg font-semibold text-neutral-900">
                {session.name}
              </h2>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-neutral-500">
                  {formatDate(session.date)}
                </span>
                {details?.branchName && (
                  <span className="text-xs text-neutral-400 font-mono bg-neutral-100 px-1.5 py-0.5 rounded">
                    {details.branchName}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyles[session.status]}`}
            >
              {statusLabels[session.status]}
            </span>
            <button
              onClick={onClose}
              className="rounded-md p-2 text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
              aria-label="Close"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="p-4">
              <div className="animate-pulse space-y-4">
                <div className="h-4 bg-neutral-200 rounded w-1/4" />
                <div className="space-y-2">
                  <div className="h-12 bg-neutral-100 rounded" />
                  <div className="h-12 bg-neutral-100 rounded" />
                  <div className="h-12 bg-neutral-100 rounded" />
                </div>
              </div>
            </div>
          ) : details ? (
            <div className="flex flex-col">
              {/* Description */}
              {details.description && (
                <div className="p-4 border-b border-neutral-100">
                  <p className="text-sm text-neutral-600">{details.description}</p>
                </div>
              )}

              {/* Progress Summary */}
              <div className="p-4 border-b border-neutral-100 bg-neutral-50">
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <div className="h-2 rounded-full bg-neutral-200 overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          details.status === 'completed'
                            ? 'bg-green-500'
                            : details.status === 'failed'
                            ? 'bg-red-500'
                            : 'bg-amber-500'
                        }`}
                        style={{
                          width: `${
                            details.tasksTotal > 0
                              ? (details.tasksCompleted / details.tasksTotal) * 100
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                  </div>
                  <span className="text-sm font-medium text-neutral-700">
                    {details.tasksCompleted}/{details.tasksTotal} tasks completed
                  </span>
                </div>
              </div>

              {/* Dev Tasks */}
              <div className="p-4">
                <h3 className="text-sm font-medium text-neutral-900 mb-3">
                  Development Tasks
                </h3>
                <div className="space-y-2">
                  {details.devTasks.map((task) => (
                    <div
                      key={task.id}
                      className={`rounded-lg border p-3 ${
                        task.passes
                          ? 'border-green-200 bg-green-50'
                          : 'border-neutral-200 bg-white'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={`text-sm ${
                            task.passes ? 'text-green-600' : 'text-neutral-400'
                          }`}
                        >
                          {task.passes ? '✓' : '○'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-neutral-400">
                              {task.id}
                            </span>
                            <p className="text-sm font-medium text-neutral-900">
                              {task.title}
                            </p>
                          </div>
                          {task.description && (
                            <p className="text-xs text-neutral-500 mt-1">
                              {task.description}
                            </p>
                          )}
                          {task.acceptanceCriteria && task.acceptanceCriteria.length > 0 && (
                            <ul className="mt-2 space-y-1">
                              {task.acceptanceCriteria.map((criterion, idx) => (
                                <li
                                  key={idx}
                                  className="text-xs text-neutral-500 flex items-start gap-1.5"
                                >
                                  <span className="text-neutral-300">•</span>
                                  {criterion}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Progress Log */}
              {details.progressLog && (
                <div className="p-4 border-t border-neutral-100">
                  <h3 className="text-sm font-medium text-neutral-900 mb-3">
                    Progress Log
                  </h3>
                  <pre className="text-xs text-neutral-600 font-mono whitespace-pre-wrap bg-neutral-50 rounded-lg p-3 max-h-48 overflow-auto">
                    {details.progressLog}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div className="p-8 text-center">
              <p className="text-sm text-neutral-500">
                Failed to load session details
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Helper to get stage label
function getStageLabel(stage: number): string {
  const labels: Record<number, string> = {
    1: 'PRD 需求确认',
    2: '开发规划',
    3: 'Coding',
    4: '测试',
    5: 'Review',
  };
  return labels[stage] || `Stage ${stage}`;
}

function EmptyState({
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-neutral-50/50 p-8 text-center">
      <div className="mb-2 text-3xl text-neutral-300">📄</div>
      <h3 className="text-sm font-medium text-neutral-700">{title}</h3>
      <p className="mt-1 text-xs text-neutral-500 max-w-xs">{description}</p>
      {actionLabel && (onAction || actionHref) && (
        onAction ? (
          <button
            onClick={onAction}
            className="mt-4 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 transition-colors"
          >
            {actionLabel}
          </button>
        ) : actionHref ? (
          <Link
            href={actionHref}
            className="mt-4 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 transition-colors"
          >
            {actionLabel}
          </Link>
        ) : null
      )}
    </div>
  );
}
