'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { StageIndicator, TaskEditor } from '@/components';

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
  const [conversionProgress, setConversionProgress] = useState<string>('');
  const [convertedPrd, setConvertedPrd] = useState<PrdJson | null>(null);
  const [conversionError, setConversionError] = useState<string>('');

  // Task editing state
  const [editableTasks, setEditableTasks] = useState<DevTask[]>([]);
  const [isSavingTasks, setIsSavingTasks] = useState(false);
  const [showTaskEditor, setShowTaskEditor] = useState(false);

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
    setSelectedPrd(prd);
    setLoadingContent(true);
    // Reset conversion state when selecting a new PRD
    setConversionStatus('idle');
    setConversionProgress('');
    setConvertedPrd(null);
    setConversionError('');
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

  const handleConvert = useCallback(async () => {
    if (!selectedPrd || !prdContent || conversionStatus === 'converting') {
      return;
    }

    setConversionStatus('converting');
    setConversionProgress('');
    setConvertedPrd(null);
    setConversionError('');

    try {
      const response = await fetch('/api/prd/convert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prdContent,
          prdId: selectedPrd.id,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to start conversion');
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === 'progress') {
                setConversionProgress((prev) => prev + data.content);
              } else if (data.type === 'complete') {
                setConvertedPrd(data.prdJson);
                setEditableTasks(data.prdJson.devTasks);
                setConversionStatus('success');
                setShowTaskEditor(true);
              } else if (data.type === 'error') {
                setConversionError(data.error);
                setConversionStatus('error');
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }
    } catch (error) {
      console.error('Conversion error:', error);
      setConversionError(error instanceof Error ? error.message : 'Unknown error');
      setConversionStatus('error');
    }
  }, [selectedPrd, prdContent, conversionStatus]);

  const handleProceedToStage3 = useCallback(() => {
    router.push('/stage3');
  }, [router]);

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
    <div className="flex flex-col h-[calc(100vh-64px)]">
      {/* Stage Indicator */}
      <StageIndicator currentStage={2} completedStages={[1]} />

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
                <div className="text-3xl text-neutral-300 mb-2">📄</div>
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

        {/* Right: PRD Preview & Actions */}
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
                      className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors"
                    >
                      Start Development →
                    </button>
                  )}
                  <button
                    onClick={handleConvert}
                    disabled={conversionStatus === 'converting' || loadingContent}
                    className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                      conversionStatus === 'converting'
                        ? 'bg-blue-100 text-blue-600 cursor-wait'
                        : conversionStatus === 'success'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {conversionStatus === 'converting'
                      ? 'Converting...'
                      : conversionStatus === 'success'
                      ? '✓ Converted'
                      : 'Convert to JSON →'}
                  </button>
                </div>
              </div>

              {/* Conversion Progress / Success Banner */}
              {conversionStatus === 'converting' && (
                <div className="p-4 bg-blue-50 border-b border-blue-100">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full" />
                    <span className="text-sm font-medium text-blue-700">
                      Converting PRD to JSON...
                    </span>
                  </div>
                  {conversionProgress && (
                    <pre className="text-xs text-blue-600 font-mono max-h-32 overflow-auto bg-white/50 rounded p-2">
                      {conversionProgress}
                    </pre>
                  )}
                </div>
              )}

              {conversionStatus === 'success' && convertedPrd && (
                <div className="p-3 bg-green-50 border-b border-green-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-green-600">✓</span>
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
                      {showTaskEditor ? 'View PRD' : 'Edit Tasks'}
                    </button>
                  </div>
                </div>
              )}

              {conversionStatus === 'error' && (
                <div className="p-4 bg-red-50 border-b border-red-100">
                  <div className="flex items-center gap-2">
                    <span className="text-red-500 text-lg">✗</span>
                    <span className="text-sm font-medium text-red-700">
                      Conversion failed
                    </span>
                  </div>
                  {conversionError && (
                    <p className="text-sm text-red-600 mt-2">{conversionError}</p>
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
              ) : (
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
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center bg-neutral-50">
              <div className="text-center px-4">
                <div className="text-5xl text-neutral-200 mb-4">←</div>
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
