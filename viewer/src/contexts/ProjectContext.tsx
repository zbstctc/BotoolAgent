'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import {
  loadProjects,
  saveProjects,
  saveProject as saveProjectToStorage,
  generateProjectId,
  type ProjectStorage,
} from '../lib/project-storage';
import { setWorkspaceId } from '../lib/workspace-id';

/**
 * Project stage in the development workflow
 */
export type ProjectStage = 1 | 2 | 3 | 4 | 5;

/**
 * Project status
 */
export type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived';

/**
 * Project state interface
 */
export interface ProjectState {
  /** Unique project ID (UUID) */
  id: string;
  /** User-provided project name */
  name: string;
  /** Current stage in the workflow (1-5) */
  currentStage: ProjectStage;
  /** Associated PRD session ID (from Stage 1) */
  prdId: string | null;
  /** Git branch name for this project */
  branchName: string | null;
  /** Current project status */
  status: ProjectStatus;
  /** Timestamp when project was created */
  createdAt: number;
  /** Timestamp when project was last updated */
  updatedAt: number;
  /** Auto mode toggle — when true, Stage 2-5 run automatically */
  autoMode?: boolean;
}

/**
 * Context value interface
 */
interface ProjectContextValue {
  /** All projects indexed by ID */
  projects: Record<string, ProjectState>;
  /** Currently active project ID */
  activeProjectId: string | null;
  /** Get the active project state */
  activeProject: ProjectState | null;
  /** Create a new project */
  createProject: (name: string, prdId?: string) => string;
  /** Update an existing project */
  updateProject: (id: string, data: Partial<Omit<ProjectState, 'id' | 'createdAt'>>) => void;
  /** Set the active project */
  setActiveProject: (id: string | null) => void;
  /** Delete a project */
  deleteProject: (id: string) => void;
  /** Archive a project */
  archiveProject: (id: string) => void;
  /** Get a project by ID */
  getProject: (id: string) => ProjectState | null;
  /** Get all projects sorted by updatedAt */
  getAllProjects: () => ProjectState[];
  /** Loading state */
  isLoading: boolean;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

/**
 * Project Provider component
 */
export function ProjectProvider({ workspaceId, children }: { workspaceId?: string; children: React.ReactNode }) {
  // Must be set before any storage access (including useState initializers below)
  if (workspaceId) setWorkspaceId(workspaceId);

  const [projects, setProjects] = useState<Record<string, ProjectState>>({});
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load from localStorage on mount (using project-storage module)
  useEffect(() => {
    let cancelled = false;

    // Defer hydration from localStorage to avoid SSR/CSR mismatch on first paint.
    queueMicrotask(() => {
      if (cancelled) return;
      const storage = loadProjects();
      setProjects(storage.projects);
      setActiveProjectIdState(storage.activeProjectId);
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Save to localStorage when state changes (using project-storage module)
  useEffect(() => {
    if (isLoading) return;
    const storage: ProjectStorage = { version: 1, projects, activeProjectId };
    saveProjects(storage);
  }, [projects, activeProjectId, isLoading]);

  // Get active project
  const activeProject = useMemo(() => {
    if (!activeProjectId) return null;
    return projects[activeProjectId] || null;
  }, [activeProjectId, projects]);

  // Create a new project
  const createProject = useCallback((name: string, prdId?: string): string => {
    const id = generateProjectId();
    const now = Date.now();

    const newProject: ProjectState = {
      id,
      name: name.trim() || '未命名项目',
      currentStage: 1,
      prdId: prdId || null,
      branchName: null,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      autoMode: false,
    };

    setProjects((prev) => ({ ...prev, [id]: newProject }));
    setActiveProjectIdState(id);

    return id;
  }, []);

  // Update an existing project
  const updateProject = useCallback(
    (id: string, data: Partial<Omit<ProjectState, 'id' | 'createdAt'>>) => {
      setProjects((prev) => {
        const project = prev[id];
        if (!project) {
          console.warn(`Project ${id} not found`);
          return prev;
        }

        const updated = {
          ...project,
          ...data,
          updatedAt: Date.now(),
        };

        // Sync write to localStorage so navigations read fresh state
        saveProjectToStorage(updated);

        return {
          ...prev,
          [id]: updated,
        };
      });
    },
    []
  );

  // Set active project
  const setActiveProject = useCallback((id: string | null) => {
    setActiveProjectIdState(id);
  }, []);

  // Delete a project
  const deleteProject = useCallback((id: string) => {
    setProjects((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

    setActiveProjectIdState((prev) => (prev === id ? null : prev));
  }, []);

  // Archive a project
  const archiveProject = useCallback((id: string) => {
    updateProject(id, { status: 'archived' });
    setActiveProjectIdState((prev) => (prev === id ? null : prev));
  }, [updateProject]);

  // Get a project by ID
  const getProject = useCallback(
    (id: string): ProjectState | null => {
      return projects[id] || null;
    },
    [projects]
  );

  // Get all projects sorted by updatedAt
  const getAllProjects = useCallback((): ProjectState[] => {
    return Object.values(projects).sort((a, b) => b.updatedAt - a.updatedAt);
  }, [projects]);

  const value: ProjectContextValue = {
    projects,
    activeProjectId,
    activeProject,
    createProject,
    updateProject,
    setActiveProject,
    deleteProject,
    archiveProject,
    getProject,
    getAllProjects,
    isLoading,
  };

  return (
    <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
  );
}

/**
 * Hook to access project context
 */
export function useProject(): ProjectContextValue {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error('useProject must be used within a ProjectProvider');
  }
  return context;
}
