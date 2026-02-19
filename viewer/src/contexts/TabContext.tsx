'use client';

import { createContext, useContext, useState, useCallback, useEffect, useRef, startTransition } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { TabItem } from '@/lib/tab-storage';
import { loadTabs, saveTabs } from '@/lib/tab-storage';

interface TabContextValue {
  tabs: TabItem[];
  activeTabId: string;
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
  const router = useRouter();
  const pathname = usePathname();

  const [tabs, setTabs] = useState<TabItem[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('dashboard');

  // Load from localStorage on mount
  useEffect(() => {
    const stored = loadTabs();
    startTransition(() => {
      setTabs(stored.tabs);
      setActiveTabId(stored.activeTabId);
    });
  }, []);

  // Persist to localStorage on changes
  const saveRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (saveRef.current) clearTimeout(saveRef.current);
    saveRef.current = setTimeout(() => {
      saveTabs({ tabs, activeTabId });
    }, 300);
    return () => {
      if (saveRef.current) clearTimeout(saveRef.current);
    };
  }, [tabs, activeTabId]);

  // Keep a ref of activeTabId so the pathname effect can read it without
  // adding it as a dependency (avoids potential update cycles).
  const activeTabIdRef = useRef(activeTabId);
  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  // Keep a ref of tabs for the pathname sync effect
  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  // Sync activeTabId + tab stage from pathname changes
  useEffect(() => {
    if (pathname === '/') {
      startTransition(() => setActiveTabId('dashboard'));
      return;
    }

    // Match utility tabs by their fixed URL
    const utilityTab = tabsRef.current.find((t) => t.url && pathname.startsWith(t.url));
    if (utilityTab) {
      startTransition(() => setActiveTabId(utilityTab.id));
      return;
    }

    // Match /stage{n} pattern (e.g. /stage1, /stage2, ...)
    const stageMatch = pathname.match(/^\/stage(\d+)/);
    if (stageMatch) {
      const stageNum = parseInt(stageMatch[1], 10);
      const currentActiveId = activeTabIdRef.current;
      if (currentActiveId && currentActiveId !== 'dashboard') {
        startTransition(() => setTabs((prev) =>
          prev.map((t) => t.id === currentActiveId && !t.url ? { ...t, stage: stageNum } : t)
        ));
      }
    }
  }, [pathname]);

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
    router.push(url);
  }, [router]);

  const closeTab = useCallback((id: string) => {
    if (id === 'dashboard') return; // Dashboard cannot be closed
    const wasActive = activeTabIdRef.current === id;
    setTabs((prev) => prev.filter((t) => t.id !== id));
    if (wasActive) {
      setActiveTabId('dashboard');
      router.push('/');
    }
  }, [router]);

  const switchTab = useCallback((id: string, url: string) => {
    setActiveTabId(id);
    // Auto clear attention when switching to a tab
    setTabs((prev) => prev.map((t) => t.id === id && t.needsAttention ? { ...t, needsAttention: false } : t));
    router.push(url);
  }, [router]);

  const updateTabName = useCallback((id: string, name: string) => {
    setTabs((prev) => prev.map((t) => t.id === id ? { ...t, name } : t));
  }, []);

  const updateTabStage = useCallback((id: string, stage: number) => {
    setTabs((prev) => prev.map((t) => t.id === id ? { ...t, stage } : t));
  }, []);

  const updateTabRunning = useCallback((id: string, isRunning: boolean) => {
    setTabs((prev) => prev.map((t) => t.id === id ? { ...t, isRunning } : t));
  }, []);

  const updateTabStatus = useCallback((id: string, status: string, progress?: { completed: number; total: number }) => {
    setTabs((prev) => prev.map((t) => {
      if (t.id !== id) return t;
      const updated: TabItem = { ...t, agentStatus: status };
      if (progress !== undefined) updated.progress = progress;
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
