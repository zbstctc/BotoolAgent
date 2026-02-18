# Dashboard Redesign - Unified Requirement Pipeline

**Date:** 2026-02-18
**Status:** Draft
**Author:** Brainstorming session

---

## Problem Statement

The current Dashboard has three independent data sources (localStorage Projects, file system PRDs, .archive/ sessions) that create a fragmented user experience:

- "我的项目" and "需求文档(PRD)" are disconnected concepts
- Import marker files (`prd-*-导入转换中.md`) appear as ghost cards
- Task history sidebar shows data users don't care about
- Users cannot tell which requirement is at which stage or what action to take
- Multiple tags/badges with unclear meaning

## Design Decisions

| Decision | Choice |
|----------|--------|
| Core entity | Unified Requirement card (merge Project + PRD + Session) |
| Stage 0 | User's original requirement document (imported .md / draft) |
| Layout | Full-width card list + right slide-out drawer (Plan B) |
| Detail panel | Top: stage timeline + actions; Bottom: task list + git info |
| Create entry | Single "+ 新需求" button → dialog with create/import options |
| Rules management | Move to separate page, Dashboard header has entry link |
| Completed items | Top filter bar (All / In Progress / Completed) |
| Import status | Merged into Stage 0→1 progress, no more marker cards |

---

## 1. Unified Data Model

### Requirement Interface

```typescript
interface Requirement {
  id: string;                     // UUID
  name: string;                   // Requirement title
  stage: 0 | 1 | 2 | 3 | 4 | 5; // Current stage
  status: 'active' | 'completed' | 'archived';

  // Stage 0 data
  sourceFile?: string;            // Imported original file path (DRAFT-*.md or any .md)
  description?: string;           // Short user description

  // Stage 1 data
  prdId?: string;                 // Generated PRD file ID (prd-{slug}.md)
  prdSessionId?: string;          // Pyramid Q&A session ID

  // Stage 2 data
  prdJsonPath?: string;           // prd.json path
  taskCount?: number;             // Total dev tasks

  // Stage 3-5 data
  branchName?: string;            // Git branch name
  tasksCompleted?: number;        // Completed task count
  prUrl?: string;                 // PR URL

  // Meta
  createdAt: number;
  updatedAt: number;
}
```

### Key changes from current architecture

- Merges `ProjectState` + `PRDItem` + `ExtendedSessionItem` into one entity
- Stage 0 is new, representing raw documents / drafts
- Import markers are no longer independent cards, but Stage 0→1 transitions
- Data stored in localStorage, supplemented by file system inference

---

## 2. Page Layout & Interaction

### Overall Structure

```
┌──────────────────────────────────────────────────────┐
│ Botool Agent                    [⚙ 规范]  [+ 新需求] │
│ ─────────────────────────────────────────────────────│
│ [全部(5)] [进行中(3)] [已完成(2)]       🔍 搜索...   │
├──────────────────────────────────────────────────────┤
│                                                      │
│ ┌──────────────────────────────────────────────────┐ │
│ │ 用户管理系统                                      │ │
│ │ ●━━●━━●━━○━━○━━○   Stage 2 · 待规划   [继续 →]  │ │
│ │ 2 月 17 日更新 · 6 个任务                         │ │
│ └──────────────────────────────────────────────────┘ │
│                                                      │
│ ┌──────────────────────────────────────────────────┐ │
│ │ Worktree 并发执行                                  │ │
│ │ ●━━◎━━○━━○━━○━━○   Stage 1 · PRD 生成中          │ │
│ │ 2 月 18 日更新                                     │ │
│ └──────────────────────────────────────────────────┘ │
│                                                      │
│ ┌──────────────────────────────────────────────────┐ │
│ │ 报表导出功能                                      │ │
│ │ ○━━○━━○━━○━━○━━○   Stage 0 · 草稿    [开始 →]   │ │
│ │ 2 月 18 日创建                                     │ │
│ └──────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

### Card Design Rules

**Progress bar**: 6 nodes for Stage 0-5
- `●` = Completed (solid)
- `◎` = In progress (with pulse animation)
- `○` = Not started (hollow)

**Stage labels:**

| Stage | Label | Badge variant |
|-------|-------|---------------|
| 0 | 草稿 | neutral |
| 1 | PRD 生成中 / PRD 已完成 | warning / success |
| 2 | 待规划 / 规划中 | warning |
| 3 | 开发中 | primary |
| 4 | 测试中 | warning |
| 5 | 待合并 / 已完成 | success |

**Action button per stage:**
- Stage 0: "开始 →" (enter Stage 1 Q&A)
- Stage 1-4 in progress: "继续 →" (jump to corresponding Stage page)
- Stage 5 waiting merge: "合并 →"
- Completed: No button, or "查看"

### Drawer Detail Panel

Clicking card body (not action button) → slides out drawer from right:

```
┌─────────────────────────────┐
│ ← 用户管理系统         [···]│  ← More actions (archive/delete)
│                             │
│  阶段进度                    │
│  ┌─────────────────────────┐│
│  │ ✓ Stage 0  草稿         ││
│  │   导入自: user-mgmt.md  ││
│  │ ✓ Stage 1  PRD 已完成   ││
│  │   prd-user-mgmt.md      ││
│  │ → Stage 2  规划中       ││  ← Current stage highlighted
│  │   [继续规划]             ││  ← Action button
│  │ ○ Stage 3  开发          ││
│  │ ○ Stage 4  测试          ││
│  │ ○ Stage 5  合并          ││
│  └─────────────────────────┘│
│                             │
│  任务详情 (Stage 2+)        │
│  ┌─────────────────────────┐│
│  │ DT-001 登录接口  ✓      ││
│  │ DT-002 权限系统  ⏳     ││
│  │ DT-003 用户列表  ○      ││
│  │ 完成: 1/3               ││
│  └─────────────────────────┘│
│                             │
│  Git 信息 (Stage 3+)       │
│  分支: feat/user-mgmt      │
│  PR: #42 (已创建)          │
└─────────────────────────────┘
```

---

## 3. Stage Flow & Routing

### Stage Definitions

| Stage | Name | Entry condition | User action | Completion condition | Route |
|-------|------|-----------------|-------------|---------------------|-------|
| 0 | 草稿 | Create or import | Click "开始" | User clicks start | `/stage1?req={id}` |
| 1 | PRD | Enter Q&A | Click "继续" | PRD.md file generated | `/stage1?req={id}` |
| 2 | 规划 | PRD complete | Click "继续" | prd.json generated | `/stage2?req={id}` |
| 3 | 开发 | JSON ready | Click "继续" | All DTs pass | `/stage3?req={id}` |
| 4 | 测试 | Dev complete | Click "继续" | 4-layer verification pass | `/stage4?req={id}` |
| 5 | 合并 | Tests pass | Click "合并" | PR merged | `/stage5?req={id}` |

### Unified Routing

**Current**: Messy query params (`session`, `prd`, `mode`, `file`)
**New**: Unified `req={requirementId}` as the only parameter

Each Stage page retrieves all needed info (prdId, sessionId, branchName, etc.) from the Requirement data via `requirementId`.

### Auto-advancement

When stage completion conditions are met, the Dashboard card automatically updates:
- Stage 1→2: Detect `tasks/prd-{slug}.md` file exists
- Stage 2→3: Detect `prd.json` file exists
- Stage 3→4: API check devTasks completion status
- Stage 4→5: Test report passed
- Stage 5 done: Branch merged to main

---

## 4. Stage 0 Auto-Detection

Dashboard scans `tasks/` directory on load to auto-detect Stage 0 requirements:

| File pattern | Detected as | Description |
|-------------|-------------|-------------|
| `tasks/DRAFT-*.md` | Stage 0 draft | Design docs from brainstorming skill |
| `tasks/prd-*-导入转换中.md` | Stage 0→1 transition | Import marker, linked to corresponding requirement |
| User-imported .md | Stage 0 draft | Files added via "+ 新需求 → 导入" |

### DRAFT file handling

- Auto-appear as Stage 0 cards in the list
- Title extracted from filename: `DRAFT-performance-update.md` → "Performance Update"
- Also try extracting from markdown `# Title` heading
- Clicking "开始 →" enters Stage 1 in transform mode with this as source file

### Existing prd-*.md handling

- Already completed Stage 1 → auto-detected as Stage 1+
- Stage inferred from presence of corresponding `prd.json`, `.archive/` records

---

## 5. Data Migration & Compatibility

### Migration from existing data

1. **Existing `prd-*.md` files**: Auto-create Requirement, stage inferred from file system
2. **Existing localStorage Projects**: Merge into corresponding Requirement via prdId
3. **`.archive/` sessions**: Link to Requirement's Stage 3-5 data
4. **`DRAFT-*.md` files**: Auto-create Stage 0 Requirement

### Empty state

When no requirements exist, show centered guide card:
```
┌────────────────────────────┐
│   📋 开始你的第一个需求     │
│   描述你的想法，AI 帮你实现  │
│                            │
│   [+ 新需求]               │
└────────────────────────────┘
```

### What stays the same

- Stage 1-5 sub-pages (`/stage1` ~ `/stage5`) internal logic unchanged
- Pyramid Q&A, dev execution, test verification core flows unchanged
- Only Dashboard and routing entry layer are refactored

---

## 6. Components to Create / Modify

### New components
- `RequirementCard` — full-width card with 6-stage progress bar
- `RequirementDrawer` — slide-out detail panel (shadcn Sheet)
- `StageTimeline` — vertical timeline showing 6 stages with status
- `StageProgressBar` — horizontal 6-dot progress indicator
- `CreateRequirementDialog` — unified create/import dialog

### Modified components
- `page.tsx` (Dashboard) — complete rewrite of layout
- Stage pages (`stage1`~`stage5`) — update to accept `req` param
- Header — remove project switcher, add rules link

### Removed components
- `ProjectCard` — replaced by RequirementCard
- `TaskHistory` / `SessionCard` — removed entirely
- `NewPrdDialog` — replaced by CreateRequirementDialog
- `ImportPrdDialog` — merged into CreateRequirementDialog
- Rules tab on Dashboard — moved to separate page

### Removed concepts
- "我的项目" section — merged into unified list
- "需求文档(PRD)" section — merged into unified list
- Import marker cards — absorbed into stage progress
- Task history sidebar — removed
