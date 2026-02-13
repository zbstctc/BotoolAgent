'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

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
  coding: { label: 'Coding', color: 'bg-blue-100 text-blue-700' },
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
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
      >
        <span className="max-w-[200px] truncate">
          {activeProject?.name || 'Select Project'}
        </span>
        {activeProject && (
          <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_LABELS[activeProject.status]?.color || 'bg-neutral-100 text-neutral-600'}`}>
            {STATUS_LABELS[activeProject.status]?.label || activeProject.status}
          </span>
        )}
        <svg className="h-4 w-4 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-neutral-200 bg-white shadow-lg">
            <div className="p-2">
              <div className="px-2 py-1.5 text-xs font-medium uppercase text-neutral-400">
                Projects
              </div>
              {projects.map(([id, project]) => (
                <button
                  key={id}
                  onClick={() => handleSelect(id)}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-2 text-sm transition-colors ${
                    id === activeId
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-neutral-700 hover:bg-neutral-50'
                  }`}
                >
                  <div className="flex flex-col items-start">
                    <span className="font-medium">{project.name}</span>
                    <span className="text-xs text-neutral-400">
                      {new Date(project.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_LABELS[project.status]?.color || 'bg-neutral-100 text-neutral-600'}`}>
                    {STATUS_LABELS[project.status]?.label || project.status}
                  </span>
                </button>
              ))}
            </div>
            <div className="border-t border-neutral-100 p-2">
              <button
                onClick={() => {
                  setIsOpen(false);
                  router.push('/stage1');
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-neutral-600 hover:bg-neutral-50 transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Project
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
