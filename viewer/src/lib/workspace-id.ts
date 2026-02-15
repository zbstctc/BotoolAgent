/**
 * Workspace ID for localStorage key scoping.
 * Client-side module cache set by ProjectProvider.
 */

// --- Client-side API ---

let _workspaceId: string | null = null;

export function setWorkspaceId(id: string): void {
  _workspaceId = id;
}

export function getWorkspaceId(): string | null {
  return _workspaceId;
}

/** Generate a scoped localStorage key. Falls back to legacy key when uninitialized. */
export function scopedKey(baseKey: string): string {
  if (!_workspaceId) return `botool-${baseKey}`;
  return `botool-${_workspaceId}-${baseKey}`;
}
