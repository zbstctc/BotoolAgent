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
  // Capture URL reqId once on mount (lazy initializer, no effect needed)
  // Setter used by "返回 Dashboard" to clear the pending URL reqId
  const [urlReqId, setUrlReqId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const reqId = params.get('req');
    return reqId && isValidReqId(reqId) ? reqId : null;
  });

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
  // Once the tab is activated (or created), urlReqId is cleared so the effect won't
  // re-force activeTabId when the user switches tabs or closes the URL-activated tab.
  useEffect(() => {
    if (!urlReqId || !isHydrated) return;

    // Already in tabs → ensure it's active, then clear URL bootstrap state
    if (tabs.some((t) => t.id === urlReqId)) {
      if (activeTabId !== urlReqId) {
        const stageNum = STAGE_TO_PAGE[tabs.find((t) => t.id === urlReqId)!.stage] ?? 1;
        switchTab(urlReqId, `/stage${stageNum}?req=${urlReqId}`);
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUrlReqId(null);
      return;
    }

    // Wait for requirements to finish loading before looking up
    if (isRequirementsLoading) return;

    // Look up requirement and open tab (if found, tab appears in `tabs` on next render)
    const requirement = requirements.find((r) => r.id === urlReqId);
    if (requirement) {
      const newTab: TabItem = {
        id: requirement.id,
        name: requirement.name,
        stage: requirement.stage,
      };
      const stageNum = STAGE_TO_PAGE[requirement.stage] ?? 1;
      openTab(newTab, `/stage${stageNum}?req=${requirement.id}`);
      setUrlReqId(null);
    }
    // "not found" case: urlReqId stays set so urlNotFound is derived below
  }, [urlReqId, isHydrated, isRequirementsLoading, requirements, tabs, activeTabId, openTab, switchTab]);

  // Determine if the current route is managed by the panel system.
  // Dashboard is managed only on '/'; stage URLs without a tab context (no ?req=)
  // fall through to Next.js children so direct navigation still works.
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const isManagedRoute =
    (activeTabId === 'dashboard' && pathname === '/') ||
    (activeTab != null && !activeTab.url && activeTabId !== 'dashboard');

  // Project tabs: exclude dashboard and utility tabs
  const projectTabs = tabs.filter((t) => t.id !== 'dashboard' && !t.url);

  // Hydration guard: show empty placeholder until localStorage tabs are loaded
  if (!isHydrated) {
    return <div className="h-full" />;
  }

  // Derive URL fallback states entirely from existing data (no useState needed)
  const urlInTabs = !!urlReqId && tabs.some((t) => t.id === urlReqId);
  const urlNotFound = !!urlReqId && !isRequirementsLoading && !urlInTabs &&
    !requirements.some((r) => r.id === urlReqId);
  const isUrlLoading = !!urlReqId && !urlInTabs && !urlNotFound;

  // URL fallback: loading while checking requirements
  if (isUrlLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground text-sm">加载中...</div>
      </div>
    );
  }

  // URL fallback: project not found
  if (urlNotFound) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground text-sm">项目未找到或已被删除</p>
        <Button
          variant="outline"
          onClick={() => {
            setUrlReqId(null);
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
