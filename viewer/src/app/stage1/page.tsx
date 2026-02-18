'use client';

const isDev = process.env.NODE_ENV === 'development';
const debugLog = (...args: unknown[]) => { if (isDev) console.log(...args); };

import { Suspense, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  StageIndicator,
  PyramidNavigation,
  PRDPreview,
  StageTransitionModal,
  ConfirmationCard,
  ModeSelector,
  type LevelInfo,
  type CollectedSummaryItem,
} from '@/components';
import { ErrorRecovery } from '@/components/ErrorRecovery';
import { TerminalActivityFeed, formatTerminalLine } from '@/components/TerminalActivityFeed';
import { useProject } from '@/contexts/ProjectContext';
import { useRequirement } from '@/contexts/RequirementContext';
import { useProjectValidation, useCliChat } from '@/hooks';
import {
  type AskUserQuestionToolInput,
  type AskUserQuestion,
  type PyramidMetadata,
  type ConfirmationSummary,
  type PipelineMode,
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

function Stage1PageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Requirement context - resolve `req` param first
  const { requirements } = useRequirement();
  const reqId = searchParams.get('req') || undefined;
  const activeRequirement = reqId ? requirements.find(r => r.id === reqId) : undefined;

  // Resolve sessionId: explicit `session` param takes priority, then req.prdSessionId
  const rawSessionId = searchParams.get('session');
  const sessionId = rawSessionId ?? (activeRequirement?.prdSessionId ?? null);

  // Resolve mode and file: explicit URL params take priority, then req fields
  const rawUrlMode = searchParams.get('mode');
  const rawUrlFile = searchParams.get('file');
  const urlMode = rawUrlMode ?? (activeRequirement?.sourceFile ? 'transform' : null);
  const urlFile = rawUrlFile ?? activeRequirement?.sourceFile ?? null;

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
  // Track tool call count and recent tools for activity feed
  const [toolCallCount, setToolCallCount] = useState(0);
  const [recentTools, setRecentTools] = useState<string[]>([]);
  // Terminal-like activity log lines
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  // Track codebase scan status
  const [codebaseScanned, setCodebaseScanned] = useState(false);
  // Confirmation gate state
  const [isConfirmationPhase, setIsConfirmationPhase] = useState(false);
  const [confirmationSummary, setConfirmationSummary] = useState<ConfirmationSummary | null>(null);
  // Track PRD file written by Write/Bash tool (for file-based PRD detection)
  const [writtenPrdFileId, setWrittenPrdFileId] = useState<string | null>(null);

  // UI state
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();
  const [showTransitionModal, setShowTransitionModal] = useState(false);
  const [savedPrdId, setSavedPrdId] = useState<string | null>(null);
  const [isStarted, setIsStarted] = useState(false);
  // Track which questions have "Other" selected (for custom text input)
  const [otherSelected, setOtherSelected] = useState<Record<string, boolean>>({});

  // Mode selection state
  const [selectedMode, setSelectedMode] = useState<PipelineMode | null>(null);
  // Quick fix description (for quick mode simplified input)
  const [quickFixDescription, setQuickFixDescription] = useState<string>('');
  // Transform mode: source PRD file path
  const [transformFilePath, setTransformFilePath] = useState<string>('');

  // Initial description from Dashboard
  const [initialDescription, setInitialDescription] = useState<string>('');
  // CLI session ID for resuming conversation
  const [cliSessionId, setCliSessionId] = useState<string | undefined>(undefined);
  // Track if we've restored state (use ref to avoid re-renders)
  const hasRestoredStateRef = useRef(false);
  // Ref for selectedMode to avoid stale closure in handleToolUse callback
  const selectedModeRef = useRef(selectedMode);
  selectedModeRef.current = selectedMode;

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
        if (state.selectedMode) setSelectedMode(state.selectedMode);
        if (state.writtenPrdFileId) setWrittenPrdFileId(state.writtenPrdFileId);
        debugLog('[Stage1] Restored saved state (once)', { qaHistoryCount: state.qaHistory?.length || 0 });
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
        selectedMode,
        writtenPrdFileId,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(storageKey, JSON.stringify(state));
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [storageKey, cliSessionId, currentLevel, completedLevels, answers, prdDraft, isStarted, qaHistory, codebaseScanned, isConfirmationPhase, confirmationSummary, selectedMode, writtenPrdFileId]);

  // Auto-set transform mode from URL params (import flow)
  useEffect(() => {
    if (urlMode === 'transform' && urlFile && !selectedMode && !isStarted) {
      setSelectedMode('transform');
      setTransformFilePath(urlFile);
      setInitialDescription(urlFile);
    }
  }, [urlMode, urlFile, selectedMode, isStarted]);

  // Load initial description from sessionStorage or fallback to project name
  useEffect(() => {
    if (!sessionId) return;
    // Skip if already set by URL params (import flow)
    if (urlMode === 'transform' && urlFile) return;
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
  }, [sessionId, activeProject?.name, urlMode, urlFile]);

  // Redirect invalid direct access without session context
  useEffect(() => {
    if (!sessionId && !projectsLoading) {
      router.replace('/');
    }
  }, [sessionId, projectsLoading, router]);

  // Handle tool use from CLI
  const handleToolUse = useCallback((toolUse: { id: string; name: string; input: Record<string, unknown> }) => {
    debugLog('[Stage1] Tool use received:', toolUse.name);
    // Track current tool for progress feedback
    setCurrentTool(toolUse.name);
    setToolCallCount(prev => prev + 1);
    setRecentTools(prev => [...prev.slice(-4), toolUse.name]);
    // Build terminal-like log line
    setTerminalLines(prev => [...prev.slice(-19), formatTerminalLine(toolUse.name, toolUse.input)]);

    // Detect Write tool writing a PRD file (Transform mode writes PRD to file)
    // Exclude marker files (导入转换中) from detection
    if (toolUse.name === 'Write' && typeof toolUse.input?.file_path === 'string') {
      const fp = toolUse.input.file_path as string;
      const match = fp.match(/(?:^|\/)(prd-[^/]+)\.md$/);
      if (match) {
        const prdId = match[1].replace(/^prd-/, '');
        if (!prdId.includes('导入转换中')) {
          debugLog('[Stage1] Detected Write to PRD file:', prdId);
          setWrittenPrdFileId(prdId);
        } else {
          debugLog('[Stage1] Ignoring marker file Write:', prdId);
        }
      }
    }

    // Detect Bash tool that might write a PRD file (e.g. cat > tasks/prd-xxx.md)
    // Exclude marker files (导入转换中) from detection
    if (toolUse.name === 'Bash' && typeof toolUse.input?.command === 'string') {
      const cmd = toolUse.input.command as string;
      const match = cmd.match(/prd-([a-zA-Z0-9_\u4e00-\u9fff-]+)\.md/);
      if (match && (cmd.includes('>') || cmd.includes('tee') || cmd.includes('cat')) && !match[1].includes('导入转换中')) {
        debugLog('[Stage1] Detected Bash writing PRD file:', match[1]);
        setWrittenPrdFileId(match[1]);
      }
    }

    if (toolUse.name === 'AskUserQuestion' && isAskUserQuestionInput(toolUse.input)) {
      const input = toolUse.input as AskUserQuestionToolInput;
      debugLog('[Stage1] AskUserQuestion received, questions:', input.questions.length);
      setCurrentQuestions(input.questions);

      // Update level from metadata
      if (input.metadata) {
        const metadata = input.metadata as PyramidMetadata;
        let inferredLevel = metadata.level;

        // Transform mode: infer correct level from metadata.transformPhase or question content
        // The AI sometimes sends incorrect level metadata in transform mode
        if (selectedModeRef.current === 'transform') {
          const questionText = input.questions.map(q => q.question).join(' ');

          if (metadata.transformPhase === 'gap-analysis' || questionText.includes('覆盖度') || questionText.includes('覆盖') || questionText.includes('coverage')) {
            inferredLevel = 2 as LevelId; // T2 覆盖度分析
          } else if (metadata.transformPhase === 'targeted-qa' || questionText.includes('Transform T4') || questionText.includes('补充问答')) {
            inferredLevel = 3 as LevelId; // T3 补充问答
          } else if (metadata.transformPhase === 'dt-decomposition' || questionText.includes('DT 分解') || questionText.includes('任务拆解')) {
            inferredLevel = 4 as LevelId; // T4 需求分解
          } else if (questionText.includes('L5') || questionText.includes('Tab 1/4') || questionText.includes('Tab 1/') || metadata.round) {
            inferredLevel = 5 as LevelId; // T5 确认生成
          }

          if (inferredLevel !== metadata.level) {
            debugLog('[Stage1] Transform mode level corrected:', metadata.level, '->', inferredLevel);
          }
        }

        debugLog('[Stage1] Level from metadata:', metadata.level, 'inferred:', inferredLevel, 'phase:', metadata.phase);
        setCurrentLevel(inferredLevel);

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
        for (let i = 1; i < inferredLevel; i++) {
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
    connectionState,
    reconnectAttempt,
    sendMessage,
    respondToTool,
    resetSession,
  } = useCliChat({
    mode: 'default',
    initialSessionId: cliSessionId,
    onToolUse: handleToolUse,
    onError: (error) => console.error('CLI error:', error),
    onSessionIdChange: (newSessionId) => {
      debugLog('[Stage1] CLI session ID changed:', newSessionId);
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
    debugLog('[Stage1] Checking messages for PRD, count:', messages.length);
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'assistant') {
        debugLog('[Stage1] Assistant message preview:', msg.content.slice(0, 100));
        if (msg.content.includes('# PRD:')) {
          // Extract PRD content starting from "# PRD:" to the end
          const prdMatch = msg.content.match(/(# PRD:[\s\S]+)/);
          if (prdMatch) {
            debugLog('[Stage1] PRD found!');
            setPrdDraft(prdMatch[1]);
            // Mark all levels as completed when PRD is generated
            setCompletedLevels([1, 2, 3, 4, 5]);
            break;
          }
        }
      }
    }
  }, [messages]);

  // File-based PRD detection: when Write/Bash wrote a PRD file, fetch its content
  useEffect(() => {
    if (!writtenPrdFileId || prdDraft) return;
    debugLog('[Stage1] Fetching PRD file content for:', writtenPrdFileId);

    const fetchPrd = async () => {
      try {
        const res = await fetch(`/api/prd/${encodeURIComponent(writtenPrdFileId)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.content && data.content.includes('# PRD:')) {
            debugLog('[Stage1] PRD loaded from file!');
            setPrdDraft(data.content);
            setCompletedLevels([1, 2, 3, 4, 5]);
          }
        }
      } catch (err) {
        debugLog('[Stage1] Failed to fetch PRD file:', err);
      }
    };

    // Small delay to ensure the file is fully written
    const timer = setTimeout(fetchPrd, 1500);
    return () => clearTimeout(timer);
  }, [writtenPrdFileId, prdDraft]);

  // Fallback: detect PRD file path from assistant messages (e.g. "PRD 已在 tasks/prd-xxx.md")
  // Exclude marker files (导入转换中) from detection
  useEffect(() => {
    if (prdDraft || writtenPrdFileId) return;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'assistant') {
        const fileMatch = msg.content.match(/(?:tasks\/)?prd-([a-zA-Z0-9_\u4e00-\u9fff-]+)\.md/);
        if (fileMatch && !fileMatch[1].includes('导入转换中') && (msg.content.includes('PRD 已') || msg.content.includes('已生成') || msg.content.includes('已写入') || msg.content.includes('written'))) {
          debugLog('[Stage1] Detected PRD file reference in message:', fileMatch[1]);
          setWrittenPrdFileId(fileMatch[1]);
          break;
        }
      }
    }
  }, [messages, prdDraft, writtenPrdFileId]);

  // Last-resort fallback: when L5 completed, no PRD found, and URL has file param (transform mode),
  // try to load the PRD file from the URL file param
  useEffect(() => {
    if (prdDraft || writtenPrdFileId || !completedLevels.includes(5)) return;
    if (!urlFile) return;

    // Extract PRD ID from URL file param (e.g. "tasks/prd-worktree-concurrent-botool.md")
    const match = urlFile.match(/prd-([a-zA-Z0-9_\u4e00-\u9fff-]+)\.md$/);
    if (match) {
      debugLog('[Stage1] Last-resort: trying PRD from URL file param:', match[1]);
      setWrittenPrdFileId(match[1]);
    }
  }, [prdDraft, writtenPrdFileId, completedLevels, urlFile]);

  // Start pyramid Q&A when description is ready
  const startPyramid = useCallback(() => {
    if (!initialDescription || isStarted || !selectedMode) return;
    setIsStarted(true);
    // Trigger the pyramid skill with mode context
    if (selectedMode === 'quick') {
      // Quick mode: send with quick mode flag
      sendMessage(`/botoolagent-pyramidprd [模式:快速修复] ${initialDescription}`);
    } else if (selectedMode === 'feature') {
      sendMessage(`/botoolagent-pyramidprd [模式:功能开发] ${initialDescription}`);
    } else if (selectedMode === 'transform') {
      sendMessage(`/botoolagent-pyramidprd [模式:导入] [请勿覆盖源文件] ${initialDescription}`);
    } else {
      sendMessage(`/botoolagent-pyramidprd ${initialDescription}`);
    }
  }, [initialDescription, isStarted, selectedMode, sendMessage]);

  // Resume from saved state - continue from where we left off
  const resumePyramid = useCallback(() => {
    if (!isStarted || isLoading) return;
    // Send a message to continue the conversation
    // The CLI will resume from the saved session if cliSessionId is set
    const resumeMessage = currentLevel === 5 && completedLevels.includes(5)
      ? '请生成 PRD 文档'
      : `请继续 ${selectedModeRef.current === 'transform' ? 'T' : 'L'}${currentLevel} 的问答`;
    sendMessage(resumeMessage);
  }, [isStarted, isLoading, currentLevel, completedLevels, sendMessage]);

  // Check if we have saved progress but no current questions (need to resume)
  // L5 (confirmation) completed but no PRD yet - need to request PRD generation
  const needsPrdGeneration = completedLevels.includes(5) && !prdDraft && !writtenPrdFileId && !isLoading && !cliError;
  const needsResume = isStarted && !isLoading && currentQuestions.length === 0 && !prdDraft && !cliError && !needsPrdGeneration;

  // Debug logging
  debugLog('[Stage1] State:', {
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
    debugLog('[Stage1] PRD generation check:', { needsPrdGeneration, cliSessionId: !!cliSessionId, hasAttemptedPrdGeneration, qaHistoryCount: qaHistory.length });
    if (needsPrdGeneration && cliSessionId && !hasAttemptedPrdGeneration && qaHistory.length > 0) {
      debugLog('[Stage1] Auto-requesting PRD generation with Q&A history...');
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
    debugLog('[Stage1] Auto-resume check:', { needsResume, cliSessionId: !!cliSessionId, hasAttemptedResume });
    if (needsResume && cliSessionId && !hasAttemptedResume) {
      debugLog('[Stage1] Auto-resuming from saved state...');
      setHasAttemptedResume(true);
      resumePyramid();
    }
  }, [needsResume, cliSessionId, hasAttemptedResume, resumePyramid]);

  // Auto-start when description is loaded and mode is selected
  useEffect(() => {
    if (initialDescription && !isStarted && !isLoading && selectedMode) {
      startPyramid();
    }
  }, [initialDescription, isStarted, isLoading, selectedMode, startPyramid]);

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
      // Build save payload with optional source context for transform mode
      const savePayload: Record<string, string | undefined> = { content: prdDraft };
      if (selectedModeRef.current === 'transform' && urlFile) {
        savePayload.sourceFilePath = urlFile;
        // Derive markerId from urlFile: strip directory, strip prd- prefix, strip .md
        const base = urlFile.split('/').pop()?.replace(/\.md$/, '') || '';
        const stripped = base.startsWith('prd-') ? base.slice(4) : base;
        savePayload.markerId = `${stripped}-导入转换中`;
      }

      const response = await fetch('/api/prd/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(savePayload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save PRD');
      }

      if (activeProject) {
        updateProject(activeProject.id, { prdId: data.id, currentStage: 2 });
      }

      setSavedPrdId(data.id);
      setSaveSuccess(true);
      setShowTransitionModal(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save PRD');
    } finally {
      setIsSaving(false);
    }
  }, [prdDraft, isSaving, activeProject, updateProject, urlFile]);

  // Handle transition
  const handleTransitionConfirm = useCallback(() => {
    const modeParam = selectedModeRef.current ? `&mode=${selectedModeRef.current}` : '';
    router.push(`/stage2?prd=${savedPrdId}${modeParam}`);
  }, [router, savedPrdId]);

  const handleTransitionLater = useCallback(() => {
    setShowTransitionModal(false);
    router.push('/');
  }, [router]);

  // Build level info for navigation
  const levels: LevelInfo[] = useMemo(() => {
    return [1, 2, 3, 4, 5].map((level) => {
      const isCompleted = completedLevels.includes(level as LevelId);
      const isCurrent = level === currentLevel;

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
    : `${selectedMode === 'transform' ? 'T' : 'L'}${currentLevel} 进行中`;

  // Handle mode selection
  const handleModeSelect = useCallback((mode: PipelineMode) => {
    setSelectedMode(mode);
  }, []);

  // Handle quick fix submission
  const handleQuickFixSubmit = useCallback(() => {
    if (!quickFixDescription.trim()) return;
    setInitialDescription(quickFixDescription.trim());
    // startPyramid will auto-trigger via the useEffect since selectedMode and initialDescription are set
  }, [quickFixDescription]);

  // Handle transform mode submission
  const handleTransformSubmit = useCallback(() => {
    if (!transformFilePath.trim()) return;
    setInitialDescription(transformFilePath.trim());
    // startPyramid will auto-trigger via the useEffect since selectedMode and initialDescription are set
  }, [transformFilePath]);

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

  // Show mode selector if no mode is selected yet (and not restored from saved state)
  if (!selectedMode) {
    return (
      <div className="flex flex-col h-full overflow-hidden bg-neutral-50">
        <StageIndicator
          currentStage={1}
          completedStages={[]}
          projectName={projectName}
          stageStatus="选择模式"
        />
        <div className="flex-1 overflow-y-auto bg-white">
          <ModeSelector
            onSelect={handleModeSelect}
          />
        </div>
      </div>
    );
  }

  // Quick Fix mode: show simplified input instead of pyramid Q&A
  if (selectedMode === 'quick' && !isStarted && !initialDescription) {
    return (
      <div className="flex flex-col h-full overflow-hidden bg-neutral-50">
        <StageIndicator
          currentStage={1}
          completedStages={[]}
          projectName={projectName}
          stageStatus="快速修复"
        />
        <div className="flex-1 flex items-center justify-center bg-white">
          <div className="max-w-lg w-full px-6">
            <div className="text-center mb-6">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-50 border border-green-200 mb-4">
                <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
                <span className="text-sm font-medium text-green-700">快速修复模式</span>
              </div>
              <h2 className="text-xl font-semibold text-neutral-900 mb-2">
                描述你要修复的问题
              </h2>
              <p className="text-sm text-neutral-500">
                简单描述 bug、样式调整或小改动，AI 将直接生成任务并执行
              </p>
            </div>

            <textarea
              value={quickFixDescription}
              onChange={(e) => setQuickFixDescription(e.target.value)}
              placeholder="例如：修复登录页面的按钮在移动端溢出问题..."
              className="w-full p-4 border border-neutral-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-neutral-500 focus:border-neutral-500 bg-white text-neutral-900"
              rows={5}
              autoFocus
            />

            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={() => setSelectedMode(null)}
                className="px-4 py-2.5 rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50 transition-colors"
              >
                返回选择
              </button>
              <button
                onClick={handleQuickFixSubmit}
                disabled={!quickFixDescription.trim()}
                className={`flex-1 py-2.5 rounded-lg font-medium transition-colors ${
                  quickFixDescription.trim()
                    ? 'bg-neutral-900 text-white hover:bg-neutral-800'
                    : 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
                }`}
              >
                开始快速修复
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Transform mode: show file path input instead of pyramid Q&A
  if (selectedMode === 'transform' && !isStarted && !initialDescription) {
    return (
      <div className="flex flex-col h-full overflow-hidden bg-neutral-50">
        <StageIndicator
          currentStage={1}
          completedStages={[]}
          projectName={projectName}
          stageStatus="PRD 导入"
        />
        <div className="flex-1 flex items-center justify-center bg-white">
          <div className="max-w-lg w-full px-6">
            <div className="text-center mb-6">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-neutral-100 border border-neutral-200 mb-4">
                <span className="w-2.5 h-2.5 rounded-full bg-neutral-500" />
                <span className="text-sm font-medium text-neutral-700">PRD 导入模式</span>
              </div>
              <h2 className="text-xl font-semibold text-neutral-900 mb-2">
                输入现有 PRD 文件路径
              </h2>
              <p className="text-sm text-neutral-500">
                系统将分析你的 PRD 文档，评估覆盖度，针对性补问后生成标准格式 PRD
              </p>
            </div>

            <input
              type="text"
              value={transformFilePath}
              onChange={(e) => setTransformFilePath(e.target.value)}
              placeholder="例如：tasks/my-project-prd.md"
              className="w-full p-4 border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-500 focus:border-neutral-500 bg-white text-neutral-900"
              autoFocus
            />

            <p className="text-xs text-neutral-400 mt-2">
              支持 Markdown (.md) 格式的 PRD 文件，输入相对于项目根目录的路径
            </p>

            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={() => setSelectedMode(null)}
                className="px-4 py-2.5 rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50 transition-colors"
              >
                返回选择
              </button>
              <button
                onClick={handleTransformSubmit}
                disabled={!transformFilePath.trim()}
                className={`flex-1 py-2.5 rounded-lg font-medium transition-colors ${
                  transformFilePath.trim()
                    ? 'bg-neutral-900 text-white hover:bg-neutral-800'
                    : 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
                }`}
              >
                开始导入分析
              </button>
            </div>
          </div>
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
            isTransformMode={selectedMode === 'transform'}
            onLevelClick={() => {
              // In CLI mode, level navigation is controlled by the Skill
              // So we don't allow manual level switching
            }}
          />
        </div>

        {/* Center: Question Panel */}
        <div className="flex-1 min-w-0 border-x border-neutral-200 bg-white overflow-hidden flex flex-col">
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
              <div className="flex flex-col items-center">
                <div className="animate-spin h-8 w-8 border-4 border-green-600 border-t-transparent rounded-full mb-2"></div>
                <p className="text-sm text-neutral-600">正在生成 PRD 文档...</p>
                <p className="text-xs text-neutral-400 mt-1">
                  {currentTool
                    ? `正在执行: ${currentTool}`
                    : '所有层级已完成，请稍候'}
                </p>
                {/* Terminal activity feed */}
                <TerminalActivityFeed lines={terminalLines} />
              </div>
            </div>
          ) : isLoading && currentQuestions.length === 0 ? (
            (() => {
              // Calculate percentage: each completed level = 20%, plus within-level progress from tool calls
              const levelPercent = completedLevels.length * 20;
              const withinLevel = Math.min(18, toolCallCount * 2); // cap at 18% within current level
              const percent = Math.min(99, levelPercent + withinLevel);
              const toolLabel = currentTool === 'Read' ? '读取文件' : currentTool === 'Glob' ? '扫描目录' : currentTool === 'Grep' ? '搜索代码' : currentTool === 'Bash' ? '执行命令' : currentTool === 'Task' ? '子任务分析' : currentTool === 'Skill' ? '加载技能' : currentTool === 'Write' ? '写入文件' : currentTool === 'TodoWrite' ? '更新进度' : currentTool;
              return (
                <div className="flex items-center justify-center h-full">
                  <div className="flex flex-col items-center w-80">
                    {/* Percentage circle */}
                    <div className="relative w-20 h-20 mb-4">
                      <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
                        <circle cx="40" cy="40" r="34" fill="none" stroke="#e5e7eb" strokeWidth="6" />
                        <circle cx="40" cy="40" r="34" fill="none" stroke="#525252" strokeWidth="6"
                          strokeDasharray={`${2 * Math.PI * 34}`}
                          strokeDashoffset={`${2 * Math.PI * 34 * (1 - percent / 100)}`}
                          strokeLinecap="round"
                          className="transition-all duration-500"
                        />
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center text-lg font-semibold text-neutral-700">
                        {percent}%
                      </span>
                    </div>
                    <p className="text-sm font-medium text-neutral-700">
                      {toolCallCount === 0 ? 'AI 正在启动...' : `${selectedMode === 'transform' ? 'T' : 'L'}${currentLevel} ${selectedMode === 'transform' ? '处理中...' : '分析中...'}`}
                    </p>
                    {toolLabel && (
                      <p className="text-xs text-neutral-400 mt-1">{toolLabel}</p>
                    )}
                    {/* Terminal activity feed */}
                    <TerminalActivityFeed lines={terminalLines} />
                  </div>
                </div>
              );
            })()
          ) : connectionState === 'reconnecting' ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="animate-spin h-8 w-8 border-4 border-orange-500 border-t-transparent rounded-full mx-auto mb-2"></div>
                <p className="text-sm text-orange-600 font-medium">连接中断，正在重新连接...</p>
                <p className="text-xs text-neutral-400 mt-1">
                  第 {reconnectAttempt} / 3 次尝试
                </p>
              </div>
            </div>
          ) : connectionState === 'disconnected' || cliError ? (
            <div className="flex items-center justify-center h-full p-6">
              <ErrorRecovery
                error={connectionState === 'disconnected' ? '连接中断' : (cliError || '未知错误')}
                diagnosis={
                  connectionState === 'disconnected'
                    ? '无法连接到服务器，可能是网络问题或服务未启动。已尝试自动重连 3 次均失败。'
                    : undefined
                }
                actions={[
                  {
                    label: '重新开始',
                    onClick: () => {
                      resetSession();
                      window.location.reload();
                    },
                    variant: 'primary',
                  },
                  {
                    label: '返回首页',
                    onClick: () => router.push('/'),
                    variant: 'secondary',
                  },
                ]}
              />
            </div>
          ) : currentQuestions.length > 0 ? (
            <div className="flex flex-col h-full">
              {/* Scrollable questions area */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* Level Header */}
                <div className="border-b border-neutral-200 pb-4">
                  <h2 className="text-xl font-semibold text-neutral-900">
                    {selectedMode === 'transform'
                      ? `T${currentLevel}: ${currentLevel === 1 ? '文档解析' : currentLevel === 2 ? '覆盖度分析' : currentLevel === 3 ? '补充问答' : currentLevel === 4 ? '需求分解' : '确认生成'}`
                      : `L${currentLevel}: ${currentLevel === 1 ? '核心识别' : currentLevel === 2 ? '领域分支' : currentLevel === 3 ? '细节深入' : currentLevel === 4 ? '边界确认' : '确认门控'}`
                    }
                  </h2>
                  <p className="text-sm text-neutral-500 mt-1">
                    {selectedMode === 'transform' ? (
                      <>
                        {currentLevel === 1 && '读取并解析源文档结构'}
                        {currentLevel === 2 && '分析覆盖度，识别缺口'}
                        {currentLevel === 3 && '针对缺口补充问答'}
                        {currentLevel === 4 && '将需求拆解为开发任务'}
                        {currentLevel === 5 && '确认摘要并生成 PRD'}
                      </>
                    ) : (
                      <>
                        {currentLevel === 1 && '理解需求的本质和范围'}
                        {currentLevel === 2 && '按领域深入探索具体需求'}
                        {currentLevel === 3 && '深入实现细节'}
                        {currentLevel === 4 && '确认范围边界，防止范围蔓延'}
                        {currentLevel === 5 && '确认需求摘要，准备生成 PRD'}
                      </>
                    )}
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
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-neutral-200 text-neutral-600 text-sm font-medium flex items-center justify-center">
                            {index + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            {/* Use pre-wrap + mono for ASCII art (box-drawing chars or multi-line) */}
                            {/[┌┐└┘├┤─│═╔╗╚╝║▶]/.test(question.question) ? (
                              <pre className="font-mono text-sm text-neutral-900 whitespace-pre-wrap leading-relaxed overflow-x-auto">{question.question}</pre>
                            ) : (
                              <p className="font-medium text-neutral-900 whitespace-pre-wrap">{question.question}</p>
                            )}
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
                                      ? 'border-neutral-900 bg-neutral-100 text-neutral-900'
                                      : 'border-neutral-200 bg-white hover:border-neutral-300'
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    <span className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                                      isSelected ? 'border-neutral-900 bg-neutral-900' : 'border-neutral-300'
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
                                      ? 'border-neutral-900 bg-neutral-100 text-neutral-900'
                                      : 'border-neutral-200 bg-white hover:border-neutral-300'
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    <span className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                                      otherSelected[questionId] ? 'border-neutral-900 bg-neutral-900' : 'border-neutral-300'
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
                                    className="w-full p-3 border border-neutral-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-neutral-500 bg-white"
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
                              className="w-full p-3 border border-neutral-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-neutral-500"
                              rows={3}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Submit Button - fixed at bottom */}
              <div className="flex-shrink-0 px-6 py-4 border-t border-neutral-200 bg-white">
                <button
                  onClick={handleSubmitAnswers}
                  disabled={!allAnswered || isLoading}
                  className={`w-full py-3 rounded-lg font-medium transition-colors ${
                    allAnswered && !isLoading
                      ? 'bg-neutral-900 text-white hover:bg-neutral-800'
                      : 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
                  }`}
                >
                  {isLoading ? '处理中...' : currentLevel < 4 ? '继续下一层' : currentLevel === 4 ? '进入确认' : '确认并生成 PRD'}
                </button>
              </div>
            </div>
          ) : prdDraft ? (
            <div className="flex flex-col h-full">
              {/* Header with Save button */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 bg-white sticky top-0 z-10">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                    <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h2 className="text-lg font-semibold text-neutral-900">PRD 已生成</h2>
                </div>
                <button
                  onClick={handleSavePRD}
                  disabled={isSaving || saveSuccess}
                  className={`px-5 py-2 rounded-lg font-medium text-sm transition-colors ${
                    saveSuccess
                      ? 'bg-green-100 text-green-700'
                      : isSaving
                        ? 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
                        : 'bg-neutral-900 text-white hover:bg-neutral-800'
                  }`}
                >
                  {saveSuccess ? '已保存' : isSaving ? '保存中...' : '保存 PRD 并继续'}
                </button>
              </div>
              {saveError && (
                <div className="px-6 py-2 bg-red-50 border-b border-red-200 text-sm text-red-600">{saveError}</div>
              )}
              {/* PRD Content */}
              <div className="flex-1 overflow-y-auto px-6 py-6">
                <PRDPreview
                  content={prdDraft}
                  onSave={handleSavePRD}
                  isSaving={isSaving}
                  saveSuccess={saveSuccess}
                  saveError={saveError}
                  hideHeader
                />
              </div>
            </div>
          ) : needsResume && !hasAttemptedResume ? (
            <div className="flex items-center justify-center h-full">
              <div className="flex flex-col items-center">
                <div className="animate-spin h-8 w-8 border-4 border-neutral-600 border-t-transparent rounded-full mb-2"></div>
                <p className="text-sm text-neutral-600">正在恢复进度...</p>
                <p className="text-xs text-neutral-400 mt-1">
                  {selectedMode === 'transform' ? 'T' : 'L'}{currentLevel} · 已完成 {completedLevels.length} {selectedMode === 'transform' ? '步' : '层'}
                </p>
                {/* Terminal activity feed */}
                <TerminalActivityFeed lines={terminalLines} />
              </div>
            </div>
          ) : needsResume && hasAttemptedResume ? (
            <div className="flex items-center justify-center h-full p-6">
              <ErrorRecovery
                error="无法恢复上次进度"
                diagnosis="上次的 CLI 会话可能已失效（服务器重启或会话超时）。建议清除缓存重新开始。"
                actions={[
                  {
                    label: '重新开始',
                    onClick: () => {
                      // Clear saved state and restart
                      if (storageKey) localStorage.removeItem(storageKey);
                      resetSession();
                      window.location.reload();
                    },
                    variant: 'primary',
                  },
                  {
                    label: '再试一次',
                    onClick: () => {
                      setHasAttemptedResume(false);
                    },
                    variant: 'secondary',
                  },
                ]}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-neutral-500">等待问题加载...</p>
            </div>
          )}
        </div>

        {/* Right PRD panel removed — PRD now shows inline in center */}
      </div>
    </div>
  );
}

function Stage1Fallback() {
  return (
    <div className="flex h-full items-center justify-center bg-neutral-50 text-sm text-neutral-500">
      加载中...
    </div>
  );
}

export default function Stage1Page() {
  return (
    <Suspense fallback={<Stage1Fallback />}>
      <Stage1PageContent />
    </Suspense>
  );
}
