import { scopedKey } from '@/lib/workspace-id';

export interface TabItem {
  id: string;          // requirementId
  name: string;        // requirement name
  stage: number;       // current stage (1-5)
  isRunning?: boolean; // agent is running
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
