'use client';

import { createContext, useContext, useState, useCallback, useEffect, useRef, startTransition } from 'react';
import type { TabItem } from '@/lib/tab-storage';
import { loadTabs, saveTabs } from '@/lib/tab-storage';

// UUID format validation for reqId
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isValidReqId(id: string): boolean {
  return UUID_REGEX.test(id);
}

interface TabContextValue {
  tabs: TabItem[];
  activeTabId: string;
  isHydrated: boolean;
  openTab: (item: TabItem, url: string) => void;
  closeTab: (id: string) => void;
  switchTab: (id: string, url: string) => void;
  updateTabName: (id: string, name: string) => void;
  updateTabStage: (id: string, stage: number) => void;
  updateTabRunning: (id: string, isRunning: boolean) => void;
  updateTabStatus: (id: string, status: string, progress?: { completed: number; total: number }) => void;
  setNeedsAttention: (id: string, needsAttention: boolean) => void;
}

const TabContext = createContext<TabContextValue | null>(null);

export function TabProvider({ children }: { children: React.ReactNode }) {
  const [tabs, setTabs] = useState<TabItem[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('dashboard');
  const [isHydrated, setIsHydrated] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const stored = loadTabs();
    startTransition(() => {
      setTabs(stored.tabs);
      setActiveTabId(stored.activeTabId);
      setIsHydrated(true);
    });
  }, []);

  // Persist to localStorage on changes (only after hydration to prevent overwriting saved data)
  const saveRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!isHydrated) return;
    if (saveRef.current) clearTimeout(saveRef.current);
    saveRef.current = setTimeout(() => {
      saveTabs({ tabs, activeTabId });
    }, 300);
    return () => {
      if (saveRef.current) clearTimeout(saveRef.current);
    };
  }, [tabs, activeTabId, isHydrated]);

  const openTab = useCallback((item: TabItem, url: string) => {
    setTabs((prev) => {
      const existing = prev.find((t) => t.id === item.id);
      if (existing) {
        // Already exists: just switch
        return prev;
      }
      return [...prev, item];
    });
    setActiveTabId(item.id);
    // Only allow relative paths to prevent javascript: URI or open redirect
    if (url.startsWith('/')) history.replaceState(null, '', url);
  }, []);

  const closeTab = useCallback((id: string) => {
    if (id === 'dashboard') return; // Dashboard cannot be closed
    setTabs((prev) => prev.filter((t) => t.id !== id));
    // Read activeTabId directly (not via updater) so history.replaceState
    // runs outside the React render cycle, avoiding "update Router while rendering" error
    if (activeTabId === id) {
      history.replaceState(null, '', '/');
      setActiveTabId('dashboard');
    }
  }, [activeTabId]);

  const switchTab = useCallback((id: string, url: string) => {
    setActiveTabId(id);
    // Auto clear attention when switching to a tab
    setTabs((prev) => prev.map((t) => t.id === id && t.needsAttention ? { ...t, needsAttention: false } : t));
    // Only allow relative paths to prevent javascript: URI or open redirect
    if (url.startsWith('/')) history.replaceState(null, '', url);
  }, []);

  const updateTabName = useCallback((id: string, name: string) => {
    setTabs((prev) => prev.map((t) => t.id === id ? { ...t, name } : t));
  }, []);

  const updateTabStage = useCallback((id: string, stage: number) => {
    // Clear stale agentStatus and progress when stage changes
    setTabs((prev) => prev.map((t) => {
      if (t.id !== id) return t;
      const { agentStatus: _a, progress: _p, ...rest } = t;
      return { ...rest, stage };
    }));
  }, []);

  const updateTabRunning = useCallback((id: string, isRunning: boolean) => {
    setTabs((prev) => prev.map((t) => t.id === id ? { ...t, isRunning } : t));
  }, []);

  const updateTabStatus = useCallback((id: string, status: string, progress?: { completed: number; total: number }) => {
    setTabs((prev) => prev.map((t) => {
      if (t.id !== id) return t;
      const updated: TabItem = { ...t, agentStatus: status };
      // Always sync progress: explicitly clear when not provided to avoid stale data
      updated.progress = progress;
      return updated;
    }));
  }, []);

  const setNeedsAttention = useCallback((id: string, needsAttention: boolean) => {
    setTabs((prev) => prev.map((t) => t.id === id ? { ...t, needsAttention } : t));
  }, []);

  return (
    <TabContext.Provider
      value={{
        tabs,
        activeTabId,
        isHydrated,
        openTab,
        closeTab,
        switchTab,
        updateTabName,
        updateTabStage,
        updateTabRunning,
        updateTabStatus,
        setNeedsAttention,
      }}
    >
      {children}
    </TabContext.Provider>
  );
}

export function useTab(): TabContextValue {
  const context = useContext(TabContext);
  if (!context) throw new Error('useTab must be used within TabProvider');
  return context;
}
