'use client';

import { useState, useEffect, useRef } from 'react';
import { StageIndicator } from '@/components';
import { useFileWatcher, parsePrdJson } from '@/hooks';
import type { DevTask, PrdData } from '@/hooks';
import { FlowChart } from '@/components/FlowChart';

type TaskStatus = 'pending' | 'in-progress' | 'completed' | 'failed';

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
      return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'failed':
      return 'bg-red-100 text-red-700 border-red-200';
    default:
      return 'bg-neutral-100 text-neutral-600 border-neutral-200';
  }
}

function getStatusLabel(status: TaskStatus): string {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'in-progress':
      return 'In Progress';
    case 'failed':
      return 'Failed';
    default:
      return 'Pending';
  }
}

export default function Stage3Page() {
  const [prdData, setPrdData] = useState<PrdData | null>(null);
  const [progressLog, setProgressLog] = useState<string>('');
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [showFlowchart, setShowFlowchart] = useState(true);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Use file watcher to get real-time updates
  const { prd, progress, isConnected, lastUpdated } = useFileWatcher({
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

  // Auto-scroll log to bottom
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [progressLog]);

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

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      {/* Stage Indicator */}
      <StageIndicator currentStage={3} completedStages={[1, 2]} />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Dev Tasks Status */}
        <div className="w-80 flex-shrink-0 border-r border-neutral-200 flex flex-col bg-neutral-50">
          {/* Header with progress */}
          <div className="p-4 border-b border-neutral-200 bg-white">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-neutral-900">Dev Tasks</h2>
              <div className="flex items-center gap-1">
                <span
                  className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}
                />
                <span className="text-xs text-neutral-400">
                  {isConnected ? 'Live' : 'Disconnected'}
                </span>
              </div>
            </div>

            {/* Task Status Summary */}
            <div className="flex items-center gap-2 mb-3">
              <div className="flex items-center gap-1 px-2 py-1 rounded bg-green-50 border border-green-100">
                <span className="text-green-600 text-xs">✓</span>
                <span className="text-xs font-medium text-green-700">{completedTasks}</span>
              </div>
              <div className="flex items-center gap-1 px-2 py-1 rounded bg-blue-50 border border-blue-100">
                <span className="w-2 h-2 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs font-medium text-blue-700">{inProgressTasks}</span>
              </div>
              <div className="flex items-center gap-1 px-2 py-1 rounded bg-neutral-50 border border-neutral-200">
                <span className="w-2 h-2 border-2 border-neutral-300 rounded-full" />
                <span className="text-xs font-medium text-neutral-600">{pendingTasks}</span>
              </div>
              {iterationCount > 0 && (
                <div className="ml-auto flex items-center gap-1 px-2 py-1 rounded bg-purple-50 border border-purple-100">
                  <span className="text-xs text-purple-500">#</span>
                  <span className="text-xs font-medium text-purple-700">{iterationCount}</span>
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
              <span className="text-xs text-neutral-500">{progressPercent}% complete</span>
              <span className="text-xs text-neutral-400">
                {completedTasks}/{totalTasks} tasks
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
                        status === 'in-progress' ? 'ring-2 ring-blue-200' : ''
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
                              <span className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin inline-block" />
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
                          <p className="text-xs text-neutral-600 mt-2">{task.description}</p>
                          {task.acceptanceCriteria.length > 0 && (
                            <div className="mt-2">
                              <p className="text-xs font-medium text-neutral-500 mb-1">
                                Acceptance Criteria:
                              </p>
                              <ul className="space-y-1">
                                {task.acceptanceCriteria.map((criterion, idx) => (
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
                <p className="text-sm font-medium text-neutral-700">No PRD loaded</p>
                <p className="text-xs text-neutral-500 mt-1">
                  Waiting for prd.json to be created...
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right: Flowchart and Logs */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tabs */}
          <div className="flex items-center gap-1 p-2 border-b border-neutral-200 bg-white">
            <button
              onClick={() => setShowFlowchart(true)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                showFlowchart
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-600 hover:bg-neutral-100'
              }`}
            >
              Flowchart
            </button>
            <button
              onClick={() => setShowFlowchart(false)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                !showFlowchart
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-600 hover:bg-neutral-100'
              }`}
            >
              Progress Log
            </button>
            {lastUpdated && (
              <span className="ml-auto text-xs text-neutral-400">
                Last update: {new Date(lastUpdated).toLocaleTimeString()}
              </span>
            )}
          </div>

          {/* Content */}
          {showFlowchart ? (
            <div className="flex-1 overflow-hidden">
              <FlowChart />
            </div>
          ) : (
            <div className="flex-1 overflow-auto p-4 bg-neutral-900">
              {progressLog ? (
                <pre className="font-mono text-sm text-neutral-200 whitespace-pre-wrap">
                  {progressLog}
                  <div ref={logEndRef} />
                </pre>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-neutral-500 text-sm">No progress log yet...</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
