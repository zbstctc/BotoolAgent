'use client';

import Link from 'next/link';
import { Suspense, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Settings, Plus, Search } from 'lucide-react';
import { RequirementCard } from '@/components/RequirementCard';
import { RequirementDrawer } from '@/components/RequirementDrawer';
import { CreateRequirementDialog } from '@/components/CreateRequirementDialog';
import { Button } from '@/components/ui/button';
import { useRequirement } from '@/contexts/RequirementContext';
import type { Requirement, RequirementFilter, RequirementStage } from '@/lib/requirement-types';

function getStageUrl(req: Requirement): string {
  const stage = req.stage === 0 ? 1 : req.stage;
  return `/stage${stage}?req=${req.id}`;
}

function filterRequirements(
  requirements: Requirement[],
  filter: RequirementFilter,
  search: string
): Requirement[] {
  let result = requirements.filter((r) => r.status !== 'archived');
  if (filter === 'active') result = result.filter((r) => r.status === 'active');
  if (filter === 'completed') result = result.filter((r) => r.status === 'completed');
  if (search.trim()) {
    const q = search.toLowerCase();
    result = result.filter((r) => r.name.toLowerCase().includes(q));
  }
  return result;
}

function DashboardContent() {
  const router = useRouter();
  const {
    requirements,
    isLoading,
    selectedId,
    setSelectedId,
    deleteRequirement,
    archiveRequirement,
  } = useRequirement();

  const [filter, setFilter] = useState<RequirementFilter>('all');
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
    () => requirements.filter((r) => r.status === 'active').length,
    [requirements]
  );
  const completedCount = useMemo(
    () => requirements.filter((r) => r.status === 'completed').length,
    [requirements]
  );
  const totalCount = activeCount + completedCount;

  function handleCardClick(id: string) {
    setSelectedId(id);
    setDrawerOpen(true);
  }

  function handleAction(req: Requirement) {
    router.push(getStageUrl(req));
  }

  function handleNavigate(stage: RequirementStage) {
    if (!selectedReq) return;
    const stageNum = stage === 0 ? 1 : stage;
    router.push(`/stage${stageNum}?req=${selectedReq.id}`);
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
    { key: 'all', label: '全部', count: totalCount },
    { key: 'active', label: '进行中', count: activeCount },
    { key: 'completed', label: '已完成', count: completedCount },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Page header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 bg-white flex-shrink-0">
        <h1 className="text-lg font-semibold text-neutral-900">我的需求</h1>
        <div className="flex items-center gap-2">
          <Link href="/rules">
            <Button variant="outline" size="sm" className="gap-1.5">
              <Settings className="h-3.5 w-3.5" />
              规范
            </Button>
          </Link>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => setDialogOpen(true)}
          >
            <Plus className="h-4 w-4" />
            新需求
          </Button>
        </div>
      </div>

      {/* Filter + search bar */}
      <div className="flex items-center gap-4 px-6 py-3 border-b border-neutral-100 bg-white flex-shrink-0">
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

        {/* Search */}
        <div className="relative flex-1 max-w-xs ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索需求..."
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-neutral-200 rounded-md bg-white placeholder-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400"
          />
        </div>
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
              hasRequirements={requirements.filter((r) => r.status !== 'archived').length > 0}
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

function EmptyState({
  hasRequirements,
  filter,
  search,
  onCreateNew,
}: {
  hasRequirements: boolean;
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

  if (hasRequirements && filter !== 'all') {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm font-medium text-neutral-700">
          暂无{filter === 'active' ? '进行中' : '已完成'}的需求
        </p>
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

function DashboardFallback() {
  return (
    <div className="flex h-full items-center justify-center bg-neutral-50 text-sm text-neutral-500">
      加载中...
    </div>
  );
}

export default function Dashboard() {
  return (
    <Suspense fallback={<DashboardFallback />}>
      <DashboardContent />
    </Suspense>
  );
}
