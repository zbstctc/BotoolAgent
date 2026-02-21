'use client';

import { useState, useMemo } from 'react';
import { Settings, Plus, Search, RefreshCw, Scan } from 'lucide-react';
import { RequirementCard } from '@/components/RequirementCard';
import { RequirementDrawer } from '@/components/RequirementDrawer';
import { CreateRequirementDialog } from '@/components/CreateRequirementDialog';
import { Button } from '@/components/ui/button';
import { useRequirement } from '@/contexts/RequirementContext';
import { useTab } from '@/contexts/TabContext';
import type { Requirement, RequirementFilter, RequirementStage } from '@/lib/requirement-types';
import type { TabItem } from '@/lib/tab-storage';

function getStageUrl(req: Requirement): string {
  // Map current stage to target page
  const targetMap: Record<RequirementStage, number> = {
    0: 1, 1: 1, 2: 3, 3: 3, 4: 4, 5: 5,
  };
  const stage = targetMap[req.stage];
  return `/stage${stage}?req=${req.id}`;
}

function filterRequirements(
  requirements: Requirement[],
  filter: RequirementFilter,
  search: string
): Requirement[] {
  let result =
    filter === 'archived'
      ? requirements.filter((r) => r.status === 'archived')
      : requirements.filter((r) => r.status !== 'archived');
  if (search.trim()) {
    const q = search.toLowerCase();
    result = result.filter((r) => r.name.toLowerCase().includes(q));
  }
  return result;
}

function EmptyState({
  filter,
  search,
  onCreateNew,
}: {
  filter: RequirementFilter;
  search: string;
  onCreateNew: () => void;
}) {
  if (search.trim()) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm font-medium text-neutral-700">没有匹配的需求</p>
        <p className="mt-1 text-xs text-neutral-500">
          尝试使用不同的关键词搜索
        </p>
      </div>
    );
  }

  if (filter === 'archived') {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm font-medium text-neutral-700">暂无已归档的需求</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-3 text-4xl text-neutral-200">📋</div>
      <p className="text-sm font-medium text-neutral-700">暂无需求</p>
      <p className="mt-1 text-xs text-neutral-500 max-w-xs">
        创建你的第一个需求，开始自主开发流程
      </p>
      <Button
        className="mt-4 gap-1.5"
        onClick={onCreateNew}
      >
        <Plus className="h-4 w-4" />
        新需求
      </Button>
    </div>
  );
}

export function DashboardContent() {
  const { openTab } = useTab();
  const {
    requirements,
    isLoading,
    selectedId,
    setSelectedId,
    deleteRequirement,
    archiveRequirement,
    refreshRequirements,
  } = useRequirement();

  const [filter, setFilter] = useState<RequirementFilter>('active');
  const [search, setSearch] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const filtered = useMemo(
    () => filterRequirements(requirements, filter, search),
    [requirements, filter, search]
  );

  const selectedReq = useMemo(
    () => requirements.find((r) => r.id === selectedId) ?? null,
    [requirements, selectedId]
  );

  // Counts for filter badges
  const activeCount = useMemo(
    () => requirements.filter((r) => r.status !== 'archived').length,
    [requirements]
  );
  const archivedCount = useMemo(
    () => requirements.filter((r) => r.status === 'archived').length,
    [requirements]
  );

  function handleCardClick(id: string) {
    setSelectedId(id);
    setDrawerOpen(true);
  }

  function handleAction(req: Requirement) {
    const targetMap: Record<RequirementStage, number> = {
      0: 1, 1: 1, 2: 3, 3: 3, 4: 4, 5: 5,
    };
    const stage = targetMap[req.stage];
    const tabItem: TabItem = {
      id: req.id,
      name: req.name,
      stage,
    };
    openTab(tabItem, getStageUrl(req));
  }

  function handleNavigate(stage: RequirementStage) {
    if (!selectedReq) return;
    // Map current stage to target page:
    // Stage 0 (草稿) → /stage1 (PRD generation)
    // Stage 1 (PRD 生成中) → /stage1 (continue)
    // Stage 2 (待开发) → /stage3 (start development)
    // Stage 3+ → same stage page
    const targetMap: Record<RequirementStage, number> = {
      0: 1, 1: 1, 2: 3, 3: 3, 4: 4, 5: 5,
    };
    const stageNum = targetMap[stage];
    const tabItem: TabItem = {
      id: selectedReq.id,
      name: selectedReq.name,
      stage: stageNum,
    };
    openTab(tabItem, `/stage${stageNum}?req=${selectedReq.id}`);
    setDrawerOpen(false);
  }

  function handleDelete(id: string) {
    deleteRequirement(id);
    if (selectedId === id) {
      setSelectedId(null);
      setDrawerOpen(false);
    }
  }

  function handleArchive(id: string) {
    archiveRequirement(id);
    if (selectedId === id) {
      setSelectedId(null);
      setDrawerOpen(false);
    }
  }

  const filterOptions: { key: RequirementFilter; label: string; count: number }[] = [
    { key: 'active', label: '进行中', count: activeCount },
    { key: 'archived', label: '已归档', count: archivedCount },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar: 我的需求 | filters | spacer | refresh | search | 规范 | + 新需求 */}
      <div className="flex items-center gap-3 px-6 py-2.5 border-b border-neutral-200 bg-white flex-shrink-0">
        {/* Title */}
        <h1 className="text-sm font-semibold text-neutral-900 flex-shrink-0">我的需求</h1>

        {/* Divider */}
        <div className="w-px h-4 bg-neutral-200 flex-shrink-0" />

        {/* Filter tabs */}
        <div className="flex items-center gap-1">
          {filterOptions.map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                filter === key
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
              }`}
            >
              {label}
              <span
                className={`ml-1.5 text-xs ${
                  filter === key ? 'text-neutral-300' : 'text-neutral-400'
                }`}
              >
                {count}
              </span>
            </button>
          ))}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Refresh */}
        <button
          onClick={() => refreshRequirements()}
          className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors"
          title="刷新"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>

        {/* Search */}
        <div className="relative w-48">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索需求..."
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-neutral-200 rounded-md bg-white placeholder-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400"
          />
        </div>

        {/* Divider */}
        <div className="w-px h-4 bg-neutral-200 flex-shrink-0" />

        {/* 规范 + 新需求 */}
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => openTab({ id: 'rules', name: '规范管理', stage: 0, url: '/rules' }, '/rules')}
        >
          <Settings className="h-3.5 w-3.5" />
          规范
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => openTab({ id: 'scanner', name: 'Scanner', stage: 0, url: '/scanner', isUtility: true } as TabItem, '/scanner')}
        >
          <Scan className="h-3.5 w-3.5" />
          Scanner
        </Button>
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => setDialogOpen(true)}
        >
          <Plus className="h-4 w-4" />
          新需求
        </Button>
      </div>

      {/* Card list */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-4">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="animate-pulse rounded-lg border border-neutral-200 bg-white p-4 h-24"
                />
              ))}
            </div>
          ) : filtered.length > 0 ? (
            <div className="space-y-3">
              {filtered.map((req) => (
                <RequirementCard
                  key={req.id}
                  requirement={req}
                  isSelected={selectedId === req.id}
                  onClick={() => handleCardClick(req.id)}
                  onAction={() => handleAction(req)}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              filter={filter}
              search={search}
              onCreateNew={() => setDialogOpen(true)}
            />
          )}
        </div>
      </div>

      {/* Requirement Drawer */}
      <RequirementDrawer
        requirement={selectedReq}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onNavigate={handleNavigate}
        onDelete={handleDelete}
        onArchive={handleArchive}
      />

      {/* Create Requirement Dialog */}
      <CreateRequirementDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}
