import * as path from 'path';
import * as fs from 'fs';

/**
 * BotoolAgent Path Resolution
 *
 * When BotoolAgent is used as a portable package inside another project,
 * we need to distinguish between two root directories:
 *
 * 1. botoolRoot: Where BotoolAgent itself lives (parent of viewer/)
 *    - Contains: tasks/, archive/, rules/, scripts/, .state/, skills/
 *
 * 2. projectRoot: Where the user's actual project/git repo lives
 *    - Used for: git operations, Claude CLI working directory, prd.json, progress.txt
 *
 * Detection:
 * - If botoolRoot has .git → standalone mode → projectRoot = botoolRoot
 * - If botoolRoot has no .git but parent does → portable mode → projectRoot = parent of botoolRoot
 * - Can override with BOTOOL_PROJECT_ROOT env var
 */

let _botoolRoot: string | null = null;
let _projectRoot: string | null = null;

/**
 * Validate and sanitize a project ID.
 * Only allows [a-zA-Z0-9_-] to prevent path traversal.
 * Exported so callers can validate input early.
 */
export function normalizeProjectId(projectId?: string | null): string | null {
  if (!projectId) return null;

  const trimmed = projectId.trim();
  if (!trimmed) return null;

  // Guard against path traversal and path separator injection.
  if (
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed.includes('..') ||
    trimmed.includes('\0')
  ) {
    console.warn(`[project-root] Ignoring invalid projectId: ${projectId}`);
    return null;
  }

  return trimmed;
}

/**
 * Get the BotoolAgent directory (parent of viewer/).
 * This is where BotoolAgent's own files live: tasks/, archive/, rules/, etc.
 */
export function getBotoolRoot(): string {
  if (_botoolRoot) return _botoolRoot;

  const viewerDir = process.cwd();
  _botoolRoot = viewerDir.endsWith('/viewer')
    ? path.dirname(viewerDir)
    : viewerDir;

  return _botoolRoot;
}

/**
 * Get the user's project root directory.
 * This is where git operations and Claude CLI should run.
 *
 * Detection logic:
 * 1. If BOTOOL_PROJECT_ROOT env var is set, use it
 * 2. If botoolRoot has .git, it IS the project (standalone mode)
 * 3. Otherwise, walk up to find the nearest .git directory (portable mode)
 */
export function getProjectRoot(): string {
  if (_projectRoot) return _projectRoot;

  // Priority 1: Environment variable override
  if (process.env.BOTOOL_PROJECT_ROOT) {
    _projectRoot = process.env.BOTOOL_PROJECT_ROOT;
    return _projectRoot;
  }

  const botoolRoot = getBotoolRoot();

  // Priority 2: Check if botoolRoot itself is a git repo (standalone mode)
  if (fs.existsSync(path.join(botoolRoot, '.git'))) {
    _projectRoot = botoolRoot;
    return _projectRoot;
  }

  // Priority 3: Walk up to find nearest .git (portable mode)
  let current = path.dirname(botoolRoot);
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(current, '.git'))) {
      _projectRoot = current;
      return _projectRoot;
    }
    const parent = path.dirname(current);
    if (parent === current) break; // reached filesystem root
    current = parent;
  }

  // Fallback: use parent of botoolRoot
  _projectRoot = path.dirname(botoolRoot);
  return _projectRoot;
}

/**
 * Check if BotoolAgent is running in portable mode (as a subdirectory of another project).
 */
export function isPortableMode(): boolean {
  return getProjectRoot() !== getBotoolRoot();
}

// Derived paths for convenience
export function getTasksDir(): string {
  return path.join(getBotoolRoot(), 'tasks');
}

export function getArchiveDir(): string {
  return path.join(getBotoolRoot(), 'archive');
}

export function getRulesDir(): string {
  return path.join(getBotoolRoot(), 'rules');
}

export function getRegistryPath(): string {
  return path.join(getTasksDir(), 'registry.json');
}

/**
 * Get the per-project directory path, creating it if it doesn't exist.
 * Path: tasks/{projectId}/
 */
export function getProjectDir(projectId: string): string {
  const safeId = normalizeProjectId(projectId);
  if (!safeId) throw new Error(`Invalid projectId: ${projectId}`);
  const dir = path.join(getTasksDir(), safeId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Get the path to a project's prd.json.
 * New format: tasks/{projectId}/prd.json
 * Backward compat (no projectId): root prd.json
 */
export function getProjectPrdJsonPath(projectId?: string | null): string {
  const safeProjectId = normalizeProjectId(projectId);
  if (!safeProjectId) return getPrdJsonPath();
  return path.join(getTasksDir(), safeProjectId, 'prd.json');
}

/**
 * Get the path to a project's prd.md.
 * New format: tasks/{projectId}/prd.md
 * Backward compat (no projectId): root tasks/prd.md
 */
export function getProjectPrdMdPath(projectId?: string | null): string {
  const safeProjectId = normalizeProjectId(projectId);
  if (!safeProjectId) return path.join(getTasksDir(), 'prd.md');
  return path.join(getTasksDir(), safeProjectId, 'prd.md');
}

/**
 * Get the path to a project's progress file.
 * New format: tasks/{projectId}/progress.txt
 * Backward compat (no projectId): root progress.txt
 */
export function getProjectProgressPath(projectId?: string | null): string {
  const safeProjectId = normalizeProjectId(projectId);
  if (!safeProjectId) return getProgressPath();
  return path.join(getTasksDir(), safeProjectId, 'progress.txt');
}

/**
 * Get the path to a project's prd-session.json (Stage 1 pyramid session).
 * New format: tasks/{projectId}/prd-session.json
 * Backward compat (no projectId): tasks/.prd-sessions.json (global)
 */
export function getProjectSessionPath(projectId?: string | null): string {
  const safeProjectId = normalizeProjectId(projectId);
  if (!safeProjectId) return path.join(getTasksDir(), '.prd-sessions.json');
  return path.join(getTasksDir(), safeProjectId, 'prd-session.json');
}

/**
 * Get the path to a project's teammates.json.
 * New format: tasks/{projectId}/teammates.json
 * Backward compat (no projectId): .state/teammates.json
 */
export function getProjectTeammatesPath(projectId?: string | null): string {
  const safeProjectId = normalizeProjectId(projectId);
  if (!safeProjectId) return path.join(getBotoolRoot(), '.state', 'teammates.json');
  return path.join(getTasksDir(), safeProjectId, 'teammates.json');
}

export function getPrdJsonPath(): string {
  return path.join(getProjectRoot(), 'prd.json');
}

export function getProgressPath(): string {
  return path.join(getProjectRoot(), 'progress.txt');
}

/**
 * Get the agent status file path.
 * New format (with projectId): tasks/{projectId}/agent-status
 * Backward compat (no projectId): .state/agent-status
 */
export function getAgentStatusPath(projectId?: string | null): string {
  const safeProjectId = normalizeProjectId(projectId);
  if (!safeProjectId) return path.join(getBotoolRoot(), '.state', 'agent-status');
  return path.join(getTasksDir(), safeProjectId, 'agent-status');
}

export function getAgentScriptPath(): string {
  return path.join(getBotoolRoot(), 'scripts', 'BotoolAgent.sh');
}

/**
 * Get the agent PID lock file path.
 * New format (with projectId): tasks/{projectId}/agent-pid
 * Backward compat (no projectId): .state/agent-pid
 */
export function getAgentPidPath(projectId?: string | null): string {
  const safeProjectId = normalizeProjectId(projectId);
  if (!safeProjectId) return path.join(getBotoolRoot(), '.state', 'agent-pid');
  return path.join(getTasksDir(), safeProjectId, 'agent-pid');
}

/**
 * Reset cached paths (useful for testing or when env changes)
 */
export function resetPathCache(): void {
  _botoolRoot = null;
  _projectRoot = null;
}
