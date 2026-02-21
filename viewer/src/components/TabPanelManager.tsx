'use client';

import { DashboardContent } from '@/components/panels/DashboardContent';
import { StageRouter } from '@/components/panels/StageRouter';
import { useTab } from '@/contexts/TabContext';

export interface TabPanelManagerProps {
  children: React.ReactNode;
}

export function TabPanelManager({ children }: TabPanelManagerProps) {
  const { tabs, activeTabId } = useTab();

  // Determine if the current route is managed by the panel system
  // Use activeTabId (not pathname) since tab switches use history.replaceState which doesn't trigger usePathname updates
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const isManagedRoute = activeTabId === 'dashboard' || (activeTab != null && !activeTab.url);

  // Project tabs: exclude dashboard (always rendered separately) and utility tabs (have url field, use Next.js routing)
  const projectTabs = tabs.filter((t) => t.id !== 'dashboard' && !t.url);

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
