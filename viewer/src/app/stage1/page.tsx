'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  StageIndicator,
  PyramidNavigation,
  PRDPreview,
  StageTransitionModal,
  type LevelInfo,
  type CollectedSummaryItem,
} from '@/components';
import { useProject } from '@/contexts/ProjectContext';
import { useProjectValidation, useCliChat } from '@/hooks';
import {
  type AskUserQuestionToolInput,
  type AskUserQuestion,
  type PyramidMetadata,
  isAskUserQuestionInput,
} from '@/lib/tool-types';

type LevelId = 1 | 2 | 3 | 4;

interface QuestionAnswer {
  questionId: string;
  value: string | string[];
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
    if (toolUse.name === 'AskUserQuestion' && isAskUserQuestionInput(toolUse.input)) {
      const input = toolUse.input as AskUserQuestionToolInput;
      setCurrentQuestions(input.questions);

      // Update level from metadata
      if (input.metadata) {
        const metadata = input.metadata as PyramidMetadata;
        setCurrentLevel(metadata.level);

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
  } = useCliChat({
    mode: 'default',
    onToolUse: handleToolUse,
    onError: (error) => console.error('CLI error:', error),
  });

  // Extract PRD from messages
  useEffect(() => {
    // Look for PRD content in any assistant message
    // The PRD is generated after L4 is completed, look for "# PRD:" marker
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'assistant' && msg.content.includes('# PRD:')) {
        // Extract PRD content starting from "# PRD:" to the end
        const prdMatch = msg.content.match(/(# PRD:[\s\S]+)/);
        if (prdMatch) {
          setPrdDraft(prdMatch[1]);
          // Mark all levels as completed when PRD is generated
          setCompletedLevels([1, 2, 3, 4]);
          break;
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
    currentQuestions.forEach((q, index) => {
      const questionId = `L${currentLevel}-Q${index + 1}`;
      const answer = answers[questionId];
      if (answer) {
        answersToSubmit[questionId] = answer.value;
      }
    });

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
      const isCompleted = completedLevels.includes(level as LevelId);
      const isCurrent = level === currentLevel;
      const isLocked = level > currentLevel && !completedLevels.includes(level as LevelId);

      return {
        id: level,
        name: `L${level}`,
        status: isCompleted ? 'completed' : isCurrent ? 'current' : 'locked',
        questionsTotal: isCurrent ? currentQuestions.length : 0,
        questionsAnswered: isCurrent ? Object.keys(answers).filter(k => k.startsWith(`L${level}-`)).length : 0,
        summary: isCompleted ? '已完成' : undefined,
      };
    }) as LevelInfo[];
  }, [currentLevel, completedLevels, currentQuestions, answers]);

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
            onLevelClick={() => {
              // In CLI mode, level navigation is controlled by the Skill
              // So we don't allow manual level switching
            }}
          />
        </div>

        {/* Center: Question Panel */}
        <div className="flex-1 min-w-0 border-x border-neutral-200 bg-white overflow-y-auto">
          {isLoading && currentQuestions.length === 0 ? (
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
                  L{currentLevel}: {currentLevel === 1 ? '核心识别' : currentLevel === 2 ? '领域分支' : currentLevel === 3 ? '细节深入' : '边界确认'}
                </h2>
                <p className="text-sm text-neutral-500 mt-1">
                  {currentLevel === 1 && '理解需求的本质和范围'}
                  {currentLevel === 2 && '按领域深入探索具体需求'}
                  {currentLevel === 3 && '深入实现细节'}
                  {currentLevel === 4 && '确认范围边界，防止范围蔓延'}
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
                  {isLoading ? '处理中...' : currentLevel < 4 ? '继续下一层' : '生成 PRD'}
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
