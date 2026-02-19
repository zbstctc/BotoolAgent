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

export function loadTabs(): TabStorage {
  if (typeof window === 'undefined') {
    return { tabs: [], activeTabId: 'dashboard' };
  }
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (!raw) return { tabs: [], activeTabId: 'dashboard' };
    return JSON.parse(raw) as TabStorage;
  } catch {
    return { tabs: [], activeTabId: 'dashboard' };
  }
}

export function saveTabs(storage: TabStorage): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TABS_KEY, JSON.stringify(storage));
}
