'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  StageIndicator,
  PyramidNavigation,
  PRDPreview,
  StageTransitionModal,
  ConfirmationCard,
  type LevelInfo,
  type CollectedSummaryItem,
} from '@/components';
import { useProject } from '@/contexts/ProjectContext';
import { useProjectValidation, useCliChat } from '@/hooks';
import {
  type AskUserQuestionToolInput,
  type AskUserQuestion,
  type PyramidMetadata,
  type ConfirmationSummary,
  isAskUserQuestionInput,
} from '@/lib/tool-types';

type LevelId = 1 | 2 | 3 | 4 | 5;

interface QuestionAnswer {
  questionId: string;
  value: string | string[];
}

// Q&A history for resume
interface QAHistoryItem {
  level: LevelId;
  question: string;
  answer: string | string[];
}

export default function Stage1Page() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session');

  // Project context
  const { activeProject, updateProject, isLoading: projectsLoading } = useProject();

  // Project validation
  const hasUrlContext = Boolean(sessionId);
  useProjectValidation({ currentStage: 1, skipValidation: hasUrlContext });

  // CLI Chat state
  const [currentLevel, setCurrentLevel] = useState<LevelId>(1);
  const [completedLevels, setCompletedLevels] = useState<LevelId[]>([]);
  const [currentQuestions, setCurrentQuestions] = useState<AskUserQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, QuestionAnswer>>({});
  const [prdDraft, setPrdDraft] = useState<string>('');
  const [collectedSummary, setCollectedSummary] = useState<CollectedSummaryItem[]>([]);
  // Q&A history for resume functionality
  const [qaHistory, setQaHistory] = useState<QAHistoryItem[]>([]);
  // Track current tool being used (for progress feedback)
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  // Track codebase scan status
  const [codebaseScanned, setCodebaseScanned] = useState(false);
  // Confirmation gate state
  const [isConfirmationPhase, setIsConfirmationPhase] = useState(false);
  const [confirmationSummary, setConfirmationSummary] = useState<ConfirmationSummary | null>(null);

  // UI state
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();
  const [showTransitionModal, setShowTransitionModal] = useState(false);
  const [savedPrdId, setSavedPrdId] = useState<string | null>(null);
  const [isStarted, setIsStarted] = useState(false);
  // Track which questions have "Other" selected (for custom text input)
  const [otherSelected, setOtherSelected] = useState<Record<string, boolean>>({});

  // Initial description from Dashboard
  const [initialDescription, setInitialDescription] = useState<string>('');
  // CLI session ID for resuming conversation
  const [cliSessionId, setCliSessionId] = useState<string | undefined>(undefined);
  // Track if we've restored state (use ref to avoid re-renders)
  const hasRestoredStateRef = useRef(false);

  // Storage key for this project's pyramid state
  const storageKey = sessionId ? `botool-pyramid-state-${sessionId}` : null;

  // Load saved state from localStorage on mount (only once)
  useEffect(() => {
    if (!storageKey || hasRestoredStateRef.current) return;
    hasRestoredStateRef.current = true;

    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const state = JSON.parse(saved);
        if (state.cliSessionId) setCliSessionId(state.cliSessionId);
        if (state.currentLevel) setCurrentLevel(state.currentLevel);
        if (state.completedLevels) setCompletedLevels(state.completedLevels);
        if (state.answers) setAnswers(state.answers);
        if (state.prdDraft) setPrdDraft(state.prdDraft);
        if (state.isStarted) setIsStarted(state.isStarted);
        if (state.qaHistory) setQaHistory(state.qaHistory);
        if (state.codebaseScanned) setCodebaseScanned(state.codebaseScanned);
        if (state.isConfirmationPhase) setIsConfirmationPhase(state.isConfirmationPhase);
        if (state.confirmationSummary) setConfirmationSummary(state.confirmationSummary);
        console.log('[Stage1] Restored saved state (once)', { qaHistoryCount: state.qaHistory?.length || 0 });
      } catch (e) {
        console.error('[Stage1] Failed to parse saved state:', e);
      }
    }
  }, [storageKey]);

  // Save state to localStorage whenever it changes (debounced)
  useEffect(() => {
    if (!storageKey || !isStarted || !hasRestoredStateRef.current) return;

    // Debounce saves to prevent excessive writes
    const timeoutId = setTimeout(() => {
      const state = {
        cliSessionId,
        currentLevel,
        completedLevels,
        answers,
        prdDraft,
        isStarted,
        qaHistory,
        codebaseScanned,
        isConfirmationPhase,
        confirmationSummary,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(storageKey, JSON.stringify(state));
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [storageKey, cliSessionId, currentLevel, completedLevels, answers, prdDraft, isStarted, qaHistory, codebaseScanned, isConfirmationPhase, confirmationSummary]);

  // Load initial description from sessionStorage or fallback to project name
  useEffect(() => {
    if (!sessionId) return;
    // First try sessionStorage (set when creating new project)
    const desc = sessionStorage.getItem(`botool-initial-description-${sessionId}`);
    if (desc) {
      setInitialDescription(desc);
      return;
    }
    // Fallback: use project name if available (for existing projects)
    if (activeProject?.name) {
      setInitialDescription(activeProject.name);
    }
  }, [sessionId, activeProject?.name]);

  // Handle tool use from CLI
  const handleToolUse = useCallback((toolUse: { id: string; name: string; input: Record<string, unknown> }) => {
    console.log('[Stage1] Tool use received:', toolUse.name);
    // Track current tool for progress feedback
    setCurrentTool(toolUse.name);

    if (toolUse.name === 'AskUserQuestion' && isAskUserQuestionInput(toolUse.input)) {
      const input = toolUse.input as AskUserQuestionToolInput;
      console.log('[Stage1] AskUserQuestion received, questions:', input.questions.length);
      setCurrentQuestions(input.questions);

      // Update level from metadata
      if (input.metadata) {
        const metadata = input.metadata as PyramidMetadata;
        console.log('[Stage1] Level from metadata:', metadata.level, 'phase:', metadata.phase);
        setCurrentLevel(metadata.level);

        // Track codebase scan status
        if (metadata.codebaseScanned !== undefined) {
          setCodebaseScanned(metadata.codebaseScanned);
        }

        // Detect confirmation phase
        if (metadata.phase === 'confirmation' && metadata.confirmationSummary) {
          setIsConfirmationPhase(true);
          setConfirmationSummary(metadata.confirmationSummary);
        } else {
          setIsConfirmationPhase(false);
          setConfirmationSummary(null);
        }

        // Mark previous levels as completed
        const completed: LevelId[] = [];
        for (let i = 1; i < metadata.level; i++) {
          completed.push(i as LevelId);
        }
        setCompletedLevels(completed);
      }
    }
  }, []);

  // CLI Chat hook
  const {
    messages,
    isLoading,
    error: cliError,
    pendingToolUse,
    sendMessage,
    respondToTool,
    sessionId: currentCliSessionId,
  } = useCliChat({
    mode: 'default',
    initialSessionId: cliSessionId,
    onToolUse: handleToolUse,
    onError: (error) => console.error('CLI error:', error),
    onSessionIdChange: (newSessionId) => {
      console.log('[Stage1] CLI session ID changed:', newSessionId);
      setCliSessionId(newSessionId);
    },
  });

  // Clear current tool when loading stops
  useEffect(() => {
    if (!isLoading) {
      setCurrentTool(null);
    }
  }, [isLoading]);

  // Extract PRD from messages
  useEffect(() => {
    // Look for PRD content in any assistant message
    // The PRD is generated after L4 is completed, look for "# PRD:" marker
    console.log('[Stage1] Checking messages for PRD, count:', messages.length);
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'assistant') {
        console.log('[Stage1] Assistant message preview:', msg.content.slice(0, 100));
        if (msg.content.includes('# PRD:')) {
          // Extract PRD content starting from "# PRD:" to the end
          const prdMatch = msg.content.match(/(# PRD:[\s\S]+)/);
          if (prdMatch) {
            console.log('[Stage1] PRD found!');
            setPrdDraft(prdMatch[1]);
            // Mark all levels as completed when PRD is generated
            setCompletedLevels([1, 2, 3, 4, 5]);
            break;
          }
        }
      }
    }
  }, [messages]);

  // Start pyramid Q&A when description is ready
  const startPyramid = useCallback(() => {
    if (!initialDescription || isStarted) return;
    setIsStarted(true);
    // Trigger the pyramid skill
    sendMessage(`/botoolagent-pyramidprd ${initialDescription}`);
  }, [initialDescription, isStarted, sendMessage]);

  // Resume from saved state - continue from where we left off
  const resumePyramid = useCallback(() => {
    if (!isStarted || isLoading) return;
    // Send a message to continue the conversation
    // The CLI will resume from the saved session if cliSessionId is set
    const resumeMessage = currentLevel === 5 && completedLevels.includes(5)
      ? '请生成 PRD 文档'
      : `请继续 L${currentLevel} 的问答`;
    sendMessage(resumeMessage);
  }, [isStarted, isLoading, currentLevel, completedLevels, sendMessage]);

  // Check if we have saved progress but no current questions (need to resume)
  // L5 (confirmation) completed but no PRD yet - need to request PRD generation
  const needsPrdGeneration = completedLevels.includes(5) && !prdDraft && !isLoading && !cliError;
  const needsResume = isStarted && !isLoading && currentQuestions.length === 0 && !prdDraft && !cliError && !needsPrdGeneration;

  // Debug logging
  console.log('[Stage1] State:', {
    isStarted,
    isLoading,
    currentLevel,
    completedLevels,
    currentQuestionsCount: currentQuestions.length,
    hasPrdDraft: !!prdDraft,
    qaHistoryCount: qaHistory.length,
    cliError,
    needsPrdGeneration,
    needsResume,
    cliSessionId: cliSessionId?.slice(0, 8),
  });

  // Track if we've already attempted to resume/generate (to prevent infinite loops)
  const [hasAttemptedResume, setHasAttemptedResume] = useState(false);
  const [hasAttemptedPrdGeneration, setHasAttemptedPrdGeneration] = useState(false);

  // Auto-generate PRD when L4 is completed but no PRD yet
  useEffect(() => {
    console.log('[Stage1] PRD generation check:', { needsPrdGeneration, cliSessionId: !!cliSessionId, hasAttemptedPrdGeneration, qaHistoryCount: qaHistory.length });
    if (needsPrdGeneration && cliSessionId && !hasAttemptedPrdGeneration && qaHistory.length > 0) {
      console.log('[Stage1] Auto-requesting PRD generation with Q&A history...');
      setHasAttemptedPrdGeneration(true);

      // Build Q&A summary from history
      const qaSummary = qaHistory
        .map((item, idx) => `L${item.level} Q${idx + 1}: ${item.question}\n答案: ${Array.isArray(item.answer) ? item.answer.join(', ') : item.answer}`)
        .join('\n\n');

      sendMessage(`请根据以下金字塔问答内容直接生成 PRD 文档，不要再提问：\n\n${qaSummary}\n\n请直接输出 PRD 文档，格式以 "# PRD:" 开头。`);
    }
  }, [needsPrdGeneration, cliSessionId, hasAttemptedPrdGeneration, sendMessage, qaHistory]);

  // Auto-resume when needed (only once)
  useEffect(() => {
    console.log('[Stage1] Auto-resume check:', { needsResume, cliSessionId: !!cliSessionId, hasAttemptedResume });
    if (needsResume && cliSessionId && !hasAttemptedResume) {
      console.log('[Stage1] Auto-resuming from saved state...');
      setHasAttemptedResume(true);
      resumePyramid();
    }
  }, [needsResume, cliSessionId, hasAttemptedResume, resumePyramid]);

  // Auto-start when description is loaded
  useEffect(() => {
    if (initialDescription && !isStarted && !isLoading) {
      startPyramid();
    }
  }, [initialDescription, isStarted, isLoading, startPyramid]);

  // Handle answer selection
  const handleAnswer = useCallback((questionIndex: number, value: string | string[]) => {
    const question = currentQuestions[questionIndex];
    if (!question) return;

    const questionId = `L${currentLevel}-Q${questionIndex + 1}`;
    setAnswers(prev => ({
      ...prev,
      [questionId]: { questionId, value },
    }));

    // Update collected summary for display
    if (currentLevel === 1 && questionIndex === 1) {
      // Target user question
      setCollectedSummary(prev => {
        const filtered = prev.filter(s => s.dimension !== '目标用户');
        return [...filtered, {
          dimension: '目标用户',
          summary: Array.isArray(value) ? value.join('、') : String(value),
        }];
      });
    }
  }, [currentQuestions, currentLevel]);

  // Submit answers to CLI
  const handleSubmitAnswers = useCallback(() => {
    if (!pendingToolUse) return;

    // Collect all answers for current questions
    const answersToSubmit: Record<string, string | string[]> = {};
    const newHistoryItems: QAHistoryItem[] = [];

    currentQuestions.forEach((q, index) => {
      const questionId = `L${currentLevel}-Q${index + 1}`;
      const answer = answers[questionId];
      if (answer) {
        answersToSubmit[questionId] = answer.value;
        // Add to Q&A history for resume
        newHistoryItems.push({
          level: currentLevel,
          question: q.question,
          answer: answer.value,
        });
      }
    });

    // Update Q&A history
    setQaHistory(prev => [...prev, ...newHistoryItems]);

    // Send response to CLI
    respondToTool(pendingToolUse.id, { answers: answersToSubmit });

    // Mark current level as completed if moving to next
    if (!completedLevels.includes(currentLevel)) {
      setCompletedLevels(prev => [...prev, currentLevel]);
    }

    // Clear current questions and otherSelected state (will be updated by next tool_use)
    setCurrentQuestions([]);
    setOtherSelected({});
  }, [pendingToolUse, currentQuestions, currentLevel, answers, completedLevels, respondToTool]);

  // Check if all current questions are answered
  const allAnswered = useMemo(() => {
    return currentQuestions.every((_, index) => {
      const questionId = `L${currentLevel}-Q${index + 1}`;
      const answer = answers[questionId]?.value;
      // If "Other" is selected, require non-empty text
      if (otherSelected[questionId]) {
        return typeof answer === 'string' && answer.trim().length > 0;
      }
      return answer !== undefined && answer !== '';
    });
  }, [currentQuestions, currentLevel, answers, otherSelected]);

  // Handle confirmation: user confirms and wants PRD generated
  const handleConfirmGenerate = useCallback(() => {
    if (!pendingToolUse) return;
    // Respond with "confirm" selection to the AskUserQuestion tool
    const answersToSubmit: Record<string, string | string[]> = {
      [`L${currentLevel}-Q1`]: '确认并生成 PRD',
    };
    respondToTool(pendingToolUse.id, { answers: answersToSubmit });
    setIsConfirmationPhase(false);
    setConfirmationSummary(null);
    setCurrentQuestions([]);
    if (!completedLevels.includes(currentLevel)) {
      setCompletedLevels(prev => [...prev, currentLevel]);
    }
  }, [pendingToolUse, currentLevel, completedLevels, respondToTool]);

  // Handle revision: user wants to go back and modify
  const handleRevise = useCallback(() => {
    if (!pendingToolUse) return;
    // Respond with "revise" selection
    const answersToSubmit: Record<string, string | string[]> = {
      [`L${currentLevel}-Q1`]: '需要修改',
    };
    respondToTool(pendingToolUse.id, { answers: answersToSubmit });
    setIsConfirmationPhase(false);
    setConfirmationSummary(null);
    setCurrentQuestions([]);
  }, [pendingToolUse, currentLevel, respondToTool]);

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
    return [1, 2, 3, 4, 5].map((level) => {
      const isCompleted = completedLevels.includes(level as LevelId);
      const isCurrent = level === currentLevel;
      const isLocked = level > currentLevel && !completedLevels.includes(level as LevelId);

      let summary: string | undefined;
      if (isCompleted) {
        summary = level === 2 && codebaseScanned ? '已完成 (代码库已分析)' : '已完成';
      } else if (isCurrent && level === 5 && isConfirmationPhase) {
        summary = '待确认';
      }

      return {
        id: level,
        name: `L${level}`,
        status: isCompleted ? 'completed' : isCurrent ? 'current' : 'locked',
        questionsTotal: isCurrent && !isConfirmationPhase ? currentQuestions.length : 0,
        questionsAnswered: isCurrent && !isConfirmationPhase ? Object.keys(answers).filter(k => k.startsWith(`L${level}-`)).length : 0,
        summary,
      };
    }) as LevelInfo[];
  }, [currentLevel, completedLevels, currentQuestions, answers, codebaseScanned, isConfirmationPhase]);

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

      {/* Main Content - Three Column Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Pyramid Navigation */}
        <div className="w-64 flex-shrink-0">
          <PyramidNavigation
            currentLevel={currentLevel}
            levels={levels}
            collectedSummary={collectedSummary}
            codebaseScanned={codebaseScanned}
            onLevelClick={() => {
              // In CLI mode, level navigation is controlled by the Skill
              // So we don't allow manual level switching
            }}
          />
        </div>

        {/* Center: Question Panel */}
        <div className="flex-1 min-w-0 border-x border-neutral-200 bg-white overflow-y-auto">
          {/* Confirmation card - highest priority when in confirmation phase */}
          {isConfirmationPhase && confirmationSummary ? (
            <ConfirmationCard
              summary={confirmationSummary}
              onConfirm={handleConfirmGenerate}
              onRevise={handleRevise}
              isLoading={isLoading}
            />
          ) : /* PRD generation in progress */
          isLoading && completedLevels.includes(5) && currentQuestions.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="animate-spin h-8 w-8 border-4 border-green-600 border-t-transparent rounded-full mx-auto mb-2"></div>
                <p className="text-sm text-neutral-600">正在生成 PRD 文档...</p>
                <p className="text-xs text-neutral-400 mt-1">
                  {currentTool
                    ? `正在执行: ${currentTool}`
                    : '所有层级已完成，请稍候'}
                </p>
              </div>
            </div>
          ) : isLoading && currentQuestions.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-2"></div>
                <p className="text-sm text-neutral-600">AI 正在思考...</p>
              </div>
            </div>
          ) : cliError ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-red-600">
                <p className="text-lg font-medium mb-2">出错了</p>
                <p className="text-sm">{cliError}</p>
                <button
                  onClick={() => window.location.reload()}
                  className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  重试
                </button>
              </div>
            </div>
          ) : currentQuestions.length > 0 ? (
            <div className="p-6 space-y-6">
              {/* Level Header */}
              <div className="border-b border-neutral-200 pb-4">
                <h2 className="text-xl font-semibold text-neutral-900">
                  L{currentLevel}: {currentLevel === 1 ? '核心识别' : currentLevel === 2 ? '领域分支' : currentLevel === 3 ? '细节深入' : currentLevel === 4 ? '边界确认' : '确认门控'}
                </h2>
                <p className="text-sm text-neutral-500 mt-1">
                  {currentLevel === 1 && '理解需求的本质和范围'}
                  {currentLevel === 2 && '按领域深入探索具体需求'}
                  {currentLevel === 3 && '深入实现细节'}
                  {currentLevel === 4 && '确认范围边界，防止范围蔓延'}
                  {currentLevel === 5 && '确认需求摘要，准备生成 PRD'}
                </p>
              </div>

              {/* Questions */}
              <div className="space-y-6">
                {currentQuestions.map((question, index) => {
                  const questionId = `L${currentLevel}-Q${index + 1}`;
                  const currentAnswer = answers[questionId]?.value;

                  return (
                    <div key={questionId} className="bg-neutral-50 rounded-lg p-4">
                      <div className="flex items-start gap-3 mb-3">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-sm font-medium flex items-center justify-center">
                          {index + 1}
                        </span>
                        <div>
                          <p className="font-medium text-neutral-900">{question.question}</p>
                          {question.header && (
                            <span className="inline-block mt-1 px-2 py-0.5 bg-neutral-200 text-neutral-600 text-xs rounded">
                              {question.header}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Options */}
                      {question.options && question.options.length > 0 ? (
                        <div className="ml-9 space-y-2">
                          {question.options.map((option, optIndex) => {
                            const isOtherMode = otherSelected[questionId];
                            const isSelected = !isOtherMode && (question.multiSelect
                              ? Array.isArray(currentAnswer) && currentAnswer.includes(option.label)
                              : currentAnswer === option.label);

                            return (
                              <button
                                key={optIndex}
                                onClick={() => {
                                  // Clear "Other" mode when selecting a predefined option
                                  setOtherSelected(prev => ({ ...prev, [questionId]: false }));
                                  if (question.multiSelect) {
                                    const current = Array.isArray(currentAnswer) ? currentAnswer : [];
                                    const newValue = isSelected
                                      ? current.filter(v => v !== option.label)
                                      : [...current, option.label];
                                    handleAnswer(index, newValue);
                                  } else {
                                    handleAnswer(index, option.label);
                                  }
                                }}
                                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                                  isSelected
                                    ? 'border-blue-500 bg-blue-50 text-blue-900'
                                    : 'border-neutral-200 bg-white hover:border-neutral-300'
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <span className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                                    isSelected ? 'border-blue-500 bg-blue-500' : 'border-neutral-300'
                                  }`}>
                                    {isSelected && (
                                      <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                      </svg>
                                    )}
                                  </span>
                                  <div>
                                    <span className="font-medium">{option.label}</span>
                                    {option.description && (
                                      <p className="text-sm text-neutral-500 mt-0.5">{option.description}</p>
                                    )}
                                  </div>
                                </div>
                              </button>
                            );
                          })}

                          {/* "Other" option with text input */}
                          {!question.multiSelect && (
                            <div className="space-y-2">
                              <button
                                onClick={() => {
                                  setOtherSelected(prev => ({ ...prev, [questionId]: true }));
                                  // Clear the answer so user can type custom value
                                  handleAnswer(index, '');
                                }}
                                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                                  otherSelected[questionId]
                                    ? 'border-blue-500 bg-blue-50 text-blue-900'
                                    : 'border-neutral-200 bg-white hover:border-neutral-300'
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <span className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                                    otherSelected[questionId] ? 'border-blue-500 bg-blue-500' : 'border-neutral-300'
                                  }`}>
                                    {otherSelected[questionId] && (
                                      <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                      </svg>
                                    )}
                                  </span>
                                  <div>
                                    <span className="font-medium">其他</span>
                                    <p className="text-sm text-neutral-500 mt-0.5">输入自定义答案</p>
                                  </div>
                                </div>
                              </button>

                              {/* Text input when "Other" is selected */}
                              {otherSelected[questionId] && (
                                <textarea
                                  value={typeof currentAnswer === 'string' ? currentAnswer : ''}
                                  onChange={(e) => handleAnswer(index, e.target.value)}
                                  placeholder="请输入你的答案..."
                                  className="w-full p-3 border border-blue-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                  rows={2}
                                  autoFocus
                                />
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        // Text input for questions without options
                        <div className="ml-9">
                          <textarea
                            value={typeof currentAnswer === 'string' ? currentAnswer : ''}
                            onChange={(e) => handleAnswer(index, e.target.value)}
                            placeholder={question.placeholder || '请输入...'}
                            className="w-full p-3 border border-neutral-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                            rows={3}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Submit Button */}
              <div className="pt-4 border-t border-neutral-200">
                <button
                  onClick={handleSubmitAnswers}
                  disabled={!allAnswered || isLoading}
                  className={`w-full py-3 rounded-lg font-medium transition-colors ${
                    allAnswered && !isLoading
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
                  }`}
                >
                  {isLoading ? '处理中...' : currentLevel < 4 ? '继续下一层' : currentLevel === 4 ? '进入确认' : '确认并生成 PRD'}
                </button>
              </div>
            </div>
          ) : prdDraft ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-lg font-medium text-neutral-900">PRD 已生成</p>
                <p className="text-sm text-neutral-500 mt-1">请查看右侧预览并保存</p>
              </div>
            </div>
          ) : needsResume ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-2"></div>
                <p className="text-sm text-neutral-600">正在恢复进度...</p>
                <p className="text-xs text-neutral-400 mt-1">
                  L{currentLevel} · 已完成 {completedLevels.length} 层
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-neutral-500">等待问题加载...</p>
            </div>
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
