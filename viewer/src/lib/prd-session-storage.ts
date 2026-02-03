/**
 * Local storage management for PRD session progress.
 * Supports multiple concurrent PRD sessions with progress tracking.
 */

const STORAGE_KEY = 'botool-prd-sessions';
const OLD_STORAGE_KEY = 'botool-prd-session'; // For migration

export interface QuestionAnswer {
  /** Selected option IDs (for multiple choice) */
  selected: string[];
  /** Custom "other" text value */
  otherValue: string;
}

export interface PrdSession {
  /** Unique session ID (UUID) */
  id: string;
  /** User-provided project name */
  name: string;
  /** Timestamp when session was created */
  createdAt: number;
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
  /** CLI session ID for resuming Claude conversation */
  cliSessionId?: string;
}

interface PrdSessionsStorage {
  version: number;
  sessions: Record<string, PrdSession>;
}

// Keep SavedPrdSession with projectName alias for backward compatibility
export interface SavedPrdSession extends Omit<PrdSession, 'name'> {
  name: string;
  /** @deprecated Use 'name' instead */
  projectName: string;
}

/**
 * Generate a UUID for session IDs
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Get all sessions storage from localStorage
 */
function getStorage(): PrdSessionsStorage {
  if (typeof window === 'undefined') {
    return { version: 2, sessions: {} };
  }

  try {
    // First, try to migrate old data if it exists
    migrateOldSession();

    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return { version: 2, sessions: {} };
    }

    const storage = JSON.parse(stored) as PrdSessionsStorage;
    return storage;
  } catch {
    return { version: 2, sessions: {} };
  }
}

/**
 * Save sessions storage to localStorage
 */
function saveStorage(storage: PrdSessionsStorage): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storage));
  } catch (err) {
    console.error('Failed to save PRD sessions:', err);
  }
}

/**
 * Migrate old single-session data to new multi-session format
 */
function migrateOldSession(): void {
  if (typeof window === 'undefined') return;

  try {
    const oldData = localStorage.getItem(OLD_STORAGE_KEY);
    if (!oldData) return;

    const oldSession = JSON.parse(oldData) as {
      sessionKey: string;
      projectName: string;
      startedAt: number;
      updatedAt: number;
      totalQuestions: number;
      answeredQuestions: number;
      questionAnswers: Record<string, Record<string, QuestionAnswer>>;
      messages?: Array<{ id: string; role: 'user' | 'assistant'; content: string }>;
    };

    // Check if already migrated
    const existingStorage = localStorage.getItem(STORAGE_KEY);
    if (existingStorage) {
      // Storage exists, just remove old key
      localStorage.removeItem(OLD_STORAGE_KEY);
      return;
    }

    // Create new session from old data
    const sessionId = generateUUID();
    const newSession: PrdSession = {
      id: sessionId,
      name: oldSession.projectName || '未命名项目',
      createdAt: oldSession.startedAt || Date.now(),
      updatedAt: oldSession.updatedAt || Date.now(),
      totalQuestions: oldSession.totalQuestions || 0,
      answeredQuestions: oldSession.answeredQuestions || 0,
      questionAnswers: oldSession.questionAnswers || {},
      messages: oldSession.messages,
    };

    // Save to new format
    const newStorage: PrdSessionsStorage = {
      version: 2,
      sessions: { [sessionId]: newSession },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newStorage));

    // Remove old key
    localStorage.removeItem(OLD_STORAGE_KEY);

    console.log('Migrated old PRD session to new multi-session format');
  } catch (err) {
    console.error('Failed to migrate old session:', err);
  }
}

/**
 * Create a new PRD session
 * @param name - User-provided project name
 * @returns The session ID
 */
export function createSession(name: string): string {
  const storage = getStorage();
  const sessionId = generateUUID();

  const session: PrdSession = {
    id: sessionId,
    name: name.trim() || '未命名项目',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    totalQuestions: 0,
    answeredQuestions: 0,
    questionAnswers: {},
  };

  storage.sessions[sessionId] = session;
  saveStorage(storage);

  return sessionId;
}

/**
 * Get a specific session by ID
 */
export function getSession(sessionId: string): PrdSession | null {
  const storage = getStorage();
  return storage.sessions[sessionId] || null;
}

/**
 * Get all sessions, sorted by updatedAt (most recent first)
 */
export function getAllSessions(): PrdSession[] {
  const storage = getStorage();
  return Object.values(storage.sessions).sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Delete a session by ID
 */
export function deleteSession(sessionId: string): void {
  const storage = getStorage();
  delete storage.sessions[sessionId];
  saveStorage(storage);
}

/**
 * Update a session with partial data
 */
export function updateSession(
  sessionId: string,
  data: Partial<Omit<PrdSession, 'id' | 'createdAt'>>
): void {
  const storage = getStorage();
  const session = storage.sessions[sessionId];

  if (!session) {
    console.warn(`Session ${sessionId} not found`);
    return;
  }

  // Merge the update
  Object.assign(session, data, { updatedAt: Date.now() });
  saveStorage(storage);
}

/**
 * Save answers for a specific tool/question set within a session
 */
export function saveSessionAnswers(
  sessionId: string,
  toolId: string,
  answers: Record<string, QuestionAnswer>,
  totalQuestions: number
): void {
  const storage = getStorage();
  const session = storage.sessions[sessionId];

  if (!session) {
    console.warn(`Session ${sessionId} not found`);
    return;
  }

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
  session.updatedAt = Date.now();

  saveStorage(storage);
}

/**
 * Update session with chat messages
 * @param sessionIdOrMessages - Session ID (new API) or messages array (deprecated)
 * @param messagesArg - Messages array when using new API with sessionId
 */
export function updateSessionMessages(
  sessionIdOrMessages: string | Array<{ id: string; role: 'user' | 'assistant'; content: string }>,
  messagesArg?: Array<{ id: string; role: 'user' | 'assistant'; content: string }>
): void {
  let sessionId: string;
  let messages: Array<{ id: string; role: 'user' | 'assistant'; content: string }>;

  // Support both old API (just messages) and new API (sessionId, messages)
  if (typeof sessionIdOrMessages === 'string') {
    // New API: updateSessionMessages(sessionId, messages)
    sessionId = sessionIdOrMessages;
    messages = messagesArg!;
  } else {
    // Old API (deprecated): updateSessionMessages(messages)
    // Use the most recent session
    const currentSession = getSavedPrdSession();
    if (!currentSession) {
      // Create a new session if none exists
      sessionId = createSession('未命名项目');
    } else {
      sessionId = currentSession.id;
    }
    messages = sessionIdOrMessages;
  }

  const storage = getStorage();
  const session = storage.sessions[sessionId];

  if (!session) {
    console.warn(`Session ${sessionId} not found`);
    return;
  }

  session.messages = messages;

  // Extract project name from first user message if not set or default
  if (session.name === '未命名项目') {
    const firstUserMessage = messages.find((m) => m.role === 'user');
    if (firstUserMessage) {
      const name = firstUserMessage.content.substring(0, 50).trim();
      session.name = name.length < firstUserMessage.content.length ? name + '...' : name;
    }
  }

  session.updatedAt = Date.now();
  saveStorage(storage);
}

// ============================================================
// BACKWARD COMPATIBILITY FUNCTIONS
// These maintain the old API for existing code that hasn't been updated yet
// ============================================================

/**
 * @deprecated Use getSession or getAllSessions instead
 * Get saved PRD session from localStorage (returns first/most recent session)
 */
export function getSavedPrdSession(): SavedPrdSession | null {
  const sessions = getAllSessions();
  if (sessions.length === 0) return null;

  const session = sessions[0];
  // Add projectName alias for backward compatibility
  return {
    ...session,
    projectName: session.name,
  };
}

/**
 * @deprecated Use updateSession instead
 * Save PRD session to localStorage
 */
export function savePrdSession(session: SavedPrdSession): void {
  if (!session.id) {
    // Old code might not have an ID, create one
    const sessionId = createSession(session.name || '未命名项目');
    session.id = sessionId;
  }
  updateSession(session.id, session);
}

/**
 * @deprecated Use deleteSession instead
 * Clear saved PRD session from localStorage
 */
export function clearPrdSession(): void {
  const session = getSavedPrdSession();
  if (session) {
    deleteSession(session.id);
  }
}

/**
 * @deprecated Use saveSessionAnswers instead
 * Save answers for a specific tool/question set
 */
export function saveQuestionAnswers(
  toolId: string,
  answers: Record<string, QuestionAnswer>,
  totalQuestions: number,
  projectName?: string
): void {
  // Get or create the first/current session
  let savedSession = getSavedPrdSession();
  let sessionId: string;

  if (!savedSession) {
    sessionId = createSession(projectName || '未命名项目');
  } else {
    sessionId = savedSession.id;
    if (projectName && savedSession.name !== projectName) {
      updateSession(sessionId, { name: projectName });
    }
  }

  saveSessionAnswers(sessionId, toolId, answers, totalQuestions);
}

/**
 * @deprecated Use getSession(id).questionAnswers[toolId] instead
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
 * @deprecated Use createSession instead
 * Initialize a new PRD session
 */
export function initPrdSession(projectName?: string): SavedPrdSession {
  const sessionId = createSession(projectName || '未命名项目');
  const session = getSession(sessionId)!;
  return {
    ...session,
    projectName: session.name,
  };
}

/**
 * @deprecated Check getAllSessions().length > 0 instead
 * Check if there's an incomplete session
 */
export function hasIncompleteSession(): boolean {
  const session = getSavedPrdSession();
  if (!session) return false;

  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  return (
    Object.keys(session.questionAnswers).length > 0 &&
    session.updatedAt > oneDayAgo
  );
}
