'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useProject, type ProjectStage } from '@/contexts/ProjectContext';

interface UseProjectValidationOptions {
  /** The stage number this hook is being used on */
  currentStage: ProjectStage;
  /** Whether to skip validation (e.g., when loading from URL params) */
  skipValidation?: boolean;
}

interface UseProjectValidationResult {
  /** Whether the project state is valid for this stage */
  isValid: boolean;
  /** The active project, if any */
  activeProject: ReturnType<typeof useProject>['activeProject'];
  /** Whether the project context is still loading */
  isLoading: boolean;
}

/**
 * Hook to validate project state when entering a Stage page.
 *
 * Validates that:
 * 1. If there's an active project, its currentStage matches the page's stage
 * 2. The project is in an active (not archived/completed) state
 *
 * If validation fails, redirects to the correct stage or Dashboard.
 */
export function useProjectValidation({
  currentStage,
  skipValidation = false,
}: UseProjectValidationOptions): UseProjectValidationResult {
  const router = useRouter();
  const { activeProject, isLoading } = useProject();
  const hasValidatedRef = useRef(false);

  useEffect(() => {
    // Skip if already validated, still loading, or validation is disabled
    if (hasValidatedRef.current || isLoading || skipValidation) {
      return;
    }

    // No active project - this is OK for Stage 1 (creating new project)
    // For other stages, we might want to redirect to Dashboard
    if (!activeProject) {
      hasValidatedRef.current = true;
      // Stage 1 is the entry point, so allow it without active project
      if (currentStage !== 1) {
        // For other stages, redirect to Dashboard if no active project
        // But only if there's no URL params that might provide context
        // (URL params are handled by skipValidation)
        router.push('/');
      }
      return;
    }

    // Active project exists - validate its state
    hasValidatedRef.current = true;

    // Check if project is archived or completed
    if (activeProject.status === 'archived' || activeProject.status === 'completed') {
      // Redirect to Dashboard - can't work on completed/archived projects
      router.push('/');
      return;
    }

    // Check if current stage matches the project's stage
    // Allow being on the same stage or earlier stages (for review/edit)
    // But redirect if trying to access a later stage than where the project is
    if (currentStage > activeProject.currentStage) {
      // User is trying to access a stage they haven't reached yet
      router.push(`/stage${activeProject.currentStage}`);
      return;
    }
  }, [activeProject, currentStage, isLoading, router, skipValidation]);

  // Determine if the state is valid
  const isValid: boolean = !isLoading && Boolean(
    // No active project is valid for Stage 1
    (!activeProject && currentStage === 1) ||
    // Active project with matching or earlier stage is valid
    (activeProject &&
     activeProject.status !== 'archived' &&
     activeProject.status !== 'completed' &&
     currentStage <= activeProject.currentStage)
  );

  return {
    isValid,
    activeProject,
    isLoading,
  };
}
