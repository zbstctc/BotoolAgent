import { scopedKey } from '@/lib/workspace-id';

export interface TabItem {
  id: string;          // requirementId or special id (e.g. 'rules')
  name: string;        // requirement name or tab label
  stage: number;       // current stage (1-5), 0 for utility tabs
  isRunning?: boolean; // agent is running
  url?: string;        // fixed URL for utility tabs (overrides stage-based URL)
  agentStatus?: string;       // agent-status raw value (e.g. 'running', 'complete', 'error')
  needsAttention?: boolean;   // flashing indicator when user action needed
  progress?: { completed: number; total: number }; // task progress
}

export interface TabStorage {
  tabs: TabItem[];
  activeTabId: string; // 'dashboard' | requirementId
}

const TABS_KEY = scopedKey('tabs');

const DEFAULT_STORAGE: TabStorage = { tabs: [], activeTabId: 'dashboard' };

export function loadTabs(): TabStorage {
  if (typeof window === 'undefined') return DEFAULT_STORAGE;
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (!raw) return DEFAULT_STORAGE;
    const parsed = JSON.parse(raw);
    // Validate shape to guard against corrupt/tampered localStorage
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray(parsed.tabs) ||
      typeof parsed.activeTabId !== 'string'
    ) {
      return DEFAULT_STORAGE;
    }
    // Filter out malformed tab entries
    const validTabs = (parsed.tabs as unknown[]).filter(
      (t): t is TabItem =>
        !!t && typeof t === 'object' && typeof (t as TabItem).id === 'string' && typeof (t as TabItem).stage === 'number',
    );
    return { tabs: validTabs, activeTabId: parsed.activeTabId };
  } catch {
    return DEFAULT_STORAGE;
  }
}

export function saveTabs(storage: TabStorage): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TABS_KEY, JSON.stringify(storage));
}
