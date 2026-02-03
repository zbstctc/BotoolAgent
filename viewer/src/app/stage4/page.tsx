'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { StageIndicator, TestResults, ManualChecklist, extractChecklistFromPRD, StageTransitionModal } from '@/components';
import { useFileWatcher, parsePrdJson, useProjectValidation } from '@/hooks';
import { useProject } from '@/contexts/ProjectContext';
import type { ChecklistItem } from '@/components/ManualChecklist';
import type { TestResult, TestSummary } from '@/components/TestResults';

interface TestCommand {
  type: string;
  name: string;
}

export default function Stage4Page() {
  const router = useRouter();
  const { activeProject, updateProject } = useProject();

  // Project validation
  useProjectValidation({ currentStage: 4 });

  // PRD data state
  const [prdData, setPrdData] = useState<{ devTasks: Array<{ id: string; title: string; acceptanceCriteria: string[]; passes?: boolean }> } | null>(null);

  // Test states
  const [isRunningTests, setIsRunningTests] = useState(false);
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [testSummary, setTestSummary] = useState<TestSummary | null>(null);
  const [currentTest, setCurrentTest] = useState<string | null>(null);
  const [availableTests, setAvailableTests] = useState<TestCommand[]>([]);

  // Manual checklist states
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [isManualCheckComplete, setIsManualCheckComplete] = useState(false);

  // Overall state
  const [canProceedToReview, setCanProceedToReview] = useState(false);

  // Transition modal state
  const [showTransitionModal, setShowTransitionModal] = useState(false);

  // SSE event source reference
  const eventSourceRef = useRef<EventSource | null>(null);

  // Use file watcher to get PRD data
  const { prd } = useFileWatcher({
    enabled: true,
    onPrdUpdate: (content) => {
      const parsed = parsePrdJson(content);
      if (parsed) {
        setPrdData(parsed);
      }
    },
  });

  // Initial parse of prd data
  useEffect(() => {
    if (prd) {
      const parsed = parsePrdJson(prd);
      if (parsed) {
        setPrdData(parsed);
      }
    }
  }, [prd]);

  // Extract checklist items from PRD
  useEffect(() => {
    if (prdData) {
      const items = extractChecklistFromPRD(prdData.devTasks);
      setChecklistItems(items);
    }
  }, [prdData]);

  // Fetch available tests on mount
  useEffect(() => {
    const fetchTests = async () => {
      try {
        const response = await fetch('/api/test/run');
        if (response.ok) {
          const data = await response.json();
          setAvailableTests(data.commands || []);
        }
      } catch (error) {
        console.error('Failed to fetch available tests:', error);
      }
    };
    fetchTests();
  }, []);

  // Check if can proceed to Review
  useEffect(() => {
    const allTestsPassed = testSummary && testSummary.failed === 0 && testSummary.passed > 0;
    const manualCheckDone = isManualCheckComplete;
    setCanProceedToReview(!!(allTestsPassed && manualCheckDone));
  }, [testSummary, isManualCheckComplete]);

  // Cleanup event source on unmount
  useEffect(() => {
    const eventSource = eventSourceRef.current;
    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, []);

  // Handle SSE events - defined before handleRunTests which uses it
  const handleSSEEvent = useCallback((event: string, data: unknown) => {
    switch (event) {
      case 'start': {
        const startData = data as { name: string };
        setCurrentTest(startData.name);
        break;
      }
      case 'result': {
        const result = data as TestResult;
        setTestResults((prev) => [...prev, result]);
        setCurrentTest(null);
        break;
      }
      case 'summary': {
        const summary = data as TestSummary;
        setTestSummary(summary);
        break;
      }
      case 'done': {
        setIsRunningTests(false);
        break;
      }
    }
  }, []);

  // Run all tests
  const handleRunTests = useCallback(async () => {
    // Close existing event source if any
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setIsRunningTests(true);
    setTestResults([]);
    setTestSummary(null);
    setCurrentTest(null);

    try {
      const response = await fetch('/api/test/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!response.ok || !response.body) {
        throw new Error('Failed to start tests');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let eventType = '';
        let eventData = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7);
          } else if (line.startsWith('data: ')) {
            eventData = line.slice(6);
            if (eventType && eventData) {
              try {
                const data = JSON.parse(eventData);
                handleSSEEvent(eventType, data);
              } catch {
                // Ignore parse errors
              }
              eventType = '';
              eventData = '';
            }
          }
        }
      }
    } catch (error) {
      console.error('Test run error:', error);
    } finally {
      setIsRunningTests(false);
      setCurrentTest(null);
    }
  }, [handleSSEEvent]);

  // Handle manual check completion
  const handleManualCheckComplete = useCallback(() => {
    setIsManualCheckComplete(true);
  }, []);

  // Navigate to Review (Stage 5) - show transition modal instead of direct navigation
  const handleProceedToReview = useCallback(() => {
    setShowTransitionModal(true);
  }, []);

  // Handle transition modal confirm
  const handleTransitionConfirm = useCallback(() => {
    if (activeProject) {
      updateProject(activeProject.id, { currentStage: 5 });
    }
    router.push('/stage5');
  }, [activeProject, updateProject, router]);

  // Handle transition modal later
  const handleTransitionLater = useCallback(() => {
    setShowTransitionModal(false);
    router.push('/');
  }, [router]);

  // Calculate test summary status
  const allTestsPassed = testSummary && testSummary.failed === 0 && testSummary.passed > 0;
  const hasTestResults = testResults.length > 0;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">
      {/* Stage Indicator */}
      <StageIndicator
        currentStage={4}
        completedStages={[1, 2, 3]}
        projectName={activeProject?.name}
        stageStatus={
          canProceedToReview
            ? '验证完成'
            : allTestsPassed && !isManualCheckComplete
              ? '待手动验证'
              : hasTestResults && !allTestsPassed
                ? '测试失败'
                : isRunningTests
                  ? '测试中...'
                  : '待测试'
        }
      />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel: Automated Tests */}
        <div className="flex-1 border-r border-neutral-200 flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-neutral-200 bg-white">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold text-neutral-900">
                <span className="mr-2">🧪</span>
                自动化测试
              </h2>
              <button
                onClick={handleRunTests}
                disabled={isRunningTests}
                className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                  isRunningTests
                    ? 'bg-neutral-100 text-neutral-400 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {isRunningTests ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    运行中...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                    </svg>
                    运行所有测试
                  </span>
                )}
              </button>
            </div>

            {/* Available tests info */}
            {availableTests.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {availableTests.map((test) => (
                  <span
                    key={test.type}
                    className="px-2 py-1 rounded text-xs bg-neutral-100 text-neutral-600"
                  >
                    {test.name}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Test Results */}
          <div className="flex-1 overflow-auto p-4 bg-neutral-50">
            <TestResults
              results={testResults}
              summary={testSummary}
              isRunning={isRunningTests}
              currentTest={currentTest || undefined}
            />
          </div>
        </div>

        {/* Right Panel: Manual Verification */}
        <div className="w-96 flex-shrink-0 flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-neutral-200 bg-white">
            <h2 className="text-lg font-semibold text-neutral-900">
              <span className="mr-2">✅</span>
              手动验证
            </h2>
            <p className="text-sm text-neutral-500 mt-1">
              请在浏览器中验证以下功能
            </p>
          </div>

          {/* Checklist */}
          <div className="flex-1 overflow-auto p-4 bg-neutral-50">
            <ManualChecklist
              items={checklistItems}
              onAllComplete={handleManualCheckComplete}
              storageKey="botool-stage4-manual-checklist"
            />
          </div>
        </div>
      </div>

      {/* Bottom Action Bar */}
      <div className="border-t border-neutral-200 bg-white p-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          {/* Status Summary */}
          <div className="flex items-center gap-6">
            {/* Test Status */}
            <div className="flex items-center gap-2">
              {hasTestResults ? (
                allTestsPassed ? (
                  <>
                    <span className="w-3 h-3 rounded-full bg-green-500" />
                    <span className="text-sm text-green-700 font-medium">测试通过</span>
                  </>
                ) : (
                  <>
                    <span className="w-3 h-3 rounded-full bg-red-500" />
                    <span className="text-sm text-red-700 font-medium">测试失败</span>
                  </>
                )
              ) : (
                <>
                  <span className="w-3 h-3 rounded-full bg-neutral-300" />
                  <span className="text-sm text-neutral-500">待测试</span>
                </>
              )}
            </div>

            {/* Manual Check Status */}
            <div className="flex items-center gap-2">
              {isManualCheckComplete ? (
                <>
                  <span className="w-3 h-3 rounded-full bg-green-500" />
                  <span className="text-sm text-green-700 font-medium">验证完成</span>
                </>
              ) : (
                <>
                  <span className="w-3 h-3 rounded-full bg-neutral-300" />
                  <span className="text-sm text-neutral-500">待验证</span>
                </>
              )}
            </div>
          </div>

          {/* Action Button */}
          <button
            onClick={handleProceedToReview}
            disabled={!canProceedToReview}
            className={`px-6 py-2.5 rounded-lg font-medium text-sm transition-colors flex items-center gap-2 ${
              canProceedToReview
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-neutral-100 text-neutral-400 cursor-not-allowed'
            }`}
          >
            进入 Review
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
        summary={`自动化测试全部通过，手动验证已完成。测试覆盖 ${testResults.length} 个测试用例，${checklistItems.filter(item => item.checked !== false).length} 项手动检查已确认。`}
        onConfirm={handleTransitionConfirm}
        onLater={handleTransitionLater}
      />
    </div>
  );
}
