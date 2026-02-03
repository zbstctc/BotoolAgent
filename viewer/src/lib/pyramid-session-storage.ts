/**
 * 金字塔问答进度存储
 * 支持实时保存和恢复问答进度
 */

import { type LevelId } from './dimension-framework';

export interface PyramidVersion {
  id: string;
  createdAt: string;
  modificationRequest?: string;
  prdContent: string;
}

export interface PyramidSession {
  projectId: string;
  currentLevel: LevelId;
  answers: Record<string, string | string[]>;
  generatedQuestions: Partial<Record<LevelId, object[]>>;
  activeDimensions: string[];
  prdDraft: string;
  versions: PyramidVersion[];
  lastUpdated: string;
}

const STORAGE_KEY_PREFIX = 'botool-pyramid-session-';

// Debounce timer
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 500;

/**
 * 保存金字塔进度（debounced）
 */
export function savePyramidProgress(
  projectId: string,
  data: Partial<PyramidSession>
): void {
  if (typeof window === 'undefined') return;

  // Clear existing timer
  if (saveTimer) {
    clearTimeout(saveTimer);
  }

  // Debounce save
  saveTimer = setTimeout(() => {
    const existing = loadPyramidProgress(projectId);
    const updated: PyramidSession = {
      projectId,
      currentLevel: data.currentLevel ?? existing?.currentLevel ?? 1,
      answers: { ...existing?.answers, ...data.answers },
      generatedQuestions: { ...existing?.generatedQuestions, ...data.generatedQuestions },
      activeDimensions: data.activeDimensions ?? existing?.activeDimensions ?? [],
      prdDraft: data.prdDraft ?? existing?.prdDraft ?? '',
      versions: data.versions ?? existing?.versions ?? [],
      lastUpdated: new Date().toISOString(),
    };

    try {
      localStorage.setItem(
        `${STORAGE_KEY_PREFIX}${projectId}`,
        JSON.stringify(updated)
      );
    } catch (error) {
      console.error('Failed to save pyramid progress:', error);
    }
  }, DEBOUNCE_MS);
}

/**
 * 立即保存金字塔进度（不 debounce）
 */
export function savePyramidProgressImmediate(
  projectId: string,
  data: Partial<PyramidSession>
): void {
  if (typeof window === 'undefined') return;

  // Clear any pending debounced save
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  const existing = loadPyramidProgress(projectId);
  const updated: PyramidSession = {
    projectId,
    currentLevel: data.currentLevel ?? existing?.currentLevel ?? 1,
    answers: { ...existing?.answers, ...data.answers },
    generatedQuestions: { ...existing?.generatedQuestions, ...data.generatedQuestions },
    activeDimensions: data.activeDimensions ?? existing?.activeDimensions ?? [],
    prdDraft: data.prdDraft ?? existing?.prdDraft ?? '',
    versions: data.versions ?? existing?.versions ?? [],
    lastUpdated: new Date().toISOString(),
  };

  try {
    localStorage.setItem(
      `${STORAGE_KEY_PREFIX}${projectId}`,
      JSON.stringify(updated)
    );
  } catch (error) {
    console.error('Failed to save pyramid progress:', error);
  }
}

/**
 * 加载金字塔进度
 */
export function loadPyramidProgress(projectId: string): PyramidSession | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}${projectId}`);
    if (stored) {
      return JSON.parse(stored) as PyramidSession;
    }
  } catch (error) {
    console.error('Failed to load pyramid progress:', error);
  }

  return null;
}

/**
 * 清除金字塔进度
 */
export function clearPyramidProgress(projectId: string): void {
  if (typeof window === 'undefined') return;

  // Clear any pending debounced save
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  try {
    localStorage.removeItem(`${STORAGE_KEY_PREFIX}${projectId}`);
  } catch (error) {
    console.error('Failed to clear pyramid progress:', error);
  }
}

/**
 * 检查是否有保存的进度
 */
export function hasPyramidProgress(projectId: string): boolean {
  if (typeof window === 'undefined') return false;

  return localStorage.getItem(`${STORAGE_KEY_PREFIX}${projectId}`) !== null;
}

/**
 * 创建新版本
 */
export function createNewVersion(
  projectId: string,
  prdContent: string,
  modificationRequest?: string
): PyramidVersion {
  const existing = loadPyramidProgress(projectId);
  const versions = existing?.versions || [];

  const newVersion: PyramidVersion = {
    id: `v${versions.length + 1}`,
    createdAt: new Date().toISOString(),
    modificationRequest,
    prdContent,
  };

  savePyramidProgressImmediate(projectId, {
    versions: [...versions, newVersion],
    prdDraft: prdContent,
  });

  return newVersion;
}

/**
 * 获取当前版本号
 */
export function getCurrentVersionNumber(projectId: string): number {
  const session = loadPyramidProgress(projectId);
  return session?.versions?.length || 0;
}

/**
 * 更新单个回答
 */
export function updateAnswer(
  projectId: string,
  questionId: string,
  value: string | string[]
): void {
  const existing = loadPyramidProgress(projectId);
  savePyramidProgress(projectId, {
    answers: {
      ...existing?.answers,
      [questionId]: value,
    },
  });
}

/**
 * 更新当前层级
 */
export function updateCurrentLevel(projectId: string, level: LevelId): void {
  savePyramidProgressImmediate(projectId, { currentLevel: level });
}

/**
 * 保存生成的问题
 */
export function saveGeneratedQuestions(
  projectId: string,
  level: LevelId,
  questions: object[]
): void {
  const existing = loadPyramidProgress(projectId);
  savePyramidProgressImmediate(projectId, {
    generatedQuestions: {
      ...existing?.generatedQuestions,
      [level]: questions,
    },
  });
}
