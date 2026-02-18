'use client';

import { useState } from 'react';
import { LayoutDashboard, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTab } from '@/contexts/TabContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { TabItem } from '@/lib/tab-storage';

interface TabBarProps {
  className?: string;
}

export function TabBar({ className }: TabBarProps) {
  const { tabs, activeTabId, closeTab, switchTab } = useTab();
  const [closeConfirmId, setCloseConfirmId] = useState<string | null>(null);

  function getTabUrl(tab: TabItem): string {
    const stage = tab.stage === 0 ? 1 : tab.stage;
    return `/stage${stage}?req=${tab.id}`;
  }

  function handleTabClick(tab: TabItem) {
    if (tab.id === activeTabId) return;
    switchTab(tab.id, getTabUrl(tab));
  }

  function handleDashboardClick() {
    if (activeTabId === 'dashboard') return;
    switchTab('dashboard', '/');
  }

  function handleClose(e: React.MouseEvent, tab: TabItem) {
    e.stopPropagation();
    if (tab.isRunning) {
      setCloseConfirmId(tab.id);
    } else {
      closeTab(tab.id);
    }
  }

  function handleConfirmClose() {
    if (closeConfirmId) {
      closeTab(closeConfirmId);
      setCloseConfirmId(null);
    }
  }

  const runningTabName = closeConfirmId
    ? tabs.find((t) => t.id === closeConfirmId)?.name ?? ''
    : '';

  return (
    <>
      <div className={cn('flex items-end gap-0.5 h-full', className)}>
        {/* Dashboard tab */}
        <button
          onClick={handleDashboardClick}
          className={cn(
            'flex items-center gap-1.5 px-3 h-9 text-sm font-medium rounded-t-md border border-b-0 transition-colors',
            activeTabId === 'dashboard'
              ? 'bg-white border-neutral-200 text-neutral-900'
              : 'bg-neutral-100 border-transparent text-neutral-500 hover:text-neutral-700 hover:bg-neutral-50'
          )}
        >
          <LayoutDashboard className="h-3.5 w-3.5" />
          <span>Dashboard</span>
        </button>

        {/* Project tabs */}
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabClick(tab)}
            className={cn(
              'group relative flex items-center gap-1.5 px-3 h-9 text-sm font-medium rounded-t-md border border-b-0 transition-colors max-w-[180px]',
              activeTabId === tab.id
                ? 'bg-white border-neutral-200 text-neutral-900'
                : 'bg-neutral-100 border-transparent text-neutral-500 hover:text-neutral-700 hover:bg-neutral-50'
            )}
          >
            {tab.isRunning && (
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse flex-shrink-0" />
            )}
            <span className="truncate max-w-[120px]">{tab.name}</span>
            <span className="text-xs text-neutral-400 flex-shrink-0">(S{tab.stage === 0 ? 1 : tab.stage})</span>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => handleClose(e, tab)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') handleClose(e as unknown as React.MouseEvent, tab);
              }}
              className="ml-1 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-neutral-200 transition-opacity flex-shrink-0"
            >
              <X className="h-3 w-3" />
            </span>
          </button>
        ))}
      </div>

      {/* Close confirmation dialog */}
      <Dialog open={!!closeConfirmId} onOpenChange={(open) => !open && setCloseConfirmId(null)}>
        <DialogContent className="sm:max-w-sm bg-white">
          <DialogHeader>
            <DialogTitle>Agent 正在运行</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-neutral-600">
            该项目「{runningTabName}」的 Agent 仍在后台运行。
            关闭标签页不会停止 Agent，你可以稍后从 Dashboard 重新打开。
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseConfirmId(null)}>
              取消
            </Button>
            <Button onClick={handleConfirmClose}>
              关闭标签页
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
