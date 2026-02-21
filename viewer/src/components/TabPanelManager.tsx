'use client';

import { useEffect, useState, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { DashboardContent } from '@/components/panels/DashboardContent';
import { StageRouter } from '@/components/panels/StageRouter';
import { RulesManager } from '@/components/rules/RulesManager';
import { ScannerPanel } from '@/components/Scanner/ScannerPanel';
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
  // Lazy-mount ScannerPanel only after the Scanner tab is first activated.
  // This ensures ReactFlow's onInit fires while the container is visible (non-zero
  // dimensions), so fitView works correctly on first render.
  const [scannerMounted, setScannerMounted] = useState(false);
  const { requirements, isLoading: isRequirementsLoading } = useRequirement();
  // Capture URL reqId once on mount (lazy initializer, no effect needed)
  // Setter used by "返回 Dashboard" to clear the pending URL reqId
  const [urlReqId, setUrlReqId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const reqId = params.get('req');
    return reqId && isValidReqId(reqId) ? reqId : null;
  });

  // Detect direct URL navigation to utility pages (e.g. bookmark to /scanner).
  // Captured once on mount using window.location (not usePathname, which doesn't update
  // after history.replaceState tab switches).
  const [urlUtility] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const m = window.location.pathname.match(/^\/(scanner)$/);
    return m ? m[1] : null;
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

  // Utility URL bootstrap: when the user navigates directly to /scanner (e.g. bookmark),
  // create and activate the Scanner utility tab so the header tab bar is in sync.
  useEffect(() => {
    if (!urlUtility || !isHydrated) return;
    if (urlUtility === 'scanner') {
      const scannerTab: TabItem = { id: 'scanner', name: 'Scanner', stage: 0, url: '/scanner', isUtility: true };
      if (!tabs.some((t) => t.id === 'scanner')) {
        openTab(scannerTab, '/scanner');
      } else if (activeTabId !== 'scanner') {
        switchTab('scanner', '/scanner');
      }
    }
  }, [urlUtility, isHydrated, tabs, activeTabId, openTab, switchTab]);

  // Trigger lazy mount of ScannerPanel the first time Scanner tab becomes active.
  // Direct-URL case (/scanner) is handled by the urlUtility bootstrap effect above,
  // which sets activeTabId to 'scanner' before this effect fires.
  useEffect(() => {
    if (activeTabId === 'scanner') {
      setScannerMounted(true);
    }
  }, [activeTabId]);

  // Determine if the current route is managed by the panel system.
  // Dashboard and Rules are always managed (activeTabId-based, not pathname-based).
  // Stage tabs are managed when a project tab is active.
  // Special case: when dashboard is active but we're on a standalone /stageN URL
  // (no ?req=), fall through to Next.js children so direct navigation works.
  // Note: we use pathname here only to detect standalone stage URLs; we don't
  // use pathname === '/' because history.replaceState doesn't update usePathname().
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const isOnStandaloneStageUrl = /^\/stage\d+/.test(pathname);
  // Utility routes that Next.js should render as standalone pages when dashboard is active.
  // Scanner has its own Next.js page (/scanner) which should show via children when navigated
  // directly (e.g., bookmark) even if the dashboard tab is currently active.
  const isOnStandaloneUtilityUrl = /^\/(scanner)/.test(pathname);
  const isManagedRoute =
    (activeTabId === 'dashboard' && !isOnStandaloneStageUrl && !isOnStandaloneUtilityUrl) ||
    activeTabId === 'rules' ||
    activeTabId === 'scanner' ||
    isOnStandaloneUtilityUrl ||
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

        {/* Rules panel: always rendered, CSS visibility toggle */}
        <div className={activeTabId === 'rules' ? 'block h-full' : 'hidden'}>
          <RulesManager />
        </div>

        {/* Scanner utility panel: lazy-mounted on first activation, CSS visibility toggle */}
        <div className={activeTabId === 'scanner' ? 'block h-full' : 'hidden'}>
          {scannerMounted && <ScannerPanel />}
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
