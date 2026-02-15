/**
 * Local storage management for project state persistence.
 * Provides CRUD operations for projects with localStorage as backing store.
 */

import type { ProjectState, ProjectStatus, ProjectStage } from '../contexts/ProjectContext';
import { scopedKey } from './workspace-id';

export interface ProjectStorage {
  version: number;
  projects: Record<string, ProjectState>;
  activeProjectId: string | null;
}

/**
 * Generate a UUID for project IDs
 */
export function generateProjectId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Load all projects from localStorage
 */
export function loadProjects(): ProjectStorage {
  if (typeof window === 'undefined') {
    return { version: 1, projects: {}, activeProjectId: null };
  }

  try {
    const key = scopedKey('projects');
    let stored = localStorage.getItem(key);
    // Migration: if scoped key has no data, try legacy key
    if (!stored && key !== 'botool-projects') {
      stored = localStorage.getItem('botool-projects');
      if (stored) localStorage.setItem(key, stored);
    }
    if (!stored) {
      return { version: 1, projects: {}, activeProjectId: null };
    }
    return JSON.parse(stored) as ProjectStorage;
  } catch {
    return { version: 1, projects: {}, activeProjectId: null };
  }
}

/**
 * Save all projects to localStorage
 */
export function saveProjects(data: ProjectStorage): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(scopedKey('projects'), JSON.stringify(data));
  } catch (err) {
    console.error('Failed to save projects:', err);
  }
}

/**
 * Save a single project (create or update)
 */
export function saveProject(project: ProjectState): void {
  const storage = loadProjects();
  storage.projects[project.id] = {
    ...project,
    updatedAt: Date.now(),
  };
  saveProjects(storage);
}

/**
 * Get a project by ID
 */
export function getProject(id: string): ProjectState | null {
  const storage = loadProjects();
  return storage.projects[id] || null;
}

/**
 * Get all projects sorted by updatedAt (most recent first)
 */
export function getAllProjects(): ProjectState[] {
  const storage = loadProjects();
  return Object.values(storage.projects).sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Delete a project by ID
 */
export function deleteProject(id: string): void {
  const storage = loadProjects();
  delete storage.projects[id];

  // Clear active project if deleted
  if (storage.activeProjectId === id) {
    storage.activeProjectId = null;
  }

  saveProjects(storage);
}

/**
 * Archive a project by ID
 */
export function archiveProject(id: string): void {
  const storage = loadProjects();
  const project = storage.projects[id];

  if (project) {
    storage.projects[id] = {
      ...project,
      status: 'archived',
      updatedAt: Date.now(),
    };

    // Clear active project if archived
    if (storage.activeProjectId === id) {
      storage.activeProjectId = null;
    }

    saveProjects(storage);
  }
}

/**
 * Set the active project ID
 */
export function setActiveProjectId(id: string | null): void {
  const storage = loadProjects();
  storage.activeProjectId = id;
  saveProjects(storage);
}

/**
 * Get the active project ID
 */
export function getActiveProjectId(): string | null {
  const storage = loadProjects();
  return storage.activeProjectId;
}

/**
 * Create a new project with default values
 */
export function createProjectState(name: string, prdId?: string): ProjectState {
  const now = Date.now();
  return {
    id: generateProjectId(),
    name: name.trim() || '未命名项目',
    currentStage: 1,
    prdId: prdId || null,
    branchName: null,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
}

// Re-export types for convenience
export type { ProjectState, ProjectStatus, ProjectStage };
