'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  StageIndicator,
  PyramidNavigation,
  LevelPanel,
  PRDPreview,
  StageTransitionModal,
  type LevelInfo,
  type CollectedSummaryItem,
  type Dimension,
  type Question,
  type Answer,
} from '@/components';
import { useProject } from '@/contexts/ProjectContext';
import { useProjectValidation } from '@/hooks';
import {
  loadPyramidProgress,
  savePyramidProgress,
  savePyramidProgressImmediate,
  type PyramidSession,
} from '@/lib/pyramid-session-storage';
import { type LevelId, getActiveDimensions, L2_DIMENSIONS } from '@/lib/dimension-framework';

export default function Stage1Page() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session');

  // Project context
  const { activeProject, updateProject, isLoading: projectsLoading } = useProject();

  // Project validation
  const hasUrlContext = Boolean(sessionId);
  useProjectValidation({ currentStage: 1, skipValidation: hasUrlContext });

  // Pyramid state
  const [currentLevel, setCurrentLevel] = useState<LevelId>(1);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [generatedQuestions, setGeneratedQuestions] = useState<Partial<Record<LevelId, Question[]>>>({});
  const [activeDimensions, setActiveDimensions] = useState<string[]>([]);
  const [prdDraft, setPrdDraft] = useState<string>('');

  // UI state
  const [isLoadingQuestions, setIsLoadingQuestions] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();
  const [showTransitionModal, setShowTransitionModal] = useState(false);
  const [savedPrdId, setSavedPrdId] = useState<string | null>(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  // Initial description from Dashboard
  const [initialDescription, setInitialDescription] = useState<string>('');
  const [requirementType, setRequirementType] = useState<string>('新功能');

  // Load saved progress and initial description
  useEffect(() => {
    if (!sessionId) return;

    // Load initial description from sessionStorage
    const desc = sessionStorage.getItem(`botool-initial-description-${sessionId}`);
    const type = sessionStorage.getItem(`botool-requirement-type-${sessionId}`);
    if (desc) setInitialDescription(desc);
    if (type) setRequirementType(type);

    // Load saved pyramid progress
    const saved = loadPyramidProgress(sessionId);
    if (saved) {
      setCurrentLevel(saved.currentLevel);
      // Convert answers to proper format
      const convertedAnswers: Record<string, Answer> = {};
      Object.entries(saved.answers).forEach(([key, value]) => {
        convertedAnswers[key] = { questionId: key, value };
      });
      setAnswers(convertedAnswers);
      setGeneratedQuestions(saved.generatedQuestions as Partial<Record<LevelId, Question[]>>);
      setActiveDimensions(saved.activeDimensions);
      setPrdDraft(saved.prdDraft);
    }
  }, [sessionId]);

  // Generate L1 questions on first load
  useEffect(() => {
    if (!sessionId || !initialDescription) return;
    if (generatedQuestions[1] && generatedQuestions[1].length > 0) return;

    generateQuestions(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, initialDescription]);

  // Generate questions for a level
  const generateQuestions = useCallback(async (level: LevelId) => {
    if (!sessionId) return;

    setIsLoadingQuestions(true);
    try {
      const response = await fetch('/api/pyramid/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level,
          collectedAnswers: Object.fromEntries(
            Object.entries(answers).map(([k, v]) => [k, v.value])
          ),
          activeDimensions,
          requirementType,
          initialDescription,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setGeneratedQuestions(prev => ({
          ...prev,
          [level]: data.questions,
        }));

        // Update active dimensions if suggested
        if (data.suggestedDimensions && level === 2) {
          setActiveDimensions(data.suggestedDimensions);
        }

        // Save to localStorage
        savePyramidProgressImmediate(sessionId, {
          generatedQuestions: {
            ...generatedQuestions,
            [level]: data.questions,
          },
        });
      }
    } catch (error) {
      console.error('Failed to generate questions:', error);
    } finally {
      setIsLoadingQuestions(false);
    }
  }, [sessionId, answers, activeDimensions, requirementType, initialDescription, generatedQuestions]);

  // Handle answer
  const handleAnswer = useCallback((questionId: string, value: string | string[]) => {
    if (!sessionId) return;

    const newAnswers = {
      ...answers,
      [questionId]: { questionId, value },
    };
    setAnswers(newAnswers);

    // Auto-save (debounced)
    setAutoSaveStatus('saving');
    savePyramidProgress(sessionId, {
      answers: Object.fromEntries(
        Object.entries(newAnswers).map(([k, v]) => [k, v.value])
      ),
    });
    setTimeout(() => setAutoSaveStatus('saved'), 600);
  }, [sessionId, answers]);

  // Handle level complete
  const handleLevelComplete = useCallback(async () => {
    if (!sessionId) return;

    if (currentLevel < 4) {
      const nextLevel = (currentLevel + 1) as LevelId;
      setCurrentLevel(nextLevel);
      savePyramidProgressImmediate(sessionId, { currentLevel: nextLevel });

      // Generate questions for next level
      await generateQuestions(nextLevel);
    } else {
      // L4 complete - generate PRD
      await generatePrd();
    }
  }, [sessionId, currentLevel, generateQuestions]);

  // Generate PRD from collected answers
  const generatePrd = useCallback(async () => {
    if (!sessionId) return;

    setIsLoadingQuestions(true);
    try {
      // For now, create a basic PRD from answers
      const prd = buildPrdFromAnswers();
      setPrdDraft(prd);
      savePyramidProgressImmediate(sessionId, { prdDraft: prd });
    } finally {
      setIsLoadingQuestions(false);
    }
  }, [sessionId, answers, initialDescription, requirementType]);

  // Build PRD from answers
  const buildPrdFromAnswers = useCallback(() => {
    const projectName = activeProject?.name || '未命名项目';
    const lines: string[] = [];

    lines.push(`# PRD: ${projectName}`);
    lines.push('');
    lines.push('## 项目概述');
    lines.push('');
    lines.push(initialDescription);
    lines.push('');
    lines.push(`**需求类型**: ${requirementType}`);
    lines.push('');

    // Extract key info from answers
    const targetUser = answers['l1-q1']?.value;
    const coreProblem = answers['l1-q2']?.value;
    const successCriteria = answers['l1-q3']?.value;

    if (targetUser) {
      lines.push('## 目标用户');
      lines.push('');
      lines.push(Array.isArray(targetUser) ? targetUser.join('、') : String(targetUser));
      lines.push('');
    }

    if (coreProblem) {
      lines.push('## 核心问题');
      lines.push('');
      lines.push(String(coreProblem));
      lines.push('');
    }

    if (successCriteria) {
      lines.push('## 成功标准');
      lines.push('');
      lines.push(String(successCriteria));
      lines.push('');
    }

    // Add more sections based on L2-L4 answers
    lines.push('## 功能需求');
    lines.push('');
    lines.push('_根据问答收集的信息生成..._');
    lines.push('');

    lines.push('## 非目标（Out of Scope）');
    lines.push('');
    const outScope = answers['l4-q1']?.value;
    if (outScope && Array.isArray(outScope)) {
      outScope.forEach(item => lines.push(`- ${item}`));
    } else {
      lines.push('_待补充_');
    }
    lines.push('');

    lines.push('## 验收标准');
    lines.push('');
    const acceptance = answers['l4-q2']?.value;
    if (acceptance) {
      lines.push(String(acceptance));
    } else {
      lines.push('_待补充_');
    }

    return lines.join('\n');
  }, [answers, initialDescription, requirementType, activeProject]);

  // Handle save PRD
  const handleSavePRD = useCallback(async () => {
    if (!prdDraft || isSaving) return;

    setIsSaving(true);
    setSaveError(undefined);

    try {
      const response = await fetch('/api/prd/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: prdDraft }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save PRD');
      }

      if (activeProject) {
        updateProject(activeProject.id, { prdId: data.id });
      }

      setSavedPrdId(data.id);
      setSaveSuccess(true);
      setShowTransitionModal(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save PRD');
    } finally {
      setIsSaving(false);
    }
  }, [prdDraft, isSaving, activeProject, updateProject]);

  // Handle transition
  const handleTransitionConfirm = useCallback(() => {
    if (activeProject) {
      updateProject(activeProject.id, { currentStage: 2 });
    }
    router.push(`/stage2?prd=${savedPrdId}`);
  }, [activeProject, updateProject, router, savedPrdId]);

  const handleTransitionLater = useCallback(() => {
    setShowTransitionModal(false);
    router.push('/');
  }, [router]);

  // Build level info for navigation
  const levels: LevelInfo[] = useMemo(() => {
    return [1, 2, 3, 4].map((level) => {
      const questions = generatedQuestions[level as LevelId] || [];
      const answered = questions.filter(q => answers[q.id]).length;
      const isCompleted = level < currentLevel;
      const isCurrent = level === currentLevel;
      const isLocked = level > currentLevel;

      return {
        id: level,
        name: `L${level}`,
        status: isCompleted ? 'completed' : isCurrent ? 'current' : 'locked',
        questionsTotal: questions.length,
        questionsAnswered: answered,
        summary: isCompleted ? `${answered} 个问题已回答` : undefined,
      };
    }) as LevelInfo[];
  }, [currentLevel, generatedQuestions, answers]);

  // Build collected summary
  const collectedSummary: CollectedSummaryItem[] = useMemo(() => {
    const items: CollectedSummaryItem[] = [];

    // Extract key summaries from answers
    if (answers['l1-q1']) {
      const val = answers['l1-q1'].value;
      items.push({
        dimension: '目标用户',
        summary: Array.isArray(val) ? val.join('、') : String(val),
      });
    }

    if (activeDimensions.length > 0) {
      items.push({
        dimension: '涉及领域',
        summary: activeDimensions.map(d =>
          L2_DIMENSIONS.find(dim => dim.id === d)?.name || d
        ).join('、'),
      });
    }

    return items;
  }, [answers, activeDimensions]);

  // Build dimensions for current level
  const currentDimensions: Dimension[] = useMemo(() => {
    if (currentLevel === 1 || currentLevel === 4) {
      // L1 and L4 have single "default" dimension
      return [{ id: 'default', name: '核心问题', isLocked: false }];
    }

    // L2 and L3 have multiple dimensions
    return activeDimensions.length > 0
      ? activeDimensions.map(id => {
          const dim = L2_DIMENSIONS.find(d => d.id === id);
          return {
            id,
            name: dim?.name || id,
            isLocked: false,
          };
        })
      : L2_DIMENSIONS.slice(0, 2).map(d => ({
          id: d.id,
          name: d.name,
          isLocked: false,
        }));
  }, [currentLevel, activeDimensions]);

  // Group questions by dimension
  const questionsByDimension: Record<string, Question[]> = useMemo(() => {
    const questions = generatedQuestions[currentLevel] || [];
    const grouped: Record<string, Question[]> = {};

    questions.forEach(q => {
      const dim = (q as Question & { dimension?: string }).dimension || 'default';
      if (!grouped[dim]) grouped[dim] = [];
      grouped[dim].push(q);
    });

    // Ensure all dimensions have entries
    currentDimensions.forEach(d => {
      if (!grouped[d.id]) grouped[d.id] = [];
    });

    return grouped;
  }, [currentLevel, generatedQuestions, currentDimensions]);

  // Project name
  const projectName = activeProject?.name || '新项目';

  // Stage status
  const stageStatus = prdDraft
    ? '已生成 PRD'
    : `L${currentLevel} 进行中`;

  // Redirect if no session
  if (!sessionId && !projectsLoading) {
    return (
      <div className="flex flex-col h-full bg-white">
        <StageIndicator currentStage={1} completedStages={[]} />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-neutral-500">正在跳转...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-neutral-50">
      {/* Stage Indicator */}
      <StageIndicator
        currentStage={1}
        completedStages={[]}
        projectName={projectName}
        stageStatus={stageStatus}
      />

      {/* Stage Transition Modal */}
      <StageTransitionModal
        isOpen={showTransitionModal}
        fromStage={1}
        toStage={2}
        summary="PRD 已生成，可以开始将需求转换为开发任务。"
        onConfirm={handleTransitionConfirm}
        onLater={handleTransitionLater}
      />

      {/* Auto-save indicator */}
      {autoSaveStatus !== 'idle' && (
        <div className="absolute top-16 right-4 z-10">
          <span className={`text-xs px-2 py-1 rounded ${
            autoSaveStatus === 'saving'
              ? 'bg-yellow-100 text-yellow-700'
              : 'bg-green-100 text-green-700'
          }`}>
            {autoSaveStatus === 'saving' ? '保存中...' : '已自动保存'}
          </span>
        </div>
      )}

      {/* Main Content - Three Column Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Pyramid Navigation */}
        <div className="w-64 flex-shrink-0">
          <PyramidNavigation
            currentLevel={currentLevel}
            levels={levels}
            collectedSummary={collectedSummary}
            onLevelClick={(level) => {
              if (level <= currentLevel) {
                setCurrentLevel(level as LevelId);
              }
            }}
          />
        </div>

        {/* Center: Level Panel */}
        <div className="flex-1 min-w-0 border-x border-neutral-200 bg-white">
          {isLoadingQuestions ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-2"></div>
                <p className="text-sm text-neutral-600">正在生成问题...</p>
              </div>
            </div>
          ) : (
            <LevelPanel
              level={currentLevel}
              levelName={`L${currentLevel}`}
              dimensions={currentDimensions}
              questions={questionsByDimension}
              answers={answers}
              onAnswer={handleAnswer}
              onComplete={handleLevelComplete}
            />
          )}
        </div>

        {/* Right: PRD Preview */}
        <div className="w-96 flex-shrink-0">
          <PRDPreview
            content={prdDraft || '完成所有层级的问答后，这里将显示生成的 PRD 预览。'}
            onSave={handleSavePRD}
            isSaving={isSaving}
            saveSuccess={saveSuccess}
            saveError={saveError}
          />
        </div>
      </div>
    </div>
  );
}
