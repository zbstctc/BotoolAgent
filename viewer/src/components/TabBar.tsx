'use client';

import { useState, useRef, useCallback } from 'react';
import { usePathname } from 'next/navigation';
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
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { TabItem } from '@/lib/tab-storage';

const RUNNING_STATUSES = new Set(['running', 'starting', 'waiting_network']);
const ERROR_STATUSES = new Set(['error', 'failed', 'stopped']);

const STAGE_NAMES: Record<number, string> = {
  1: 'PRD 编写',
  2: '任务规划',
  3: '自动开发',
  4: '测试验证',
  5: '合并发布',
};

function getStatusBadge(agentStatus?: string): { label: string; variant: 'success' | 'warning' | 'error' } {
  if (!agentStatus) return { label: '空闲', variant: 'warning' };
  if (RUNNING_STATUSES.has(agentStatus)) return { label: '运行中', variant: 'success' };
  if (ERROR_STATUSES.has(agentStatus)) return { label: '错误', variant: 'error' };
  if (agentStatus === 'complete') return { label: '完成', variant: 'success' };
  return { label: '空闲', variant: 'warning' };
}

function getStatusBorderClass(tab: TabItem): string {
  if (tab.needsAttention) return 'animate-pulse-border-amber';
  if (!tab.agentStatus) return 'border-amber-400'; // no status = pending
  if (RUNNING_STATUSES.has(tab.agentStatus)) return 'border-green-500';
  if (ERROR_STATUSES.has(tab.agentStatus)) return 'border-red-500';
  return 'border-amber-400'; // idle/complete/session_done etc
}

interface TabBarProps {
  className?: string;
}

export function TabBar({ className }: TabBarProps) {
  const { tabs, activeTabId, closeTab, switchTab } = useTab();
  const pathname = usePathname();
  const [closeConfirmId, setCloseConfirmId] = useState<string | null>(null);
  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback((tabId: string) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setHoveredTabId(tabId);
    }, 300);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
    setHoveredTabId(null);
  }, []);

  function getTabUrl(tab: TabItem): string {
    if (tab.url) return tab.url;
    // Use the same stage→target mapping as page.tsx getStageUrl()
    const targetMap: Record<number, number> = { 0: 1, 1: 1, 2: 3, 3: 3, 4: 4, 5: 5 };
    const stage = targetMap[tab.stage] ?? tab.stage;
    return `/stage${stage}?req=${tab.id}`;
  }

  function handleTabClick(tab: TabItem) {
    if (tab.id === activeTabId) return;
    switchTab(tab.id, getTabUrl(tab));
  }

  function handleDashboardClick() {
    if (pathname === '/') return;
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
            pathname === '/'
              ? 'bg-white border-neutral-200 text-neutral-900'
              : 'bg-neutral-100 border-transparent text-neutral-500 hover:text-neutral-700 hover:bg-neutral-50'
          )}
        >
          <LayoutDashboard className="h-3.5 w-3.5" />
          <span>Dashboard</span>
        </button>

        {/* Project tabs */}
        {tabs.map((tab) => {
          const isActive = activeTabId === tab.id;
          const statusBorder = tab.url ? undefined : getStatusBorderClass(tab);
          const displayName = tab.name.replace(/^PRD:\s*/i, '');
          const isUtility = !!tab.url;
          const isPopoverOpen = hoveredTabId === tab.id;

          const tabButton = (
            <button
              onClick={() => handleTabClick(tab)}
              onMouseEnter={isUtility ? undefined : () => handleMouseEnter(tab.id)}
              onMouseLeave={isUtility ? undefined : handleMouseLeave}
              className={cn(
                'group relative flex items-center gap-1.5 px-3 h-9 text-sm font-medium rounded-t-md border-2 border-b-0 transition-colors max-w-[180px]',
                isActive
                  ? 'bg-white text-neutral-900'
                  : 'bg-neutral-100 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-50',
                statusBorder ?? (isActive ? 'border-neutral-200' : 'border-transparent')
              )}
            >
              <span className="truncate max-w-[120px]">{displayName}</span>
              {!isUtility && (
                <span className="text-xs text-neutral-400 flex-shrink-0">(S{tab.stage})</span>
              )}
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
          );

          if (isUtility) {
            return <div key={tab.id}>{tabButton}</div>;
          }

          const badge = getStatusBadge(tab.agentStatus);

          return (
            <Popover key={tab.id} open={isPopoverOpen}>
              <PopoverTrigger asChild>
                {tabButton}
              </PopoverTrigger>
              <PopoverContent
                side="bottom"
                align="start"
                className={cn('w-64 p-3 bg-white')}
                onMouseEnter={() => handleMouseEnter(tab.id)}
                onMouseLeave={handleMouseLeave}
                onOpenAutoFocus={(e) => e.preventDefault()}
                onCloseAutoFocus={(e) => e.preventDefault()}
              >
                <div className="space-y-2">
                  {/* Project name */}
                  <p className="text-sm font-medium text-neutral-900 truncate">
                    {tab.name}
                  </p>

                  {/* Stage description */}
                  <p className="text-xs text-neutral-500">
                    阶段 {tab.stage}：{STAGE_NAMES[tab.stage] ?? `Stage ${tab.stage}`}
                  </p>

                  {/* Progress bar */}
                  {tab.progress && tab.progress.total > 0 && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-neutral-500">
                        <span>进度</span>
                        <span>{tab.progress.completed}/{tab.progress.total}</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-neutral-100">
                        <div
                          className="h-1.5 rounded-full bg-neutral-900 transition-all"
                          style={{
                            width: `${Math.round((tab.progress.completed / tab.progress.total) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Status badge */}
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </div>
              </PopoverContent>
            </Popover>
          );
        })}
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
