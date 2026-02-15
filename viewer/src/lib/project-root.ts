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
 * Get the path to a project's prd.json.
 * If projectId is provided, reads from tasks/prd-{projectId}.json
 * Otherwise falls back to the root prd.json (backward compatible).
 */
export function getProjectPrdJsonPath(projectId?: string | null): string {
  if (!projectId) return getPrdJsonPath();
  return path.join(getTasksDir(), `prd-${projectId}.json`);
}

/**
 * Get the path to a project's progress file.
 * If projectId is provided, reads from tasks/progress-{projectId}.txt
 * Otherwise falls back to the root progress.txt (backward compatible).
 */
export function getProjectProgressPath(projectId?: string | null): string {
  if (!projectId) return getProgressPath();
  return path.join(getTasksDir(), `progress-${projectId}.txt`);
}

export function getPrdJsonPath(): string {
  return path.join(getProjectRoot(), 'prd.json');
}

export function getProgressPath(): string {
  return path.join(getProjectRoot(), 'progress.txt');
}

export function getAgentStatusPath(): string {
  return path.join(getBotoolRoot(), '.state', 'agent-status');
}

export function getAgentScriptPath(): string {
  return path.join(getBotoolRoot(), 'scripts', 'BotoolAgent.sh');
}

export function getAgentPidPath(): string {
  return path.join(getBotoolRoot(), '.state', 'agent-pid');
}

/**
 * Reset cached paths (useful for testing or when env changes)
 */
export function resetPathCache(): void {
  _botoolRoot = null;
  _projectRoot = null;
}
