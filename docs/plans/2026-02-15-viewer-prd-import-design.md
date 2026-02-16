# Viewer PRD Import Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow Viewer users to import existing `.md` files from their project root and route them into Stage 1's transform mode for gap analysis and PRD normalization.

**Architecture:** New API endpoint scans project root for `.md` files. New ImportPrdDialog component displays them grouped by directory with preview. On confirm, creates session/project and navigates to Stage 1 with transform mode pre-selected. Stage 1 reads URL params to skip mode selector.

**Tech Stack:** Next.js API routes (Node.js fs), React components (Tailwind CSS), existing project-root.ts path resolution

---

## Task 1: Create API endpoint GET /api/files/md

**Files:**
- Create: `viewer/src/app/api/files/md/route.ts`

**Step 1: Create the API route**

```typescript
import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { getProjectRoot } from '@/lib/project-root';

interface MdFileItem {
  path: string;       // relative path from project root, e.g. "tasks/prd-viewer.md"
  name: string;       // filename, e.g. "prd-viewer.md"
  directory: string;   // parent dir relative, e.g. "tasks" or "."
  preview: string;     // first 5 non-empty lines
  size: number;        // file size in bytes
  modifiedAt: string;  // ISO date string
}

const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.turbo',
  '.state', 'archive', '.cache', 'coverage', '__pycache__',
]);

function scanMdFiles(dir: string, rootDir: string, results: MdFileItem[], depth = 0): void {
  if (depth > 4) return; // max 4 levels deep

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.isDirectory()) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) {
        scanMdFiles(fullPath, rootDir, results, depth + 1);
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      try {
        const stats = fs.statSync(fullPath);
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim()).slice(0, 5);
        const relativePath = path.relative(rootDir, fullPath);
        const relativeDir = path.relative(rootDir, dir) || '.';

        results.push({
          path: relativePath,
          name: entry.name,
          directory: relativeDir,
          preview: lines.join('\n'),
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
        });
      } catch {
        // skip unreadable files
      }
    }
  }
}

export async function GET() {
  try {
    const projectRoot = getProjectRoot();
    const files: MdFileItem[] = [];
    scanMdFiles(projectRoot, projectRoot, files);

    // Sort: tasks/ directory first, then by modification time descending
    files.sort((a, b) => {
      const aInTasks = a.directory.startsWith('tasks') ? 0 : 1;
      const bInTasks = b.directory.startsWith('tasks') ? 0 : 1;
      if (aInTasks !== bInTasks) return aInTasks - bInTasks;
      return new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime();
    });

    return NextResponse.json({ files });
  } catch (error) {
    console.error('Error scanning md files:', error);
    return NextResponse.json({ error: 'Failed to scan files' }, { status: 500 });
  }
}
```

**Step 2: Verify the API works**

Run: `cd /Users/boszan/BotoolDev/BotoolAgent/viewer && npx next build 2>&1 | head -20` or just test with `curl http://localhost:3000/api/files/md` if dev server is running.

**Step 3: Commit**

```bash
git add viewer/src/app/api/files/md/route.ts
git commit -m "feat: add GET /api/files/md endpoint for scanning project .md files"
```

---

## Task 2: Create ImportPrdDialog component

**Files:**
- Create: `viewer/src/components/ImportPrdDialog.tsx`

**Step 1: Create the dialog component**

```tsx
'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createSession } from '@/lib/prd-session-storage';
import { useProject } from '@/contexts/ProjectContext';

interface ImportPrdDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

interface MdFileItem {
  path: string;
  name: string;
  directory: string;
  preview: string;
  size: number;
  modifiedAt: string;
}

export function ImportPrdDialog({ isOpen, onClose }: ImportPrdDialogProps) {
  const router = useRouter();
  const { createProject } = useProject();
  const [files, setFiles] = useState<MdFileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<MdFileItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  // Fetch files when dialog opens
  useEffect(() => {
    if (!isOpen) {
      setSelectedFile(null);
      setSearchQuery('');
      setError(null);
      return;
    }

    setLoading(true);
    fetch('/api/files/md')
      .then(res => res.json())
      .then(data => {
        setFiles(data.files || []);
        setError(null);
      })
      .catch(() => setError('无法加载文件列表'))
      .finally(() => setLoading(false));
  }, [isOpen]);

  // Filter files by search query
  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) return files;
    const q = searchQuery.toLowerCase();
    return files.filter(f =>
      f.name.toLowerCase().includes(q) ||
      f.path.toLowerCase().includes(q) ||
      f.preview.toLowerCase().includes(q)
    );
  }, [files, searchQuery]);

  // Group files by directory
  const groupedFiles = useMemo(() => {
    const groups = new Map<string, MdFileItem[]>();
    for (const file of filteredFiles) {
      const dir = file.directory;
      const existing = groups.get(dir) || [];
      existing.push(file);
      groups.set(dir, existing);
    }
    return groups;
  }, [filteredFiles]);

  const handleImport = useCallback(() => {
    if (!selectedFile || isImporting) return;
    setIsImporting(true);

    try {
      // Generate project name from file name
      const projectName = selectedFile.name
        .replace(/\.md$/, '')
        .replace(/^prd-/, '')
        .replace(/[-_]/g, ' ')
        .slice(0, 30);

      // Create session and project
      const sessionId = createSession(projectName);
      createProject(projectName, sessionId);

      // Store the file path for Stage 1 to pick up
      sessionStorage.setItem(`botool-initial-description-${sessionId}`, selectedFile.path);
      sessionStorage.setItem(`botool-requirement-type-${sessionId}`, 'PRD导入');

      // Navigate to Stage 1 with transform mode and file path
      router.push(`/stage1?session=${sessionId}&mode=transform&file=${encodeURIComponent(selectedFile.path)}`);
      onClose();
    } catch (err) {
      console.error('Failed to start import:', err);
      setIsImporting(false);
    }
  }, [selectedFile, isImporting, router, onClose, createProject]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="relative w-full max-w-lg bg-white rounded-lg shadow-xl mx-4 flex flex-col max-h-[80vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-neutral-200">
          <h2 className="text-lg font-semibold text-neutral-900">导入现有文档</h2>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
            aria-label="关闭"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="px-4 pt-3">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜索文件..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-neutral-200 rounded-lg focus:border-violet-500 focus:ring-2 focus:ring-violet-200 outline-none transition-all bg-white text-neutral-900"
            />
          </div>
        </div>

        {/* File List */}
        <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin h-6 w-6 border-2 border-violet-600 border-t-transparent rounded-full" />
              <span className="ml-2 text-sm text-neutral-500">扫描文件中...</span>
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-sm text-red-500">{error}</p>
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-neutral-500">
                {searchQuery ? '没有匹配的文件' : '项目中没有找到 .md 文件'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {Array.from(groupedFiles.entries()).map(([dir, dirFiles]) => (
                <div key={dir}>
                  <p className="text-xs font-medium text-neutral-400 uppercase tracking-wide mb-1.5">
                    {dir === '.' ? '根目录' : dir}/
                  </p>
                  <div className="space-y-1">
                    {dirFiles.map(file => {
                      const isSelected = selectedFile?.path === file.path;
                      return (
                        <button
                          key={file.path}
                          onClick={() => setSelectedFile(isSelected ? null : file)}
                          className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
                            isSelected
                              ? 'border-violet-500 bg-violet-50'
                              : 'border-transparent hover:bg-neutral-50'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 min-w-0">
                              <svg className="w-4 h-4 text-neutral-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                              <span className="text-sm font-medium text-neutral-900 truncate">{file.name}</span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-neutral-400 flex-shrink-0 ml-2">
                              <span>{formatFileSize(file.size)}</span>
                              <span>{formatDate(file.modifiedAt)}</span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Preview */}
        {selectedFile && (
          <div className="px-4 pb-3">
            <div className="rounded-lg bg-neutral-50 border border-neutral-200 p-3 max-h-32 overflow-y-auto">
              <p className="text-xs font-medium text-neutral-500 mb-1.5">预览</p>
              <pre className="text-xs text-neutral-700 font-mono whitespace-pre-wrap leading-relaxed">
                {selectedFile.preview}
              </pre>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-neutral-200 bg-neutral-50">
          <p className="text-xs text-neutral-400">
            {filteredFiles.length} 个 .md 文件
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 transition-colors"
              disabled={isImporting}
            >
              取消
            </button>
            <button
              onClick={handleImport}
              disabled={!selectedFile || isImporting}
              className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:bg-violet-300 disabled:cursor-not-allowed transition-colors"
            >
              {isImporting ? '导入中...' : '开始导入分析'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Export from components/index.ts**

Add to `viewer/src/components/index.ts`:
```typescript
export { ImportPrdDialog } from "./ImportPrdDialog";
```

**Step 3: Commit**

```bash
git add viewer/src/components/ImportPrdDialog.tsx viewer/src/components/index.ts
git commit -m "feat: add ImportPrdDialog component for browsing and selecting .md files"
```

---

## Task 3: Update Dashboard — add import button, remove empty state actions

**Files:**
- Modify: `viewer/src/app/page.tsx`

**Step 1: Add import state and ImportPrdDialog**

In `DashboardContent`, add:
- Import `ImportPrdDialog` in the components import line
- Add state: `const [showImportDialog, setShowImportDialog] = useState(false);`
- Render `<ImportPrdDialog isOpen={showImportDialog} onClose={() => setShowImportDialog(false)} />` alongside existing `NewPrdDialog`

**Step 2: Update PRD section header — add "导入" button**

Change the PRD header area (around line 344-349) from:
```tsx
<button
  onClick={() => setShowNewPrdDialog(true)}
  className="text-sm font-medium text-neutral-500 hover:text-neutral-900 transition-colors"
>
  + 新建
</button>
```

To:
```tsx
<div className="flex items-center gap-3">
  <button
    onClick={() => setShowImportDialog(true)}
    className="text-sm font-medium text-neutral-500 hover:text-neutral-900 transition-colors"
  >
    导入
  </button>
  <button
    onClick={() => setShowNewPrdDialog(true)}
    className="text-sm font-medium text-neutral-500 hover:text-neutral-900 transition-colors"
  >
    + 新建
  </button>
</div>
```

**Step 3: Remove PRD empty state action button**

Change the PRD EmptyState (around line 374-381) from:
```tsx
<EmptyState
  title="暂无需求文档"
  description="创建你的第一个需求文档(PRD)，开始自主开发流程。"
  actionLabel="创建需求文档"
  onAction={() => setShowNewPrdDialog(true)}
/>
```

To:
```tsx
<EmptyState
  title="暂无需求文档"
  description="点击右上角「+ 新建」或「导入」开始。"
/>
```

**Step 4: Commit**

```bash
git add viewer/src/app/page.tsx
git commit -m "feat: add import button to PRD header, remove empty state action buttons"
```

---

## Task 4: Remove "创建新任务" from TaskHistory empty state

**Files:**
- Modify: `viewer/src/components/TaskHistory.tsx`

**Step 1: Remove the Link from EmptyState**

In `TaskHistory.tsx`, change the `EmptyState` function (around line 368-385) from:
```tsx
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-neutral-50/50 p-8 text-center">
      <div className="mb-2 text-3xl text-neutral-300">📋</div>
      <h3 className="text-sm font-medium text-neutral-700">暂无任务历史</h3>
      <p className="mt-1 text-xs text-neutral-500 max-w-xs">
        开始一个新的开发任务后，任务历史将显示在这里
      </p>
      <Link
        href="/stage1"
        className="mt-4 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 transition-colors"
      >
        创建新任务
      </Link>
    </div>
  );
}
```

To:
```tsx
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-neutral-50/50 p-8 text-center">
      <div className="mb-2 text-3xl text-neutral-300">📋</div>
      <h3 className="text-sm font-medium text-neutral-700">暂无任务历史</h3>
      <p className="mt-1 text-xs text-neutral-500 max-w-xs">
        开始一个新的开发任务后，任务历史将显示在这里
      </p>
    </div>
  );
}
```

Also remove the unused `Link` import if it's only used by that button (check if `Link` is used elsewhere in the file first).

**Step 2: Commit**

```bash
git add viewer/src/components/TaskHistory.tsx
git commit -m "feat: remove action button from task history empty state"
```

---

## Task 5: Update Stage 1 to read URL params for transform mode

**Files:**
- Modify: `viewer/src/app/stage1/page.tsx`

**Step 1: Read mode and file from URL search params**

In `Stage1PageContent`, after `const sessionId = searchParams.get('session');` (line 47), add:
```typescript
const urlMode = searchParams.get('mode') as PipelineMode | null;
const urlFile = searchParams.get('file');
```

**Step 2: Auto-set mode and file path from URL params**

Add a new `useEffect` after the initial description loading (after line 166):

```typescript
// Auto-set mode and file from URL params (for import flow from Dashboard)
useEffect(() => {
  if (urlMode === 'transform' && urlFile && !selectedMode && !isStarted) {
    setSelectedMode('transform');
    setTransformFilePath(decodeURIComponent(urlFile));
    // Override initial description with the file path for the CLI skill
    setInitialDescription(decodeURIComponent(urlFile));
  }
}, [urlMode, urlFile, selectedMode, isStarted]);
```

This ensures that when navigating from ImportPrdDialog with `?mode=transform&file=tasks/some-prd.md`, Stage 1 skips mode selector and file input, going straight into the pyramid Q&A.

**Step 3: Commit**

```bash
git add viewer/src/app/stage1/page.tsx
git commit -m "feat: Stage 1 reads mode/file URL params for import flow"
```

---

## Task 6: Build verification

**Step 1: Run typecheck**

Run: `cd /Users/boszan/BotoolDev/BotoolAgent/viewer && npx tsc --noEmit`
Expected: No type errors

**Step 2: Run lint**

Run: `cd /Users/boszan/BotoolDev/BotoolAgent/viewer && npx next lint`
Expected: No errors

**Step 3: Manual smoke test**

1. Open `http://localhost:3000`
2. Verify "导入" button appears left of "+ 新建" in PRD header
3. Click "导入" — dialog opens, shows `.md` files grouped by directory
4. Select a file — preview appears
5. Click "开始导入分析" — navigates to Stage 1 in transform mode
6. Verify PRD empty state has no black button
7. Verify task history empty state has no "创建新任务" button

**Step 4: Final commit if any fixes needed**
