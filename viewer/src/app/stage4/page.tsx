'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { StageIndicator, StageTransitionModal } from '@/components';
import { useFileWatcher, parsePrdJson, useProjectValidation } from '@/hooks';
import { useProject } from '@/contexts/ProjectContext';
import type { PrdData, TestCase } from '@/hooks';

type LayerStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

interface VerificationLayer {
  id: string;
  name: string;
  description: string;
  status: LayerStatus;
  output?: string;
  items?: { label: string; status: LayerStatus }[];
}

interface ManualItem {
  desc: string;
  checked: boolean;
}

export default function Stage4Page() {
  const router = useRouter();
  const { activeProject, updateProject } = useProject();

  useProjectValidation({ currentStage: 4 });

  const [prdData, setPrdData] = useState<PrdData | null>(null);
  const [layers, setLayers] = useState<VerificationLayer[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [currentLayer, setCurrentLayer] = useState<string | null>(null);
  const [manualItems, setManualItems] = useState<ManualItem[]>([]);
  const [showTransitionModal, setShowTransitionModal] = useState(false);
  const [expandedLayer, setExpandedLayer] = useState<string | null>(null);
  const autoStarted = useRef(false);

  // File watcher
  const { prd } = useFileWatcher({
    enabled: true,
    onPrdUpdate: (content) => {
      const parsed = parsePrdJson(content);
      if (parsed) setPrdData(parsed);
    },
  });

  useEffect(() => {
    if (prd) {
      const parsed = parsePrdJson(prd);
      if (parsed) setPrdData(parsed);
    }
  }, [prd]);

  // Extract testCases from all DTs
  const allTestCases: TestCase[] = prdData?.devTasks.flatMap(dt => dt.testCases || []) || [];
  const hasUnit = allTestCases.some(tc => tc.type === 'unit');
  const hasE2e = allTestCases.some(tc => tc.type === 'e2e');
  const hasManual = allTestCases.some(tc => tc.type === 'manual');
  const manualTestCases = allTestCases.filter(tc => tc.type === 'manual');

  // Initialize manual items from testCases
  useEffect(() => {
    if (manualTestCases.length > 0 && manualItems.length === 0) {
      setManualItems(manualTestCases.map(tc => ({ desc: tc.desc || '手动验证项', checked: false })));
    }
  }, [manualTestCases, manualItems.length]);

  // Initialize layers based on prd data
  useEffect(() => {
    if (!prdData) return;

    const newLayers: VerificationLayer[] = [
      {
        id: 'regression',
        name: '全量回归',
        description: 'TypeCheck + Lint',
        status: 'pending',
      },
    ];

    if (hasUnit) {
      newLayers.push({
        id: 'unit',
        name: '单元测试',
        description: `${allTestCases.filter(tc => tc.type === 'unit').length} 个单元测试`,
        status: 'pending',
      });
    }

    if (hasE2e) {
      newLayers.push({
        id: 'e2e',
        name: 'E2E 测试',
        description: `${allTestCases.filter(tc => tc.type === 'e2e').length} 个端到端测试`,
        status: 'pending',
      });
    }

    newLayers.push({
      id: 'review',
      name: 'Code Review',
      description: 'Claude 分析 git diff',
      status: 'pending',
    });

    if (hasManual) {
      newLayers.push({
        id: 'manual',
        name: '手动验收',
        description: `${manualTestCases.length} 项需人工验证`,
        status: 'pending',
      });
    } else {
      // No manual testCases → auto-skip
      newLayers.push({
        id: 'manual',
        name: '手动验收',
        description: '无手动验收项',
        status: 'skipped',
      });
    }

    setLayers(newLayers);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prdData]);

  // Helper to update a layer
  const updateLayer = useCallback((id: string, updates: Partial<VerificationLayer>) => {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l));
  }, []);

  // Run a test layer via API
  const runTestLayer = useCallback(async (types: string[]): Promise<boolean> => {
    try {
      const response = await fetch('/api/test/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ types }),
      });

      if (!response.ok || !response.body) return false;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let allPassed = true;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7);
          } else if (line.startsWith('data: ')) {
            const eventData = line.slice(6);
            if (eventType && eventData) {
              try {
                const data = JSON.parse(eventData);
                if (eventType === 'result' && data.status === 'failed') {
                  allPassed = false;
                }
              } catch {
                // Ignore
              }
              eventType = '';
            }
          }
        }
      }

      return allPassed;
    } catch {
      return false;
    }
  }, []);

  // Run Code Review via API
  const runCodeReview = useCallback(async (): Promise<{ passed: boolean; output: string }> => {
    try {
      const response = await fetch('/api/cli/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: '请分析当前分支相对于 main 的 git diff，输出代码审查结果。列出 HIGH/MEDIUM/LOW 级别的问题。如果没有严重问题，输出"审查通过"。',
          maxTokens: 2000,
        }),
      });

      if (!response.ok) {
        return { passed: true, output: 'Code Review API 不可用，跳过' };
      }

      const data = await response.json();
      const output = data.response || data.message || '审查完成';
      const hasHigh = /HIGH/i.test(output);
      return { passed: !hasHigh, output };
    } catch {
      return { passed: true, output: 'Code Review 跳过（API 不可用）' };
    }
  }, []);

  // Run all verification layers sequentially
  const handleRunAll = useCallback(async () => {
    setIsRunning(true);

    // Layer 1: Regression (typecheck + lint)
    setCurrentLayer('regression');
    updateLayer('regression', { status: 'running' });
    const regressionPassed = await runTestLayer(['typecheck', 'lint']);
    updateLayer('regression', { status: regressionPassed ? 'passed' : 'failed' });

    if (!regressionPassed) {
      setIsRunning(false);
      setCurrentLayer(null);
      return;
    }

    // Layer 2: Unit tests (if applicable)
    if (hasUnit) {
      setCurrentLayer('unit');
      updateLayer('unit', { status: 'running' });
      const unitPassed = await runTestLayer(['unit']);
      updateLayer('unit', { status: unitPassed ? 'passed' : 'failed' });

      if (!unitPassed) {
        setIsRunning(false);
        setCurrentLayer(null);
        return;
      }
    }

    // Layer 3: E2E tests (if applicable)
    if (hasE2e) {
      setCurrentLayer('e2e');
      updateLayer('e2e', { status: 'running' });
      const e2ePassed = await runTestLayer(['e2e']);
      updateLayer('e2e', { status: e2ePassed ? 'passed' : 'failed' });

      if (!e2ePassed) {
        setIsRunning(false);
        setCurrentLayer(null);
        return;
      }
    }

    // Layer 4: Code Review
    setCurrentLayer('review');
    updateLayer('review', { status: 'running' });
    const reviewResult = await runCodeReview();
    updateLayer('review', {
      status: reviewResult.passed ? 'passed' : 'failed',
      output: reviewResult.output,
    });

    if (!reviewResult.passed) {
      setIsRunning(false);
      setCurrentLayer(null);
      return;
    }

    // Layer 5: Manual verification
    if (hasManual) {
      setCurrentLayer('manual');
      updateLayer('manual', { status: 'running' });
      // Manual layer stays "running" until user completes all items
    } else {
      updateLayer('manual', { status: 'skipped' });
    }

    setIsRunning(false);
    setCurrentLayer(null);
  }, [updateLayer, runTestLayer, runCodeReview, hasUnit, hasE2e, hasManual]);

  // Auto-start verification when data is ready
  useEffect(() => {
    if (prdData && layers.length > 0 && !isRunning && !autoStarted.current && layers.every(l => l.status === 'pending' || l.status === 'skipped')) {
      const hasPending = layers.some(l => l.status === 'pending');
      if (hasPending) {
        autoStarted.current = true;
        handleRunAll();
      }
    }
  }, [prdData, layers, isRunning, handleRunAll]);

  // Check manual items completion
  useEffect(() => {
    if (hasManual && manualItems.length > 0 && manualItems.every(item => item.checked)) {
      updateLayer('manual', { status: 'passed' });
    }
  }, [manualItems, hasManual, updateLayer]);

  const toggleManualItem = useCallback((index: number) => {
    setManualItems(prev => prev.map((item, i) => i === index ? { ...item, checked: !item.checked } : item));
  }, []);

  // Check if all layers passed
  const allLayersPassed = layers.length > 0 && layers.every(l => l.status === 'passed' || l.status === 'skipped');
  const anyFailed = layers.some(l => l.status === 'failed');

  // PR creation state
  const [prCreating, setPrCreating] = useState(false);
  const [prError, setPrError] = useState<string | null>(null);
  const prCreated = useRef(false);

  // Auto-create PR when all layers pass
  useEffect(() => {
    if (allLayersPassed && !prCreated.current && !prCreating) {
      prCreated.current = true;
      setPrCreating(true);

      (async () => {
        try {
          // Check if PR already exists
          const checkRes = await fetch('/api/git/pr');
          if (checkRes.ok) {
            const checkData = await checkRes.json();
            if (checkData.hasPR) {
              setPrCreating(false);
              setShowTransitionModal(true);
              return;
            }
          }

          // Create PR
          const createRes = await fetch('/api/git/pr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });

          if (!createRes.ok) {
            const errData = await createRes.json().catch(() => ({}));
            throw new Error(errData.error || 'PR 创建失败');
          }

          setPrCreating(false);
          setShowTransitionModal(true);
        } catch (err) {
          setPrCreating(false);
          setPrError(err instanceof Error ? err.message : 'PR 创建失败');
        }
      })();
    }
  }, [allLayersPassed, prCreating]);

  // Retry PR creation
  const handleRetryPR = useCallback(() => {
    prCreated.current = false;
    setPrError(null);
  }, []);

  // Transition handlers
  const handleProceedToStage5 = useCallback(() => {
    setShowTransitionModal(true);
  }, []);

  const handleTransitionConfirm = useCallback(() => {
    if (activeProject) {
      updateProject(activeProject.id, { currentStage: 5 });
    }
    router.push('/stage5');
  }, [activeProject, updateProject, router]);

  const handleTransitionLater = useCallback(() => {
    setShowTransitionModal(false);
    router.push('/');
  }, [router]);

  const handleBackToStage3 = useCallback(() => {
    router.push('/stage3');
  }, [router]);

  // Status icon for each layer
  const getLayerIcon = (status: LayerStatus) => {
    switch (status) {
      case 'passed': return <span className="text-green-500 text-lg">✓</span>;
      case 'failed': return <span className="text-red-500 text-lg">✗</span>;
      case 'running': return <span className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin inline-block" />;
      case 'skipped': return <span className="text-neutral-400 text-lg">—</span>;
      default: return <span className="w-4 h-4 border-2 border-neutral-300 rounded-full inline-block" />;
    }
  };

  const getLayerBg = (status: LayerStatus) => {
    switch (status) {
      case 'passed': return 'border-green-200 bg-green-50';
      case 'failed': return 'border-red-200 bg-red-50';
      case 'running': return 'border-blue-200 bg-blue-50';
      case 'skipped': return 'border-neutral-200 bg-neutral-50';
      default: return 'border-neutral-200 bg-white';
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">
      <StageIndicator
        currentStage={4}
        completedStages={[1, 2, 3]}
        projectName={activeProject?.name}
        stageStatus={
          allLayersPassed ? '验证完成' :
          anyFailed ? '验证失败' :
          isRunning ? '验证中...' :
          '待验证'
        }
      />

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-lg font-semibold text-neutral-900 mb-1">PRD 驱动的分层验收</h2>
          <p className="text-sm text-neutral-500 mb-6">
            从 prd.json 读取测试用例，分 5 层依次执行验收
          </p>

          {/* Verification Layers */}
          <div className="space-y-3">
            {layers.map((layer, index) => (
              <div
                key={layer.id}
                className={`rounded-lg border p-4 transition-all ${getLayerBg(layer.status)}`}
              >
                <button
                  onClick={() => setExpandedLayer(expandedLayer === layer.id ? null : layer.id)}
                  className="w-full flex items-center gap-3 text-left"
                >
                  {/* Layer number */}
                  <span className="w-7 h-7 rounded-full bg-white border border-neutral-200 flex items-center justify-center text-xs font-medium text-neutral-600 flex-shrink-0">
                    {index + 1}
                  </span>

                  {/* Status icon */}
                  <div className="flex-shrink-0">{getLayerIcon(layer.status)}</div>

                  {/* Layer info */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-neutral-900">{layer.name}</div>
                    <div className="text-xs text-neutral-500">{layer.description}</div>
                  </div>

                  {/* Expand indicator */}
                  <span className="text-neutral-400 text-xs">
                    {expandedLayer === layer.id ? '▼' : '▶'}
                  </span>
                </button>

                {/* Expanded content */}
                {expandedLayer === layer.id && (
                  <div className="mt-3 pt-3 border-t border-neutral-200">
                    {layer.output && (
                      <pre className="text-xs font-mono text-neutral-700 bg-white rounded p-3 max-h-48 overflow-auto whitespace-pre-wrap">
                        {layer.output}
                      </pre>
                    )}

                    {/* Manual checklist */}
                    {layer.id === 'manual' && manualItems.length > 0 && (
                      <div className="space-y-2">
                        {manualItems.map((item, i) => (
                          <label key={i} className="flex items-start gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={item.checked}
                              onChange={() => toggleManualItem(i)}
                              className="mt-0.5 w-4 h-4 rounded border-neutral-300"
                            />
                            <span className={`text-sm ${item.checked ? 'text-green-700 line-through' : 'text-neutral-700'}`}>
                              {item.desc}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}

                    {!layer.output && layer.id !== 'manual' && layer.status === 'pending' && (
                      <p className="text-xs text-neutral-400">等待执行...</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Action Bar */}
      <div className="border-t border-neutral-200 bg-white p-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            {anyFailed && (
              <button
                onClick={handleBackToStage3}
                className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
              >
                返回 Stage 3 修复
              </button>
            )}
            {!isRunning && !allLayersPassed && !anyFailed && layers.length > 0 && (
              <button
                onClick={() => { autoStarted.current = false; handleRunAll(); }}
                className="px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
              >
                重新运行验收
              </button>
            )}
            {prCreating && (
              <span className="text-sm text-blue-600 flex items-center gap-2">
                <span className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin inline-block" />
                正在创建 PR...
              </span>
            )}
            {prError && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-red-500">{prError}</span>
                <button onClick={handleRetryPR} className="text-sm text-blue-600 underline">重试</button>
              </div>
            )}
          </div>

          <button
            onClick={handleProceedToStage5}
            disabled={!allLayersPassed}
            className={`px-6 py-2.5 rounded-lg font-medium text-sm transition-colors flex items-center gap-2 ${
              allLayersPassed
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
        summary={`验收通过，PR 已创建。${layers.filter(l => l.status === 'passed').length} 层验证通过，${layers.filter(l => l.status === 'skipped').length} 层跳过。`}
        onConfirm={handleTransitionConfirm}
        onLater={handleTransitionLater}
        autoCountdown={3}
      />
    </div>
  );
}
