# Dashboard Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the fragmented Dashboard (3 data sources, 2 sections + sidebar) with a unified requirement pipeline — one card per requirement, 6-stage progress bar, slide-out drawer for details.

**Architecture:** Full-width card list + right slide-out Sheet drawer. New `Requirement` entity merges Project + PRD + Session. New `/api/requirements` endpoint aggregates data from localStorage, file system (`tasks/`), and `.archive/`. Stage pages receive `req={id}` param and resolve all needed context from the Requirement.

**Tech Stack:** Next.js App Router, React Context + localStorage, shadcn/ui (Sheet, Badge, Button, Dialog), Tailwind v4, lucide-react icons.

**Design Document:** See git commit `dfcfcb1` for the full design with wireframes.

---

### Task 1: Install shadcn Sheet + Define Requirement Types

**Files:**
- Create: `viewer/src/components/ui/sheet.tsx` (via shadcn CLI)
- Create: `viewer/src/lib/requirement-types.ts`

**Step 1: Install shadcn Sheet component**

Run: `cd viewer && npx shadcn@latest add sheet`

This will create `src/components/ui/sheet.tsx` — the slide-out drawer primitive we need for the detail panel.

**Step 2: Create requirement type definitions**

Create `viewer/src/lib/requirement-types.ts`:

```typescript
/**
 * Unified Requirement entity — merges Project + PRD + Session.
 * This is the single source of truth for the Dashboard.
 */

export type RequirementStage = 0 | 1 | 2 | 3 | 4 | 5;
export type RequirementStatus = 'active' | 'completed' | 'archived';

export interface Requirement {
  id: string;
  name: string;
  stage: RequirementStage;
  status: RequirementStatus;

  // Stage 0 data
  sourceFile?: string;       // Original file path (DRAFT-*.md or imported .md)
  description?: string;      // Short user description

  // Stage 1 data
  prdId?: string;            // Generated PRD file ID (slug from prd-{slug}.md)
  prdSessionId?: string;     // Pyramid Q&A session ID

  // Stage 2 data
  prdJsonPath?: string;      // prd.json path
  taskCount?: number;        // Total dev tasks

  // Stage 3-5 data
  branchName?: string;       // Git branch name
  tasksCompleted?: number;   // Completed task count
  prUrl?: string;            // PR URL

  // Meta
  createdAt: number;
  updatedAt: number;
}

/** Stage display metadata */
export const STAGE_META: Record<RequirementStage, { label: string; labelActive?: string }> = {
  0: { label: '草稿' },
  1: { label: 'PRD 已完成', labelActive: 'PRD 生成中' },
  2: { label: '已规划', labelActive: '规划中' },
  3: { label: '开发完成', labelActive: '开发中' },
  4: { label: '测试通过', labelActive: '测试中' },
  5: { label: '已合并', labelActive: '待合并' },
};

/** Filter tabs on Dashboard */
export type RequirementFilter = 'all' | 'active' | 'completed';
```

**Step 3: Verify typecheck passes**

Run: `cd viewer && npx tsc --noEmit`
Expected: No errors.

**Step 4: Commit**

```bash
git add viewer/src/components/ui/sheet.tsx viewer/src/lib/requirement-types.ts
git commit -m "feat: add shadcn Sheet + Requirement type definitions"
```

---

### Task 2: Create Unified Requirements API

**Files:**
- Create: `viewer/src/app/api/requirements/route.ts`
- Reference: `viewer/src/app/api/prd/route.ts:87-201` (status/stage logic to reuse)
- Reference: `viewer/src/app/api/sessions/route.ts:176-221` (extended session logic)

**Step 1: Create the API route**

Create `viewer/src/app/api/requirements/route.ts`:

This endpoint aggregates all data sources into a unified `Requirement[]`:

1. Scan `tasks/DRAFT-*.md` → Stage 0 requirements
2. Scan `tasks/prd-*.md` (excluding markers and transformed sources) → Stage 1+ requirements
3. Scan `tasks/prd-*-导入转换中.md` → Stage 0→1 transition (link to parent requirement)
4. Read localStorage-persisted requirement data (passed via query param or cookie)
5. Cross-reference `.archive/` sessions for Stage 3-5 data (branch, PR, task progress)
6. Merge all sources into deduplicated `Requirement[]`

Key logic:
- **DRAFT files**: Extract title from `# Heading` or filename (`DRAFT-foo-bar.md` → "Foo Bar")
- **PRD files**: Reuse `determinePRDStatus()` and `computeStage()` from existing `/api/prd/route.ts`
- **Import markers**: Don't create separate requirements — attach to parent requirement as Stage 0→1 transition info
- **Deduplication**: Match by prdId or sourceFile path

```typescript
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import type { Requirement, RequirementStage } from '@/lib/requirement-types';

const TASKS_DIR = path.join(process.cwd(), '..', 'tasks');

function extractTitleFromMarkdown(content: string): string | null {
  const match = content.match(/^#\s+(.+)/m);
  return match ? match[1].trim() : null;
}

function titleFromFilename(filename: string): string {
  return filename
    .replace(/^DRAFT-/, '')
    .replace(/\.md$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

export async function GET() {
  const requirements: Requirement[] = [];

  if (!fs.existsSync(TASKS_DIR)) {
    return NextResponse.json({ requirements: [] });
  }

  const files = fs.readdirSync(TASKS_DIR);

  // 1. DRAFT-*.md → Stage 0
  for (const file of files) {
    if (!file.startsWith('DRAFT-') || !file.endsWith('.md')) continue;
    const filePath = path.join(TASKS_DIR, file);
    const stat = fs.statSync(filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    const title = extractTitleFromMarkdown(content) || titleFromFilename(file);

    requirements.push({
      id: `draft-${file.replace(/\.md$/, '').toLowerCase()}`,
      name: title,
      stage: 0,
      status: 'active',
      sourceFile: `tasks/${file}`,
      createdAt: stat.birthtimeMs,
      updatedAt: stat.mtimeMs,
    });
  }

  // 2. prd-*.md (excluding markers and transformed sources) → Stage 1+
  // Load .prd-sessions.json for transformed source tracking
  let transformedSources: Set<string> = new Set();
  const sessionsPath = path.join(TASKS_DIR, '.prd-sessions.json');
  if (fs.existsSync(sessionsPath)) {
    try {
      const sessions = JSON.parse(fs.readFileSync(sessionsPath, 'utf-8'));
      for (const val of Object.values(sessions)) {
        const v = val as { transformedFrom?: string };
        if (v.transformedFrom) transformedSources.add(v.transformedFrom);
      }
    } catch { /* ignore */ }
  }

  for (const file of files) {
    if (!file.startsWith('prd-') || !file.endsWith('.md')) continue;
    if (file.includes('导入转换中')) continue; // Skip import markers
    if (transformedSources.has(file)) continue; // Skip transformed sources

    const filePath = path.join(TASKS_DIR, file);
    const stat = fs.statSync(filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    const title = extractTitleFromMarkdown(content) || titleFromFilename(file);
    const prdId = file.replace(/^prd-/, '').replace(/\.md$/, '');

    // Determine stage from prd.json / archive
    const stage = await inferStageFromPrd(prdId);

    requirements.push({
      id: `prd-${prdId}`,
      name: title,
      stage,
      status: stage === 5 ? 'completed' : 'active',
      prdId,
      createdAt: stat.birthtimeMs,
      updatedAt: stat.mtimeMs,
    });
  }

  // Sort by updatedAt descending
  requirements.sort((a, b) => b.updatedAt - a.updatedAt);

  return NextResponse.json({ requirements });
}
```

The `inferStageFromPrd()` helper checks:
- Does a corresponding `prd.json` (or `{slug}/prd.json`) exist? → Stage 2+
- Does `.archive/{slug}` exist with completed tasks? → Stage 3-5
- Is branch merged? → Stage 5 completed

**Step 2: Verify API works**

Run: `curl -s http://localhost:3100/api/requirements | jq '.requirements | length'`
Expected: A number > 0 (matching DRAFT + prd files in tasks/)

**Step 3: Commit**

```bash
git add viewer/src/app/api/requirements/route.ts
git commit -m "feat: add unified /api/requirements endpoint"
```

---

### Task 3: Create RequirementContext

**Files:**
- Create: `viewer/src/contexts/RequirementContext.tsx`
- Modify: `viewer/src/app/layout.tsx` (wrap with provider)
- Reference: `viewer/src/contexts/ProjectContext.tsx` (pattern to follow)

**Step 1: Create RequirementContext**

Create `viewer/src/contexts/RequirementContext.tsx`:

This context:
- Fetches requirements from `/api/requirements` on mount
- Stores user-created requirements in localStorage (for Stage 0 items created via dialog)
- Merges API data with localStorage data
- Provides CRUD methods: `createRequirement`, `updateRequirement`, `deleteRequirement`, `archiveRequirement`
- Tracks `selectedRequirementId` for the drawer
- Provides `refreshRequirements()` for manual refresh

Key interface:

```typescript
interface RequirementContextValue {
  requirements: Requirement[];
  isLoading: boolean;
  selectedId: string | null;
  selectRequirement: (id: string | null) => void;
  createRequirement: (name: string, sourceFile?: string) => string; // returns ID
  updateRequirement: (id: string, data: Partial<Requirement>) => void;
  deleteRequirement: (id: string) => void;
  archiveRequirement: (id: string) => void;
  refreshRequirements: () => Promise<void>;
}
```

Storage: localStorage key `scopedKey('requirements')` for user-created entries. API-sourced entries (from file system) are fetched fresh each time.

**Step 2: Add provider to layout**

Modify `viewer/src/app/layout.tsx` — wrap children with `<RequirementProvider>` inside `<ProjectProvider>` (keep ProjectProvider for now for backward compat).

**Step 3: Verify typecheck**

Run: `cd viewer && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add viewer/src/contexts/RequirementContext.tsx viewer/src/app/layout.tsx
git commit -m "feat: add RequirementContext with unified data source"
```

---

### Task 4: Build StageProgressBar Component

**Files:**
- Create: `viewer/src/components/StageProgressBar.tsx`

**Step 1: Create the component**

Create `viewer/src/components/StageProgressBar.tsx`:

A horizontal 6-dot progress indicator showing Stage 0-5.

Props:
```typescript
interface StageProgressBarProps {
  currentStage: RequirementStage;
  className?: string;
}
```

Rendering:
- 6 dots connected by lines
- Completed stages: solid dot (bg-foreground)
- Current stage: solid dot with pulse animation (animate-pulse)
- Future stages: hollow dot (border only, border-muted-foreground/30)
- Connecting lines: solid for completed, dashed for future

Use Tailwind classes, no external libraries. Keep it simple — just dots and lines.

**Step 2: Verify it renders**

Can be tested by temporarily importing in page.tsx, or just verify typecheck:
Run: `cd viewer && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add viewer/src/components/StageProgressBar.tsx
git commit -m "feat: add StageProgressBar component (6-stage progress indicator)"
```

---

### Task 5: Build RequirementCard Component

**Files:**
- Create: `viewer/src/components/RequirementCard.tsx`
- Reference: `viewer/src/components/ProjectCard.tsx` (pattern to replace)

**Step 1: Create the component**

Create `viewer/src/components/RequirementCard.tsx`:

A full-width card displaying one requirement with progress bar, stage label, and action button.

Props:
```typescript
interface RequirementCardProps {
  requirement: Requirement;
  isSelected?: boolean;        // Highlighted when drawer is open
  onClick: () => void;         // Opens drawer
  onAction: () => void;        // Primary action (开始/继续/合并)
}
```

Layout (single row):
```
┌──────────────────────────────────────────────────────┐
│ [Title]                                              │
│ [●━━●━━●━━○━━○━━○]  Stage 2 · 待规划    [继续 →]   │
│ 2 月 17 日更新 · 6 个任务                             │
└──────────────────────────────────────────────────────┘
```

Details:
- Card uses `rounded-lg border bg-background` styling
- `isSelected` adds `ring-2 ring-primary` highlight
- Click on card body → `onClick` (opens drawer)
- Click on action button → `onAction` (navigates to stage), use `e.stopPropagation()` to prevent drawer
- Action button text: Stage 0 → "开始 →", Stage 1-4 → "继续 →", Stage 5 → "合并 →", completed → hidden
- Stage badge uses `Badge` component with variant from STAGE_META
- Footer shows relative time + task count (if Stage 2+)
- Hover effect: subtle `bg-muted/50` background

**Step 2: Verify typecheck**

Run: `cd viewer && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add viewer/src/components/RequirementCard.tsx
git commit -m "feat: add RequirementCard with 6-stage progress bar"
```

---

### Task 6: Build StageTimeline + RequirementDrawer

**Files:**
- Create: `viewer/src/components/StageTimeline.tsx`
- Create: `viewer/src/components/RequirementDrawer.tsx`

**Step 1: Create StageTimeline**

Create `viewer/src/components/StageTimeline.tsx`:

A vertical timeline showing all 6 stages with status indicators.

Props:
```typescript
interface StageTimelineProps {
  requirement: Requirement;
  onStageAction?: (stage: RequirementStage) => void;
}
```

Rendering:
- Vertical list of 6 stages
- Each stage shows: status icon + stage name + subtitle + optional action button
- Completed: `CheckCircle2` icon (green)
- Current: `Circle` icon with pulse (primary color) + action button
- Future: `Circle` icon (muted)
- Subtitle shows contextual info: source file for Stage 0, prd filename for Stage 1, task count for Stage 2, etc.

**Step 2: Create RequirementDrawer**

Create `viewer/src/components/RequirementDrawer.tsx`:

Uses shadcn `Sheet` component (side="right").

Props:
```typescript
interface RequirementDrawerProps {
  requirement: Requirement | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (stage: RequirementStage) => void;
  onDelete: () => void;
  onArchive: () => void;
}
```

Layout:
- **Header**: Requirement name + more actions popover (archive/delete)
- **Stage Timeline**: `StageTimeline` component
- **Task Details** (if Stage 2+): List of dev tasks with completion status
  - Fetch from `/api/prd/{prdId}` or parsed from prd.json
- **Git Info** (if Stage 3+): Branch name, PR URL link

Sheet width: `sm:max-w-md` (about 448px).

**Step 3: Verify typecheck**

Run: `cd viewer && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add viewer/src/components/StageTimeline.tsx viewer/src/components/RequirementDrawer.tsx
git commit -m "feat: add StageTimeline + RequirementDrawer components"
```

---

### Task 7: Build CreateRequirementDialog

**Files:**
- Create: `viewer/src/components/CreateRequirementDialog.tsx`
- Reference: `viewer/src/components/NewPrdDialog.tsx:33-273` (create flow)
- Reference: `viewer/src/components/ImportPrdDialog.tsx:45-346` (import flow)

**Step 1: Create the unified dialog**

Create `viewer/src/components/CreateRequirementDialog.tsx`:

Combines NewPrdDialog + ImportPrdDialog into one dialog with two tabs/modes.

Props:
```typescript
interface CreateRequirementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
```

Layout:
```
┌──────────────────────────────────────┐
│ 新需求                               │
│ ─────────────────────────────────────│
│ [从头开始]  [导入已有文档]            │  ← Two tab buttons
│                                      │
│ (Tab 1: Create from scratch)         │
│   需求类型: [新功能] [改功能] ...     │
│   描述: [_________________]          │
│   标题: [auto-generated_____]        │
│                                      │
│ (Tab 2: Import existing)             │
│   搜索文件: [_______________]        │
│   [file list from tasks/]            │
│                                      │
│              [取消]  [创建/导入]      │
└──────────────────────────────────────┘
```

Key logic:
- **Create mode**: Same as NewPrdDialog — generates title, creates session + requirement, navigates to `/stage1?req={id}`
- **Import mode**: Same as ImportPrdDialog — lists .md files, checks for duplicates, creates marker + requirement, navigates to `/stage1?req={id}&mode=transform&file={path}`
- Both modes use `RequirementContext.createRequirement()` instead of `ProjectContext.createProject()`

**Step 2: Verify typecheck**

Run: `cd viewer && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add viewer/src/components/CreateRequirementDialog.tsx
git commit -m "feat: add unified CreateRequirementDialog (create + import)"
```

---

### Task 8: Rewrite Dashboard Page

**Files:**
- Modify: `viewer/src/app/page.tsx` (complete rewrite, 938 lines → ~300 lines)

**Step 1: Rewrite page.tsx**

Replace the entire `DashboardContent` component. The new structure:

```typescript
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRequirements } from '@/contexts/RequirementContext';
import { RequirementCard } from '@/components/RequirementCard';
import { RequirementDrawer } from '@/components/RequirementDrawer';
import { CreateRequirementDialog } from '@/components/CreateRequirementDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, Settings, Search } from 'lucide-react';
import type { RequirementFilter, RequirementStage } from '@/lib/requirement-types';

function DashboardContent() {
  const router = useRouter();
  const { requirements, isLoading, selectedId, selectRequirement, deleteRequirement, archiveRequirement } = useRequirements();
  const [filter, setFilter] = useState<RequirementFilter>('all');
  const [search, setSearch] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const selectedReq = requirements.find(r => r.id === selectedId) ?? null;

  const filtered = requirements.filter(r => {
    if (filter === 'active' && r.status !== 'active') return false;
    if (filter === 'completed' && r.status !== 'completed') return false;
    if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const counts = {
    all: requirements.length,
    active: requirements.filter(r => r.status === 'active').length,
    completed: requirements.filter(r => r.status === 'completed').length,
  };

  function handleNavigate(req: Requirement, stage?: RequirementStage) {
    const targetStage = stage ?? req.stage;
    const stageRoute = targetStage === 0 ? 1 : targetStage;
    router.push(`/stage${stageRoute}?req=${req.id}`);
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">Botool Agent</h1>
          <Badge variant="secondary">Viewer</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => router.push('/rules')}>
            <Settings className="h-4 w-4 mr-1" /> 规范
          </Button>
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="h-4 w-4 mr-1" /> 新需求
          </Button>
        </div>
      </header>

      {/* Filter bar */}
      <div className="px-6 py-3 border-b flex items-center justify-between">
        <div className="flex gap-1">
          {(['all', 'active', 'completed'] as const).map(f => (
            <Button key={f} variant={filter === f ? 'default' : 'ghost'} size="sm"
              onClick={() => setFilter(f)}>
              {{ all: '全部', active: '进行中', completed: '已完成' }[f]}
              ({counts[f]})
            </Button>
          ))}
        </div>
        <div className="relative w-64">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="搜索..." className="pl-8" value={search}
            onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Card list */}
      <main className="px-6 py-4 space-y-3">
        {isLoading ? <LoadingSkeleton /> : filtered.length === 0 ? <EmptyState /> :
          filtered.map(req => (
            <RequirementCard key={req.id} requirement={req}
              isSelected={req.id === selectedId}
              onClick={() => selectRequirement(req.id)}
              onAction={() => handleNavigate(req)} />
          ))
        }
      </main>

      {/* Drawer */}
      <RequirementDrawer requirement={selectedReq}
        open={!!selectedId} onOpenChange={open => { if (!open) selectRequirement(null); }}
        onNavigate={(stage) => selectedReq && handleNavigate(selectedReq, stage)}
        onDelete={() => { if (selectedId) deleteRequirement(selectedId); selectRequirement(null); }}
        onArchive={() => { if (selectedId) archiveRequirement(selectedId); selectRequirement(null); }}
      />

      {/* Create dialog */}
      <CreateRequirementDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} />
    </div>
  );
}
```

Keep the existing `EmptyState` component (simplified for new layout), remove all inline sub-components (PRDCard, SessionCard, modals).

**Step 2: Verify the page renders**

Run: `cd viewer && npx tsc --noEmit`
Then visit `http://localhost:3100` and verify:
- Header with "规范" and "+ 新需求" buttons
- Filter bar with counts
- Requirement cards with 6-stage progress bars
- Clicking a card opens the drawer

**Step 3: Commit**

```bash
git add viewer/src/app/page.tsx
git commit -m "feat: rewrite Dashboard with unified requirement cards"
```

---

### Task 9: Create Rules Settings Page

**Files:**
- Create: `viewer/src/app/rules/page.tsx`
- Reference: `viewer/src/app/page.tsx` (current RulesManager usage at line ~287-290)

**Step 1: Create the rules page**

Create `viewer/src/app/rules/page.tsx`:

Move the `RulesManager` component to its own page at `/rules`.

```typescript
import { RulesManager } from '@/components/RulesManager';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function RulesPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-4 flex items-center gap-3">
        <Link href="/">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <h1 className="text-xl font-bold">规范管理</h1>
      </header>
      <main className="px-6 py-4">
        <RulesManager />
      </main>
    </div>
  );
}
```

**Step 2: Verify navigation works**

Visit `http://localhost:3100/rules` and confirm RulesManager renders.
Click back arrow to return to Dashboard.

**Step 3: Commit**

```bash
git add viewer/src/app/rules/page.tsx
git commit -m "feat: move rules management to /rules page"
```

---

### Task 10: Stage Page Routing Compatibility

**Files:**
- Modify: `viewer/src/app/stage1/page.tsx` (add `req` param support)
- Modify: `viewer/src/app/stage2/page.tsx` (add `req` param support)
- Modify: `viewer/src/app/stage3/page.tsx` (add `req` param support)
- Modify: `viewer/src/app/stage4/page.tsx` (add `req` param support)
- Modify: `viewer/src/app/stage5/page.tsx` (add `req` param support)

**Step 1: Add compatibility layer**

Each stage page already reads `searchParams`. Add `req` param handling:

```typescript
// At top of each stage page component:
const reqId = searchParams.get('req');

// If reqId is provided, resolve the old params from RequirementContext:
// - session → requirement.prdSessionId
// - prd → requirement.prdId
// - mode → inferred from requirement.sourceFile
// - file → requirement.sourceFile
```

This is a thin translation layer — read `req` param, look up the Requirement from context/API, and map to existing internal variables. No changes to the stage page internal logic.

For Stage 1 specifically:
- If `req` param present and requirement has `sourceFile` → set `mode=transform` and `file=sourceFile`
- If `req` param present and requirement has `prdSessionId` → resume that session

**Step 2: Verify backward compatibility**

Old URLs like `/stage1?session=xxx` should still work (the old params are checked first, `req` is fallback).

Run: `cd viewer && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add viewer/src/app/stage1/page.tsx viewer/src/app/stage2/page.tsx viewer/src/app/stage3/page.tsx viewer/src/app/stage4/page.tsx viewer/src/app/stage5/page.tsx
git commit -m "feat: add req param routing to all stage pages"
```

---

### Task 11: Clean Up Deprecated Components

**Files:**
- Delete: `viewer/src/components/ProjectCard.tsx`
- Delete: `viewer/src/components/TaskHistory.tsx`
- Delete: `viewer/src/components/NewPrdDialog.tsx`
- Delete: `viewer/src/components/ImportPrdDialog.tsx`
- Modify: `viewer/src/app/page.tsx` (remove any remaining old imports)

**Step 1: Verify no remaining imports of deprecated components**

Search for imports of old components:

Run: `cd viewer && grep -rn "ProjectCard\|TaskHistory\|NewPrdDialog\|ImportPrdDialog" src/ --include="*.tsx" --include="*.ts"`

Only results should be the component files themselves + this plan references. If any other files import them, update those first.

**Step 2: Delete deprecated files**

```bash
rm viewer/src/components/ProjectCard.tsx
rm viewer/src/components/TaskHistory.tsx
rm viewer/src/components/NewPrdDialog.tsx
rm viewer/src/components/ImportPrdDialog.tsx
```

**Step 3: Verify build**

Run: `cd viewer && npx tsc --noEmit`
Run: `cd viewer && npx next build` (optional, more thorough)

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove deprecated Dashboard components (ProjectCard, TaskHistory, dialogs)"
```

---

## Execution Order & Dependencies

```
Task 1 (types + Sheet)
  ↓
Task 2 (API) ──→ Task 3 (Context) ──→ Task 8 (Dashboard rewrite)
  ↓                                         ↓
Task 4 (ProgressBar) ──→ Task 5 (Card) ──→ Task 8
  ↓
Task 6 (Timeline + Drawer) ──→ Task 8
  ↓
Task 7 (Create Dialog) ──→ Task 8
                                            ↓
                                    Task 9 (Rules page)
                                            ↓
                                    Task 10 (Stage routing)
                                            ↓
                                    Task 11 (Cleanup)
```

**Parallelizable**: Tasks 4, 5, 6, 7 can be built in parallel after Task 1.
**Sequential**: Task 8 depends on all component tasks. Tasks 9-11 are sequential after 8.

---

## Out of Scope (Future Work)

- Deprecating `ProjectContext` entirely (keep for backward compat in this iteration)
- Auto-refresh / polling for stage advancement
- Mobile responsive optimizations
- Keyboard navigation in card list
- Drag-and-drop reordering
