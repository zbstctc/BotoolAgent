/**
 * Local storage management for PRD session progress.
 * Saves and restores user answers to questions during PRD creation.
 */

const STORAGE_KEY = 'botool-prd-session';

export interface QuestionAnswer {
  /** Selected option IDs (for multiple choice) */
  selected: string[];
  /** Custom "other" text value */
  otherValue: string;
}

export interface SavedPrdSession {
  /** Session identifier - can be project name or timestamp */
  sessionKey: string;
  /** Project name/description extracted from first user message */
  projectName: string;
  /** Timestamp when session was started */
  startedAt: number;
  /** Timestamp when session was last updated */
  updatedAt: number;
  /** Total number of questions encountered */
  totalQuestions: number;
  /** Number of questions answered */
  answeredQuestions: number;
  /** Map of tool ID to question answers */
  questionAnswers: Record<string, Record<string, QuestionAnswer>>;
  /** Chat messages for context */
  messages?: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
  }>;
}

/**
 * Get saved PRD session from localStorage
 */
export function getSavedPrdSession(): SavedPrdSession | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    const session = JSON.parse(stored) as SavedPrdSession;

    // Validate session structure
    if (!session.sessionKey || !session.projectName || !session.startedAt) {
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

/**
 * Save PRD session to localStorage
 */
export function savePrdSession(session: SavedPrdSession): void {
  if (typeof window === 'undefined') return;

  try {
    session.updatedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch (err) {
    console.error('Failed to save PRD session:', err);
  }
}

/**
 * Clear saved PRD session from localStorage
 */
export function clearPrdSession(): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.error('Failed to clear PRD session:', err);
  }
}

/**
 * Save answers for a specific tool/question set
 */
export function saveQuestionAnswers(
  toolId: string,
  answers: Record<string, QuestionAnswer>,
  totalQuestions: number,
  projectName?: string
): void {
  const session = getSavedPrdSession() || createNewSession(projectName);

  // Update session with new answers
  session.questionAnswers[toolId] = answers;

  // Count total answered questions across all tool invocations
  let answeredCount = 0;
  Object.values(session.questionAnswers).forEach((toolAnswers) => {
    Object.values(toolAnswers).forEach((answer) => {
      if (answer.selected.length > 0 || answer.otherValue.trim() !== '') {
        answeredCount++;
      }
    });
  });

  session.answeredQuestions = answeredCount;
  session.totalQuestions = Math.max(session.totalQuestions, totalQuestions);

  if (projectName) {
    session.projectName = projectName;
  }

  savePrdSession(session);
}

/**
 * Get saved answers for a specific tool/question set
 */
export function getQuestionAnswers(
  toolId: string
): Record<string, QuestionAnswer> | null {
  const session = getSavedPrdSession();
  if (!session) return null;

  return session.questionAnswers[toolId] || null;
}

/**
 * Update session with chat messages for context
 */
export function updateSessionMessages(
  messages: Array<{ id: string; role: 'user' | 'assistant'; content: string }>
): void {
  const session = getSavedPrdSession();
  if (!session) return;

  session.messages = messages;

  // Extract project name from first user message if not set
  if (!session.projectName || session.projectName === '未命名项目') {
    const firstUserMessage = messages.find((m) => m.role === 'user');
    if (firstUserMessage) {
      // Extract first 50 chars as project name
      const name = firstUserMessage.content.substring(0, 50).trim();
      session.projectName = name.length < firstUserMessage.content.length
        ? name + '...'
        : name;
    }
  }

  savePrdSession(session);
}

/**
 * Create a new session object
 */
function createNewSession(projectName?: string): SavedPrdSession {
  return {
    sessionKey: `session-${Date.now()}`,
    projectName: projectName || '未命名项目',
    startedAt: Date.now(),
    updatedAt: Date.now(),
    totalQuestions: 0,
    answeredQuestions: 0,
    questionAnswers: {},
  };
}

/**
 * Initialize a new PRD session
 */
export function initPrdSession(projectName?: string): SavedPrdSession {
  const session = createNewSession(projectName);
  savePrdSession(session);
  return session;
}

/**
 * Check if there's an incomplete session (has some but not all answers)
 */
export function hasIncompleteSession(): boolean {
  const session = getSavedPrdSession();
  if (!session) return false;

  // Consider session incomplete if it has any saved answers
  // and was updated in the last 24 hours
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  return (
    Object.keys(session.questionAnswers).length > 0 &&
    session.updatedAt > oneDayAgo
  );
}
