'use client';

import { DashboardContent } from '@/components/panels/DashboardContent';
import { StageRouter } from '@/components/panels/StageRouter';
import { useTab } from '@/contexts/TabContext';

export interface TabPanelManagerProps {
  children: React.ReactNode;
}

export function TabPanelManager({ children }: TabPanelManagerProps) {
  const { tabs, activeTabId } = useTab();

  // Project tabs: exclude dashboard (always rendered separately) and utility tabs (have url field, use Next.js routing)
  const projectTabs = tabs.filter((t) => t.id !== 'dashboard' && !t.url);

  return (
    <>
      {/* Dashboard panel: always rendered, CSS visibility toggle */}
      <div className={activeTabId === 'dashboard' ? 'block h-full' : 'hidden'}>
        <DashboardContent />
      </div>

      {/* Project tab panels: each rendered with CSS display switching */}
      {projectTabs.map((tab) => (
        <div
          key={tab.id}
          className={tab.id === activeTabId ? 'block h-full' : 'hidden'}
        >
          <StageRouter reqId={tab.id} stage={tab.stage} />
        </div>
      ))}

      {/* Fallback: show Next.js children for unmanaged routes (utility tabs like /rules) */}
      {tabs.some((t) => t.id === activeTabId && t.url) && (
        <div className="h-full">
          {children}
        </div>
      )}
    </>
  );
}
