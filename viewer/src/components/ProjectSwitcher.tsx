'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { ChevronDown, Plus } from 'lucide-react';

interface RegistryProject {
  name: string;
  prdMd: string;
  prdJson: string;
  progress: string;
  branch: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface Registry {
  version: number;
  projects: Record<string, RegistryProject>;
  activeProject: string | null;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'bg-neutral-100 text-neutral-600' },
  coding: { label: 'Coding', color: 'bg-neutral-200 text-neutral-700' },
  testing: { label: 'Testing', color: 'bg-amber-100 text-amber-700' },
  done: { label: 'Done', color: 'bg-green-100 text-green-700' },
};

export function ProjectSwitcher() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentProjectId = searchParams.get('projectId');

  const [registry, setRegistry] = useState<Registry | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchRegistry = useCallback(async () => {
    try {
      const res = await fetch('/api/registry');
      if (res.ok) {
        const data = await res.json();
        setRegistry(data);
      }
    } catch {
      // Registry not available
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRegistry();
  }, [fetchRegistry]);

  // No registry or no projects = don't show
  if (loading || !registry || Object.keys(registry.projects).length === 0) {
    return null;
  }

  const projects = Object.entries(registry.projects);
  const activeId = currentProjectId || registry.activeProject;
  const activeProject = activeId ? registry.projects[activeId] : null;

  const handleSelect = (projectId: string) => {
    setIsOpen(false);

    // Update URL with projectId query parameter
    const params = new URLSearchParams(searchParams.toString());
    params.set('projectId', projectId);

    const currentPath = window.location.pathname;
    router.push(`${currentPath}?${params.toString()}`);

    // Also update activeProject in registry
    fetch('/api/registry', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeProject: projectId }),
    }).catch(() => {});
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="flex items-center gap-2 font-medium">
          <span className="max-w-[200px] truncate">
            {activeProject?.name || 'Select Project'}
          </span>
          {activeProject && (
            <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_LABELS[activeProject.status]?.color || 'bg-neutral-100 text-neutral-600'}`}>
              {STATUS_LABELS[activeProject.status]?.label || activeProject.status}
            </span>
          )}
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <div className="px-2 py-1.5 text-xs font-medium uppercase text-muted-foreground">
          Projects
        </div>
        {projects.map(([id, project]) => (
          <button
            key={id}
            onClick={() => handleSelect(id)}
            className={`flex w-full items-center justify-between rounded-md px-2 py-2 text-sm transition-colors ${
              id === activeId
                ? 'bg-accent text-accent-foreground'
                : 'text-foreground hover:bg-accent/50'
            }`}
          >
            <div className="flex flex-col items-start">
              <span className="font-medium">{project.name}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(project.updatedAt).toLocaleDateString()}
              </span>
            </div>
            <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_LABELS[project.status]?.color || 'bg-neutral-100 text-neutral-600'}`}>
              {STATUS_LABELS[project.status]?.label || project.status}
            </span>
          </button>
        ))}
        <div className="border-t mt-1 pt-1">
          <button
            onClick={() => {
              setIsOpen(false);
              router.push('/stage1');
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-accent/50 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Project
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
