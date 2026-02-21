'use client';

import { useEffect, useState, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { DashboardContent } from '@/components/panels/DashboardContent';
import { StageRouter } from '@/components/panels/StageRouter';
import { useTab, isValidReqId } from '@/contexts/TabContext';
import { useRequirement } from '@/contexts/RequirementContext';
import { Button } from '@/components/ui/button';
import type { TabItem } from '@/lib/tab-storage';

// Map requirement stage to target page number
const STAGE_TO_PAGE: Record<number, number> = { 0: 1, 1: 1, 2: 3, 3: 3, 4: 4, 5: 5 };

export interface TabPanelManagerProps {
  children: React.ReactNode;
}

export function TabPanelManager({ children }: TabPanelManagerProps) {
  const { tabs, activeTabId, isHydrated, openTab, switchTab, updateTabStage } = useTab();
  const { requirements, isLoading: isRequirementsLoading } = useRequirement();
  const [urlFallbackState, setUrlFallbackState] = useState<'idle' | 'loading' | 'not-found'>('idle');
  const urlProcessedRef = useRef(false);

  // usePathname detects router.push() navigations from stage components.
  // Tab switches use history.replaceState which does NOT trigger usePathname, so
  // this only fires for inter-stage transitions (Stage1→Stage2, Stage3→Stage4, etc.)
  const pathname = usePathname();
  const prevPathnameRef = useRef(pathname);

  // Sync router.push navigation from stage components to tab state
  useEffect(() => {
    if (!isHydrated) return;

    const prevPathname = prevPathnameRef.current;
    prevPathnameRef.current = pathname;

    // Only react to actual changes (not initial mount)
    if (pathname === prevPathname) return;

    // router.push('/') from stage components → switch to dashboard
    if (pathname === '/') {
      if (activeTabId !== 'dashboard') {
        switchTab('dashboard', '/');
      }
      return;
    }

    // router.push('/stageN?...') from stage components → update tab stage
    const stageMatch = pathname.match(/^\/stage(\d+)/);
    if (stageMatch) {
      const pageNum = parseInt(stageMatch[1], 10);

      // Only sync if this is an inter-stage transition from the active project tab.
      // Guard: URL must have ?req=, ?prd=, or ?projectId= to prove it's a stage
      // transition, not standalone navigation (e.g. ProjectSwitcher "New Project").
      const urlParams = new URLSearchParams(window.location.search);
      const hasStageContext =
        urlParams.has('req') || urlParams.has('prd') || urlParams.has('projectId');

      if (hasStageContext && activeTabId !== 'dashboard') {
        const activeProjectTab = tabs.find((t) => t.id === activeTabId);
        if (activeProjectTab && !activeProjectTab.url && activeProjectTab.stage !== pageNum) {
          updateTabStage(activeTabId, pageNum);
          // Add req param if missing (preserve existing params like ?prd=, ?mode=, ?projectId=)
          if (!urlParams.has('req')) {
            urlParams.set('req', activeTabId);
            history.replaceState(null, '', `${pathname}?${urlParams.toString()}`);
          }
        }
      }
    }
  }, [pathname, isHydrated, activeTabId, tabs, switchTab, updateTabStage]);

  // URL-based tab creation: handle direct URL access (e.g. shared link /stage3?req=xxx)
  useEffect(() => {
    if (!isHydrated || urlProcessedRef.current) return;

    // Parse URL for reqId
    const params = new URLSearchParams(window.location.search);
    const reqId = params.get('req');

    // No req param → not a direct URL access, nothing to do
    if (!reqId) {
      urlProcessedRef.current = true;
      return;
    }

    // Invalid UUID → silently ignore, show Dashboard
    if (!isValidReqId(reqId)) {
      urlProcessedRef.current = true;
      return;
    }

    // Already in tabs → activate it
    if (tabs.some((t) => t.id === reqId)) {
      // If not already active, switch to it
      if (activeTabId !== reqId) {
        const stageNum = STAGE_TO_PAGE[tabs.find((t) => t.id === reqId)!.stage] ?? 1;
        switchTab(reqId, `/stage${stageNum}?req=${reqId}`);
      }
      urlProcessedRef.current = true;
      return;
    }

    // Wait for requirements to finish loading before looking up
    if (isRequirementsLoading) {
      setUrlFallbackState('loading');
      return;
    }

    // Look up requirement
    const requirement = requirements.find((r) => r.id === reqId);
    if (requirement) {
      const newTab: TabItem = {
        id: requirement.id,
        name: requirement.name,
        stage: requirement.stage,
      };
      const stageNum = STAGE_TO_PAGE[requirement.stage] ?? 1;
      openTab(newTab, `/stage${stageNum}?req=${requirement.id}`);
      urlProcessedRef.current = true;
      setUrlFallbackState('idle');
    } else {
      // Requirement not found
      urlProcessedRef.current = true;
      setUrlFallbackState('not-found');
    }
  }, [isHydrated, isRequirementsLoading, requirements, tabs, activeTabId, openTab, switchTab]);

  // Determine if the current route is managed by the panel system
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const isManagedRoute = activeTabId === 'dashboard' || (activeTab != null && !activeTab.url);

  // Project tabs: exclude dashboard and utility tabs
  const projectTabs = tabs.filter((t) => t.id !== 'dashboard' && !t.url);

  // Hydration guard: show empty placeholder until localStorage tabs are loaded
  if (!isHydrated) {
    return <div className="h-full" />;
  }

  // URL fallback: loading while checking requirements
  if (urlFallbackState === 'loading') {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground text-sm">加载中...</div>
      </div>
    );
  }

  // URL fallback: project not found
  if (urlFallbackState === 'not-found') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground text-sm">项目未找到或已被删除</p>
        <Button
          variant="outline"
          onClick={() => {
            setUrlFallbackState('idle');
            switchTab('dashboard', '/');
          }}
        >
          返回 Dashboard
        </Button>
      </div>
    );
  }

  return (
    <>
      {/* Managed panels: visible only when on a managed route */}
      <div className={isManagedRoute ? 'contents' : 'hidden'}>
        {/* Dashboard panel: always rendered, CSS visibility toggle */}
        <div className={activeTabId === 'dashboard' ? 'block h-full' : 'hidden'}>
          <DashboardContent />
        </div>

        {/* Project tab panels: each rendered with CSS display switching */}
        {projectTabs.map((tab) => (
          <div
            key={tab.id + '-' + tab.stage}
            className={tab.id === activeTabId ? 'block h-full' : 'hidden'}
          >
            <StageRouter reqId={tab.id} stage={tab.stage} />
          </div>
        ))}
      </div>

      {/* Unmanaged routes: show Next.js children for /rules, stage routes without ?req=, etc. */}
      <div className={isManagedRoute ? 'hidden' : 'h-full'}>
        {children}
      </div>
    </>
  );
}
