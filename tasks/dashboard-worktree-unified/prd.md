# PRD: BotoolAgent Dashboard 重构 + Worktree 并发执行

## 1. 项目概述

### 1.1 背景与动机

BotoolAgent Viewer 当前存在两个核心问题：

**问题 1: Dashboard 用户体验割裂**
- "我的项目"（localStorage）和"需求文档(PRD)"（文件系统）是两个独立概念
- 导入 marker 文件（`prd-*-导入转换中.md`）产生"幽灵"卡片
- 右侧"任务历史"侧边栏显示无用信息
- 用户无法清晰知道哪个需求到哪一步，应该点哪里

**问题 2: Stage 3 无法并发执行**
- tmux session 名硬编码为 `botool-teams`，只能有一个
- PID lock 和 status 文件是全局单文件（`.state/agent-pid`、`.state/agent-status`）
- Git 工作目录只能 checkout 一个分支
- Header 无 Tab 概念，无法在多个项目间切换

### 1.2 核心目标

- **统一需求卡片**: 合并 Project + PRD + Session 为 `Requirement` 实体
- **6 阶段进度**: draft → prd → json → coding → testing → merge
- **Worktree 并发**: 每个项目使用独立 git worktree，互不干扰
- **Header Tab Bar**: 浏览器式项目切换，支持多工作区

### 1.3 技术栈

Next.js App Router + TypeScript + Tailwind CSS v4 (Viewer)
Bash (BotoolAgent.sh)
Git Worktree (分支隔离)
shadcn/ui (Sheet, Badge, Button, Dialog, Tabs) + lucide-react
React Context + localStorage (状态管理)

## 2. 当前状态

### 2.1 已有能力

| 模块 | 状态 | 说明 |
|------|------|------|
| Stage 1-2 并发 | ✅ 已实现 | 每个 tab 独立 Claude CLI 进程 |
| `--prd-path` 多 PRD | ✅ 已实现 | `tasks/prd-{id}.json` 命名已就位 |
| `tasks/registry.json` | ✅ 已实现 | 多项目注册表 |
| ProjectContext | ✅ 已实现 | 前端多项目状态管理（localStorage） |
| Dashboard 项目列表 | ✅ 已实现 | 但与 PRD 列表割裂 |
| PRD 文件列表 | ✅ 已实现 | 但 marker 文件产生幽灵卡片 |
| 任务历史侧边栏 | ✅ 已实现 | 但用户反馈无用 |
| `/api/agent/start` | ⚠️ 部分 | 支持 projectId 但 PID lock 是全局的 |
| `/api/agent/status` | ⚠️ 部分 | 状态文件是全局单文件 |
| BotoolAgent.sh | ❌ 不支持并发 | tmux session 名硬编码为 `botool-teams` |
| Git 分支隔离 | ❌ 不支持 | 只有一个工作目录 |
| Header Tab Bar | ❌ 不支持 | ProjectSwitcher 只能切换当前项目 |
| 统一需求卡片 | ❌ 不支持 | 3 个独立数据源 |
| 6 阶段进度 | ❌ 不支持 | Stage 0 (草稿) 概念不存在 |

### 2.2 阻塞点分析

```
阻塞 1: BotoolAgent.sh SESSION_NAME="botool-teams" (硬编码)
阻塞 2: .state/agent-pid 和 .state/agent-status (全局单文件)
阻塞 3: Git 只能 checkout 一个分支 (需要 worktree)
阻塞 4: Header 无 Tab Bar，无法同时展示多个项目工作区
阻塞 5: Dashboard 三个独立数据源 (Project + PRD + Session)
阻塞 6: 无 Stage 0 概念，DRAFT-*.md 文件无法自动识别
阻塞 7: 根目录 prd.json 双写 — 并发时 Lead Agent 读到错误项目的 prd.json
```

### 2.3 现有代码关键实现

**`project-root.ts` 已有的 per-project 路径函数（扁平命名，PID/Status 尚未支持）：**
```typescript
getProjectPrdJsonPath(projectId?: string)  // → tasks/prd-{projectId}.json  (待重组为 tasks/{projectId}/prd.json)
getProjectProgressPath(projectId?: string) // → tasks/progress-{projectId}.txt (待重组为 tasks/{projectId}/progress.txt)
// 缺失: getAgentPidPath(projectId) / getAgentStatusPath(projectId)
// 缺失: getProjectDir(projectId) → tasks/{projectId}/
```

**BotoolAgent.sh 已有的参数解析：**
```bash
--project-dir <path>  # 已支持
--prd-path <path>     # 已支持
# 缺失: --project-id <id>
```

**Dashboard 现有数据源（3 个独立）：**
```
1. ProjectContext (localStorage) → "我的项目" 列表
2. /api/prd (文件系统 tasks/prd-*.md) → "需求文档(PRD)" 列表
3. /api/sessions (.archive/) → "任务历史" 侧边栏
```

## 3. 架构设计

### 3.1 Worktree 并发模型

```
BotoolAgent/                          (主仓库 - Viewer 运行在这里)
├── .git/                             (共享 Git object store)
├── viewer/                           (Viewer 前端 - 始终在主仓库运行)
├── scripts/BotoolAgent.sh
├── .state/                           (全局运行时状态，非 per-project)
│   ├── botoolagentrc                 (全局配置)
│   ├── rate-limit-state              (全局限流)
│   └── circuit-breaker-state         (全局熔断)
├── tasks/
│   ├── registry.json                 (全局项目注册表)
│   ├── .task-history.json            (全局任务历史)
│   │
│   ├── auth/                         (项目 A - 所有文件在此)
│   │   ├── DRAFT.md                  (Stage 0 草稿)
│   │   ├── prd.md                    (Stage 1 PRD 文档)
│   │   ├── prd.json                  (Stage 2 任务规划)
│   │   ├── progress.txt              (运行时进度日志)
│   │   ├── prd-session.json          (Stage 1 问答会话状态)
│   │   ├── agent-status              (运行时 Agent 状态)
│   │   └── agent-pid                 (运行时 PID lock)
│   │
│   └── export/                       (项目 B)
│       ├── DRAFT.md
│       ├── prd.md
│       └── ...
│
├── .worktrees/auth/                  (worktree - 项目 A 的 git 工作目录)
│   ├── .git  → 指回主仓库
│   └── (branch: botool/auth)
│
└── .worktrees/export/                (worktree - 项目 B 的 git 工作目录)
    ├── .git  → 指回主仓库
    └── (branch: botool/export)
```

### 3.2 统一需求管线

```
Requirement 实体 (localStorage + /api/requirements 融合)
      │
      ├── Stage 0: 草稿 (DRAFT-*.md / 用户描述)
      │     └── 用户点击 "开始" → 进入 Stage 1
      │
      ├── Stage 1: PRD 生成 (金字塔问答)
      │     └── PRD.md 文件生成 → 自动推进 Stage 2
      │
      ├── Stage 2: 任务规划 (prd.json 生成)
      │     └── prd.json 生成 → 自动推进 Stage 3
      │
      ├── Stage 3: 自动开发 (Worktree + Agent)
      │     ├── 创建 .worktrees/{id}/
      │     ├── tmux session: botool-teams-{id}
      │     └── 所有 DT pass → 自动推进 Stage 4
      │
      ├── Stage 4: 测试验证 (4 层验证)
      │     └── 验证通过 → 自动推进 Stage 5
      │
      └── Stage 5: 合并发布 (PR + merge)
            └── PR merged → 清理 worktree → 标记完成
```

### 3.3 调用流程

```
Dashboard 卡片
  │
  ├── 用户点击"继续→"按钮
  │     ├── 已有打开的 Tab → 切换到该 Tab
  │     └── 无 Tab → TabContext.openTab(reqId, name, stage)
  │           → Header 新增 Tab: "认证系统 (S3)"
  │           → router.push("/stage3?req={reqId}")
  │
  ├── 用户点击卡片其他区域
  │     └── 打开 RequirementDrawer (右侧 Sheet)
  │           → 展示阶段时间线 + 任务详情 + Git 信息
  │
  └── 用户在 Header 切换 Tab
        → TabContext.switchTab(tabId)
        → router.push("/stage{n}?req={reqId}")
```

### 3.4 Worktree 生命周期

```
创建 ─────────── 使用中 ─────────── 清理

git worktree add   Lead Agent 在      Stage 5 合并后:
.worktrees/{id}    worktree 中        git worktree remove
{branch}           编码/提交/推送      .worktrees/{id}
```

## 4. 数据设计

### 4.1 数据模型概览

| 模型 | 用途 | 关键字段 | 存储 |
|------|------|---------|------|
| Requirement | 统一需求实体 | id, name, stage(0-5), status, sourceFile, prdId, prdSessionId, branchName, taskCount, tasksCompleted, prUrl | localStorage + API 融合 |
| TabItem | 打开的工作区 Tab | id, type, requirementId, displayName | localStorage |
| TabStorage | Tab 集合状态 | openTabs[], activeTabId | localStorage |
| per-project 状态 | Agent 进程状态 | agent-pid, agent-status | 文件系统 (tasks/{id}/) |

### 4.2 Requirement 接口定义

```typescript
type RequirementStage = 0 | 1 | 2 | 3 | 4 | 5;
type RequirementStatus = 'active' | 'completed' | 'archived';

interface Requirement {
  id: string;                     // UUID
  name: string;                   // 需求标题
  stage: RequirementStage;        // 当前阶段
  status: RequirementStatus;

  // Stage 0 data
  sourceFile?: string;            // 原始文件路径 (DRAFT-*.md 或导入的 .md)
  description?: string;           // 用户描述

  // Stage 1 data
  prdId?: string;                 // 生成的 PRD 文件 ID
  prdSessionId?: string;          // 金字塔问答会话 ID

  // Stage 2 data
  prdJsonPath?: string;           // prd.json 路径
  taskCount?: number;             // 总任务数

  // Stage 3-5 data
  branchName?: string;            // Git 分支名
  tasksCompleted?: number;        // 已完成任务数
  prUrl?: string;                 // PR URL

  // Meta
  createdAt: number;
  updatedAt: number;
}
```

### 4.3 TabItem 接口定义

```typescript
interface TabItem {
  id: string;              // 'dashboard' 或 requirementId
  type: 'dashboard' | 'project';
  requirementId?: string;  // 引用 Requirement.id
  displayName?: string;    // Tab 标签显示文字
}

interface TabStorage {
  openTabs: TabItem[];
  activeTabId: string;
}
```

### 4.4 模型关系

```
Requirement ──1:1──▶ TabItem (可选，用户打开时创建)
Requirement ──1:1──▶ PRD 文件 (Stage 1+ 时存在)
Requirement ──1:1──▶ Worktree (Stage 3+ 时创建)
Requirement ──1:1──▶ tasks/{id}/ PID+Status (Stage 3+ 时存在)
Requirement ──1:N──▶ DevTask (prd.json devTasks[])
```

## 5. UI 设计

### 5.1 页面清单

| 页面 | 路由 | 说明 | 状态 |
|------|------|------|------|
| Dashboard | `/` | 统一需求卡片列表 + 筛选器 | 重写 |
| Rules 设置 | `/rules` | 规范管理（从 Dashboard Tab 迁出） | 新建 |
| Stage 1 | `/stage1?req={id}` | PRD 问答（新增 req 参数） | 修改 |
| Stage 2 | `/stage2?req={id}` | 任务规划 | 修改 |
| Stage 3 | `/stage3?req={id}` | 自动开发（传递 projectId） | 修改 |
| Stage 4 | `/stage4?req={id}` | 测试验证 | 修改 |
| Stage 5 | `/stage5?req={id}` | 合并发布 | 修改 |

### 5.2 组件清单

| 组件 | Props | 状态 |
|------|-------|------|
| RequirementCard | `{ requirement, isSelected, onClick, onAction }` | 新建 |
| StageProgressBar | `{ currentStage, className }` | 新建 |
| RequirementDrawer | `{ requirement, open, onOpenChange, onNavigate, onDelete, onArchive }` | 新建 |
| StageTimeline | `{ requirement, onStageAction }` | 新建 |
| CreateRequirementDialog | `{ open, onOpenChange }` | 新建 |
| TabBar | `{ }` (从 TabContext 读取) | 新建 |
| Header | 重写为 Tab Bar 布局 | 重写 |

### 5.3 Dashboard 页面布局

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

**进度条设计**：6 个节点对应 Stage 0-5
- `●` = 已完成（实心 bg-foreground）
- `◎` = 进行中（带 animate-pulse）
- `○` = 未开始（空心 border-muted-foreground/30）

**阶段标签**：

| Stage | 标签文字 | Badge variant |
|-------|----------|---------------|
| 0 | 草稿 | neutral |
| 1 | PRD 生成中 / PRD 已完成 | warning / success |
| 2 | 待规划 / 规划中 | warning |
| 3 | 开发中 | primary |
| 4 | 测试中 | warning |
| 5 | 待合并 / 已完成 | success |

### 5.4 Header Tab Bar 布局

```
[Botool Agent] [Viewer] v1.4 │ [Dashboard] | 认证系统 (S3) ✕ | 导出功能 (S1) ✕     [repoName] [● Usage]
```

- Dashboard 为固定不可关闭的第一个 tab
- 项目 tab 显示 `项目名 (S{n})` + 关闭按钮
- **ProjectSwitcher 组件移除**（被 tab 取代）
- repoName 和 Usage 保持在最右边

### 5.5 抽屉详情面板 (Sheet)

```
┌─────────────────────────────┐
│ ← 用户管理系统         [···]│  ← 更多操作（归档/删除）
│                             │
│  阶段进度                    │
│  ┌─────────────────────────┐│
│  │ ✓ Stage 0  草稿         ││
│  │   导入自: user-mgmt.md  ││
│  │ ✓ Stage 1  PRD 已完成   ││
│  │   prd-user-mgmt.md      ││
│  │ → Stage 2  规划中       ││  ← 当前阶段高亮
│  │   [继续规划]             ││  ← 操作按钮
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

### 5.6 新需求对话框

```
┌──────────────────────────────────────┐
│ 新需求                               │
│ ─────────────────────────────────────│
│ [从头开始]  [导入已有文档]            │
│                                      │
│ (Tab 1: 从头开始)                    │
│   需求类型: [新功能] [改功能] ...     │
│   描述: [_________________]          │
│   标题: [auto-generated_____]        │
│                                      │
│ (Tab 2: 导入)                        │
│   搜索文件: [_______________]        │
│   [file list from tasks/]            │
│                                      │
│              [取消]  [创建/导入]      │
└──────────────────────────────────────┘
```

### 5.7 Tab 关闭确认对话框

```
┌─────────────────────────────────┐
│  Agent 正在运行                  │
│                                 │
│  该项目的 Agent 仍在后台运行。   │
│  关闭标签页不会停止 Agent，      │
│  你可以稍后从 Dashboard 重新打开。│
│                                 │
│           [取消]  [关闭标签页]    │
└─────────────────────────────────┘
```

## 6. 业务规则

### 6.1 并发规则

| ID | 规则 | 说明 | 影响任务 |
|----|------|------|---------|
| BR-000 | prd.json 单源读写 | 每个项目只读写自己的 `tasks/{id}/prd.json`，禁止双写到根目录 `prd.json`；Lead Agent 通过 `$BOTOOL_PRD_FILE` 环境变量获取路径 | DT-000 |
| BR-001 | 同分支禁止多 worktree | Git 禁止同一分支被两个 worktree checkout，branch 名用 `botool/{projectId}` 唯一命名 | DT-002 |
| BR-002 | projectId 为空时向后兼容 | 无 `--project-id` 时保持 `botool-teams` 默认 session 名和全局状态文件 | DT-001, DT-004 |
| BR-003 | cleanup 只杀自己的 session | `cleanup()` 中只 kill 当前 PROJECT_ID 对应的 tmux session | DT-003 |
| BR-004 | 状态查询无 projectId 时返回全部 | `/api/agent/status` 无 projectId 时遍历 `tasks/*/agent-status` 返回所有活跃项目 | DT-006 |
| BR-005 | Worktree 目录固定在 .worktrees/ | 所有 worktree 统一放在 `.worktrees/{projectId}/` 下 | DT-002, DT-025 |

### 6.2 Tab 规则

| ID | 规则 | 说明 | 影响任务 |
|----|------|------|---------|
| BR-006 | Dashboard tab 不可关闭 | 固定第一个位置 | DT-020 |
| BR-007 | Tab 只能从 Dashboard 打开 | 无 [+] 按钮，从卡片按钮或抽屉触发 | DT-023 |
| BR-008 | 关闭 tab 不停止 Agent | 仅移除 UI 显示，后台进程不受影响 | DT-020 |
| BR-009 | 重复打开同项目切换到已有 tab | 不创建重复 tab | DT-023 |

### 6.3 Dashboard 规则

| ID | 规则 | 说明 | 影响任务 |
|----|------|------|---------|
| BR-010 | 卡片按钮开 Tab，卡片体开抽屉 | 点"继续→"按钮 → 开 Tab；点其他区域 → 开抽屉 | DT-015 |
| BR-011 | Stage 0 自动识别 DRAFT | `tasks/*/DRAFT.md` 自动显示为 Stage 0 需求卡片（DT-000a 目录结构） | DT-009 |
| BR-012 | 导入 marker 融入阶段进度 | `prd-*-导入转换中.md` 不再单独显示卡片，融入 Stage 0→1 | DT-009 |
| BR-013 | 6 阶段进度自动推进 | Stage 完成条件满足时卡片自动更新到下一阶段 | DT-009, DT-010 |

### 6.4 决策树

```
用户点击需求卡片
├── 点击"继续→"按钮?
│   ├── 已有打开的 Tab? → 切换到该 Tab
│   └── 无 Tab? → 新建 Tab + 跳转 Stage 页
└── 点击卡片其他区域?
    └── 打开 RequirementDrawer (Sheet)

用户点击"开始开发"(Stage 3)
├── 有 projectId?
│   ├── 是 → getAgentPidPath(projectId)
│   │        ├── PID 存活? → 返回 "已在运行"
│   │        └── PID 不存活 → 启动 BotoolAgent.sh --project-id {id}
│   └── 否 → 使用全局 PID lock（向后兼容）
│
BotoolAgent.sh 内部：
├── .worktrees/{id} 存在?
│   ├── 是 → 检查分支一致 → 直接使用
│   └── 否 → git worktree add .worktrees/{id} -b botool/{id}
└── tmux new-session -s botool-teams-{id} -c .worktrees/{id}
```

## 7. 开发计划

### 7.0 Phase 依赖图

```
Phase 1 ──▶ Phase 2 ──▶ Phase 3 ──▶ Phase 4 ──▶ Phase 5
Sh并发化     API适配     Dashboard   Header      清理收尾
(P0)        (P0)        重构(P0)    Tabs(P1)    (P1)

依赖关系:
Phase 1 是 Phase 2 的前置
Phase 2 是 Phase 3 的前置（API 层需要先就位）
Phase 3 是 Phase 4 的前置（Dashboard 先重构，Tab 后接入）
Phase 3 + Phase 4 是 Phase 5 的前置
```

### 7.1 Phase 1: BotoolAgent.sh 并发化 (P0)

> **前置**: 无
> **产出**: 项目目录重组 + prd.json 单源化 + BotoolAgent.sh 动态 session 名 + worktree 创建
> **对应设计**: Section 3.1, 3.3, 3.4

- [ ] DT-000a: 项目目录结构重组 — `tasks/{id}/` per-project 文件夹 (`文件: viewer/src/lib/project-root.ts`, `viewer/src/app/api/prd/route.ts`, `viewer/src/app/api/prd/convert/route.ts`, `viewer/src/app/api/prd/update/route.ts`, `viewer/src/app/api/prd/save/route.ts`, `viewer/src/app/api/prd-sessions/route.ts`)

  **问题根因**: 当前 `tasks/` 下所有项目的文件扁平混放（`DRAFT-*.md`、`prd-*.md`、`prd-*.json`、`progress-*.txt`），加上 `.state/` 下的全局状态文件（`agent-status`、`agent-pid`）。20+ 文件堆在一起，难以管理、难以删除/归档单个项目、并发时靠文件名前缀区分容易出错。

  **目标**: 每个项目拥有独立文件夹 `tasks/{projectId}/`，所有相关文件在内。

  **Step 1: 定义新目录约定**
  ```
  tasks/
  ├── registry.json                 (全局 — 不动)
  ├── .task-history.json            (全局 — 不动)
  ├── {projectId}/                  (per-project 文件夹)
  │   ├── DRAFT.md                  (Stage 0 草稿 / 导入原文)
  │   ├── prd.md                    (Stage 1 PRD 文档)
  │   ├── prd.json                  (Stage 2 任务规划)
  │   ├── progress.txt              (运行时进度日志)
  │   ├── prd-session.json          (Stage 1 金字塔问答会话)
  │   ├── agent-status              (运行时 Agent 状态 JSON)
  │   └── agent-pid                 (运行时 PID lock)
  ```
  - `.state/` 仅保留全局文件（`botoolagentrc`、`rate-limit-state`、`circuit-breaker-state`）
  - per-project 状态文件全部移入 `tasks/{id}/`

  **Step 2: 重写 `project-root.ts` 路径函数** (`viewer/src/lib/project-root.ts`)
  - 新增 `getProjectDir(projectId: string)` → `{tasksDir}/{projectId}/`（自动 `mkdirSync` 如不存在）
  - 重写现有函数：
    - `getProjectPrdJsonPath(projectId)` → `tasks/{id}/prd.json`（原 `tasks/prd-{id}.json`）
    - `getProjectPrdMdPath(projectId)` → `tasks/{id}/prd.md`（原 `tasks/prd-{id}.md`）
    - `getProjectProgressPath(projectId)` → `tasks/{id}/progress.txt`（原 `tasks/progress-{id}.txt`）
    - `getProjectSessionPath(projectId)` → `tasks/{id}/prd-session.json`（原 `.prd-sessions.json` 全局 → per-project）
  - 重写已有无参函数为支持 projectId 参数：
    - `getAgentPidPath(projectId?)` → `tasks/{id}/agent-pid`（原无参版返回 `.state/agent-pid`）
    - `getAgentStatusPath(projectId?)` → `tasks/{id}/agent-status`（原无参版返回 `.state/agent-status`）
  - `normalizeProjectId(id)`: 已有实现，确认只允许 `[a-zA-Z0-9_-]`，防路径穿越
  - 向后兼容：`projectId` 为空时返回原扁平路径（单项目模式不受影响）

  **Step 3: 更新 Viewer API 扫描逻辑**
  - `/api/prd/route.ts`: 扫描 `tasks/*/prd.md` 替代 `tasks/prd-*.md`
  - `/api/prd/convert/route.ts`: 写入 `tasks/{id}/prd.json` 替代 `tasks/prd-{id}.json`
  - `/api/prd/update/route.ts`: 同上
  - `/api/prd/save/route.ts`: 会话映射写入 `tasks/{id}/prd-session.json` 替代全局 `.prd-sessions.json`
  - `/api/prd-sessions/route.ts`: 读取 `tasks/{id}/prd-session.json` 替代全局 `.prd-sessions.json`
  - `/api/prd/route.ts`: `determinePRDStatus()` 从 `tasks/{id}/prd.json` 读取状态（替代 registry → root fallback 链）

  **Step 4: 更新 `registry.json` 路径格式**
  - `prdMd` 从 `"prd-performance-update.md"` → `"performance-update/prd.md"`
  - `prdJson` 从 `"prd-performance-update.json"` → `"performance-update/prd.json"`
  - `progress` 从 `"progress-performance-update.txt"` → `"performance-update/progress.txt"`

  **Step 5: 迁移现有文件** (一次性)
  - 扫描 `tasks/prd-{id}.md` → 移动到 `tasks/{id}/prd.md`
  - 扫描 `tasks/prd-{id}.json` → 移动到 `tasks/{id}/prd.json`
  - 扫描 `tasks/DRAFT-*.md` → 从文件名提取 id → 移动到 `tasks/{id}/DRAFT.md`
  - 扫描 `tasks/progress-{id}.txt` → 移动到 `tasks/{id}/progress.txt`
  - `.state/agent-status` → 移到活跃项目的 `tasks/{id}/agent-status`
  - `.state/agent-pid` → 同上
  - `.prd-sessions.json` → 拆分到各 `tasks/{id}/prd-session.json`
  - 可实现为 Viewer API 端点 `/api/migrate` 或 shell 脚本 `scripts/migrate-tasks.sh`

  **验收标准:**
    - [ ] `getProjectDir("auth")` 返回 `{tasksDir}/auth/` 且目录已创建
    - [ ] `getProjectPrdJsonPath("auth")` 返回 `tasks/auth/prd.json`
    - [ ] `getAgentStatusPath("auth")` 返回 `tasks/auth/agent-status`
    - [ ] `getAgentPidPath("auth")` 返回 `tasks/auth/agent-pid`
    - [ ] 现有扁平文件迁移到文件夹结构
    - [ ] `/api/prd` 正确扫描 `tasks/*/prd.md`
    - [ ] `registry.json` 路径格式更新
    - [ ] `.prd-sessions.json` 拆分为 per-project 文件
    - [ ] `normalizeProjectId()` 防路径穿越
    - [ ] 无 `projectId` 时向后兼容旧扁平路径
    - [ ] Typecheck passes

- [ ] DT-000: 消除根目录 prd.json 双写，统一为 per-project 单源路径 (`文件: scripts/BotoolAgent.sh`, `CLAUDE.lead.md`, `viewer/src/app/api/prd/convert/route.ts`, `viewer/src/app/api/prd/update/route.ts`)

  **问题根因**: 当前 `CLAUDE.lead.md` 硬编码读写 `$BOTOOL_PROJECT_DIR/prd.json`（根目录），而 `BotoolAgent.sh` 在 `--prd-path` 模式下使用 `tasks/prd-{id}.json`。为弥合这个差距，Viewer API 在每次写入 `tasks/prd-{id}.json` 时同时写一份副本到根目录 `prd.json`。并发场景下，多个项目的副本互相覆盖，Lead Agent 可能读到错误项目的 PRD。

  **修复方案**: 通过环境变量将 per-project 路径传递给 Lead Agent，消除根目录副本。
  **前置**: DT-000a（路径函数已指向 `tasks/{id}/prd.json`）

  **Step 1: BotoolAgent.sh 导出路径环境变量** (`scripts/BotoolAgent.sh`)
  - 在 `start_session()` 的 `TMUX_ENV` 中新增：
    - `BOTOOL_PRD_FILE=$PRD_FILE`（已解析的 prd.json 绝对路径，DT-000a 后为 `tasks/{id}/prd.json`）
    - `BOTOOL_PROGRESS_FILE=$PROGRESS_FILE`（已解析的 progress.txt 绝对路径，DT-000a 后为 `tasks/{id}/progress.txt`）
  - 确保 `--prd-path` 和默认模式下均正确传递

  **Step 2: CLAUDE.lead.md 使用环境变量路径** (`CLAUDE.lead.md`)
  - 初始化步骤改为：
    - 读取 `$BOTOOL_PRD_FILE`（替代硬编码 `$BOTOOL_PROJECT_DIR/prd.json`）
    - 读取 `$BOTOOL_PROGRESS_FILE`（替代硬编码 `$BOTOOL_PROJECT_DIR/progress.txt`）
  - 任务完成后 `passes → true` 写入 `$BOTOOL_PRD_FILE`
  - 进度日志追加到 `$BOTOOL_PROGRESS_FILE`
  - `.state/agent-status` 路径不变（由 DT-001 处理 per-project 化）

  **Step 3: Viewer API 移除根目录双写** (`viewer/src/app/api/prd/convert/route.ts`, `viewer/src/app/api/prd/update/route.ts`)
  - `convert/route.ts` 移除 L154-157（`Also write to root prd.json for backward compatibility`）
  - `update/route.ts` 移除 L55-58（`Also update root prd.json for backward compatibility`）
  - 仅保留写入 `getProjectPrdJsonPath(projectId)` 即 `tasks/{id}/prd.json`（DT-000a 后的新路径）

  **Step 4: 清理根目录残留** (可选，手动)
  - 将现有 `./prd.json` 删除或加入 `.gitignore`
  - 确认 `viewer/src/app/api/agent/start/route.ts` 已使用 `getProjectPrdJsonPath(projectId)` 传递 `--prd-path`（当前 L128+278 已正确实现）

  **向后兼容**: 无 `--prd-path` 且无 `BOTOOL_PRD_FILE` 环境变量时，Lead Agent 回退到 `$BOTOOL_PROJECT_DIR/prd.json`（单项目模式不受影响）

  **验收标准:**
    - [ ] `BotoolAgent.sh --prd-path tasks/prd-auth.json` 启动后，tmux 环境中 `$BOTOOL_PRD_FILE` = 正确的绝对路径
    - [ ] Lead Agent 读取并更新 `tasks/prd-auth.json` 而非 `./prd.json`
    - [ ] Viewer `/api/prd/convert` 不再写入根目录 `prd.json`
    - [ ] Viewer `/api/prd/update` 不再写入根目录 `prd.json`
    - [ ] 两个不同 projectId 的 Lead Agent 各自读写 `tasks/{id}/prd.json`，互不干扰
    - [ ] 无 `--prd-path` 时仍读写 `$BOTOOL_PROJECT_DIR/prd.json`（向后兼容）
    - [ ] Typecheck passes

- [ ] DT-001: BotoolAgent.sh 添加 `--project-id` 参数，动态生成 SESSION_NAME (`文件: scripts/BotoolAgent.sh`, `CLAUDE.lead.md`)
  - 解析 `--project-id` 参数，或从 `--prd-path` 自动提取（DT-000a 后路径为 `tasks/{id}/prd.json` → 取父目录名；兼容旧路径 `prd-{id}.json` → 取文件名前缀）
  - `SESSION_NAME="botool-teams-${PROJECT_ID}"`
  - `STATUS_FILE="tasks/${PROJECT_ID}/agent-status"`（DT-000a 后的新路径，原 `.state/agent-status-{id}`）
  - `PID_FILE="tasks/${PROJECT_ID}/agent-pid"`（DT-000a 后的新路径，原 `.state/agent-pid-{id}`）
  - **导出 `BOTOOL_STATUS_FILE=$STATUS_FILE` 到 tmux 环境变量**（与 DT-000 的 `BOTOOL_PRD_FILE` 同模式）
    - 原因：BotoolAgent.sh 的 while 循环通过读 `$STATUS_FILE` 检测 `session_done`/`complete` 来主动 kill tmux session（L302-310）。DT-001 后 `STATUS_FILE` 变为 per-project，但 `CLAUDE.lead.md` 硬编码写 `$BOTOOL_SCRIPT_DIR/.state/agent-status`，两端不匹配会导致监控失效、回退到 15 分钟 stall timeout
    - `CLAUDE.lead.md` 改为写 `$BOTOOL_STATUS_FILE`（替代硬编码 `$BOTOOL_SCRIPT_DIR/.state/agent-status`）
  - 向后兼容：无 project-id 时保持 `botool-teams` 默认名
  - **验收标准:**
    - [ ] `BotoolAgent.sh --project-id auth` 创建 tmux session `botool-teams-auth`
    - [ ] `BotoolAgent.sh --prd-path tasks/prd-auth.json` 自动提取 project-id 为 `auth`
    - [ ] 无参数时仍使用 `botool-teams` 默认 session
    - [ ] Status 文件写入 `tasks/auth/agent-status`
    - [ ] Lead Agent 写 status 到 `tasks/auth/agent-status`（而非全局 `.state/agent-status`）
    - [ ] BotoolAgent.sh while 循环能在 ~30s 内检测到 `session_done` 并主动 kill tmux

- [ ] DT-002: BotoolAgent.sh 添加 worktree 自动创建/复用逻辑 (`文件: scripts/BotoolAgent.sh`)
  - 在 `start_session()` 中，tmux 创建前检查 `.worktrees/${PROJECT_ID}` 是否存在
  - 不存在 → `git worktree add .worktrees/${PROJECT_ID} -b botool/${PROJECT_ID}`
  - 已存在 → 直接使用，确认分支一致
  - tmux session 的 `-c` 参数指向 worktree
  - **引入 `WORK_DIR` 变量**: 有 worktree 时 `WORK_DIR=".worktrees/${PROJECT_ID}"`，否则 `WORK_DIR="$PROJECT_DIR"`
    - tmux `-c` 使用 `$WORK_DIR`
    - 环境变量 `BOTOOL_PROJECT_DIR=$WORK_DIR`（Lead Agent 在 worktree 中执行 git 操作）
    - **commit 监控适配**: while 循环中的 `git -C "$PROJECT_DIR" rev-parse HEAD`（L313）改为 `git -C "$WORK_DIR" rev-parse HEAD`，否则 Lead Agent 在 worktree 中的提交不会被主仓库检测到，stall detection 失效
  - **验收标准:**
    - [ ] 首次运行自动创建 `.worktrees/auth/` 目录和 `botool/auth` 分支
    - [ ] 二次运行复用已有 worktree
    - [ ] tmux session 的工作目录为 worktree 路径
    - [ ] Stall detection 能检测到 worktree 中的新 commit

- [ ] DT-003: BotoolAgent.sh cleanup 逻辑更新 (`文件: scripts/BotoolAgent.sh`)
  - `cleanup()` 中只 kill 当前 PROJECT_ID 对应的 tmux session
  - 归档逻辑适配 per-project 状态文件
  - **启动时残留进程清理改为 project-aware**（L178-189 `清理残留进程` 段）：
    - 当前逻辑 `pgrep -f "BotoolAgent.sh"` 会杀掉**所有**其他 BotoolAgent.sh 进程，并发场景下会误杀其他项目
    - 改为按 PROJECT_ID 匹配：`pgrep -f "BotoolAgent.sh.*--project-id ${PROJECT_ID}"` 或 `pgrep -f "BotoolAgent.sh.*--prd-path.*prd-${PROJECT_ID}"`
    - 无 PROJECT_ID 时保持当前行为（向后兼容单项目模式）
  - **验收标准:**
    - [ ] 停止项目 A 不影响正在运行的项目 B
    - [ ] Per-project 状态文件正确更新为 stopped
    - [ ] 启动项目 B 时不杀死正在运行的项目 A 的 BotoolAgent.sh 进程
    - [ ] 无 `--project-id` 时仍清理所有残留进程（单项目向后兼容）

### 7.2 Phase 2: API 层 per-project 状态 (P0)

> **前置**: Phase 1
> **产出**: API 支持查询/管理指定 projectId 的 Agent
> **对应设计**: Section 3.2

- [ ] DT-004: API 层适配 per-project 路径 (`文件: viewer/src/app/api/agent/start/route.ts`, `viewer/src/app/api/agent/status/route.ts`)
  - **注意**: `project-root.ts` 路径函数（`getAgentPidPath`、`getAgentStatusPath` 等）已在 DT-000a 中完成重写
  - 本任务聚焦 API route 层适配新路径：`start/route.ts` 和 `status/route.ts` 中使用 per-project 路径函数
  - 移除 `start/route.ts` 顶层的全局 `PID_FILE`/`STATUS_FILE` 常量（L9-10），改为按 projectId 动态获取
  - **验收标准:**
    - [ ] `getAgentPidPath("auth")` 返回 `tasks/auth/agent-pid`（由 DT-000a 保证）
    - [ ] `start/route.ts` 使用 per-project PID/Status 路径
    - [ ] Typecheck passes

- [ ] DT-005: `/api/agent/start` 传递 projectId (`文件: viewer/src/app/api/agent/start/route.ts`)
  - 从请求 body 读取 projectId
  - 使用 per-project PID 文件检查 lock
  - spawn 时添加 `--project-id ${projectId}`
  - **验收标准:**
    - [ ] 两个不同 projectId 可同时启动
    - [ ] Typecheck passes
    - [ ] [安全] 错误响应不泄露内部信息
    - [ ] [安全] projectId 合法性校验（只允许 `[a-zA-Z0-9_-]`）

- [ ] DT-006: `/api/agent/status` 支持 projectId 查询 (`文件: viewer/src/app/api/agent/status/route.ts`)
  - 有 projectId → 返回单个项目状态
  - 无 projectId → 遍历 `tasks/*/agent-status` 返回全部
  - **验收标准:**
    - [ ] `GET /api/agent/status?projectId=auth` 返回项目 auth 状态
    - [ ] `GET /api/agent/status` 返回所有活跃项目状态
    - [ ] Typecheck passes
    - [ ] [安全] 错误响应不泄露内部信息

- [ ] DT-007: `/api/agent/stop` (DELETE) 支持 projectId (`文件: viewer/src/app/api/agent/status/route.ts`)
  - kill 指定 projectId 的进程
  - 清理对应 PID 文件
  - **验收标准:**
    - [ ] DELETE 请求带 projectId 只停止对应项目
    - [ ] 不影响其他正在运行的项目
    - [ ] Typecheck passes

### 7.3 Phase 3: Dashboard 重构 (P0)

> **前置**: Phase 2（API 层需先就位）
> **产出**: 统一需求卡片列表 + 6 阶段进度 + 抽屉详情 + 路由统一
> **对应设计**: Section 3.2, 4.2-4.4, 5.1-5.6

- [ ] DT-008: 安装 shadcn Sheet + 定义 Requirement 类型 (`文件: viewer/src/components/ui/sheet.tsx`, `viewer/src/lib/requirement-types.ts`)
  - `npx shadcn@latest add sheet`
  - 创建 RequirementStage, RequirementStatus, Requirement, STAGE_META, RequirementFilter 类型
  - **验收标准:**
    - [ ] Sheet 组件可用
    - [ ] Typecheck passes

- [ ] DT-009: 统一 `/api/requirements` 端点 (`文件: viewer/src/app/api/requirements/route.ts`)
  - 扫描 `tasks/*/DRAFT.md` → Stage 0（DT-000a 后的目录结构）
  - 扫描 `tasks/*/prd.md` → Stage 1+
  - 推断 stage: 有 `tasks/{id}/prd.json` → Stage 2+，有 worktree → Stage 3+，branch merged → Stage 5
  - 标题从 markdown `# Heading` 或目录名提取
  - 导入 marker 文件不单独返回，融入对应需求的状态
  - **验收标准:**
    - [ ] `tasks/{id}/DRAFT.md` 返回为 Stage 0 需求
    - [ ] `tasks/{id}/prd.md` 返回为 Stage 1+ 需求
    - [ ] 导入 marker 不出现为独立条目
    - [ ] Typecheck passes

- [ ] DT-010: RequirementContext (`文件: viewer/src/contexts/RequirementContext.tsx`, `viewer/src/app/layout.tsx`)
  - 从 `/api/requirements` 获取列表
  - localStorage 存储用户创建的需求
  - 提供 CRUD + selectedId + refreshRequirements
  - 包裹到 layout.tsx
  - **验收标准:**
    - [ ] Context 提供完整需求列表
    - [ ] CRUD 操作正常
    - [ ] Typecheck passes

- [ ] DT-011: StageProgressBar 组件 (`文件: viewer/src/components/StageProgressBar.tsx`)
  - 6 个节点水平排列，实心/脉冲/空心三种状态
  - 连接线：已完成实线，未来虚线
  - **验收标准:**
    - [ ] 正确渲染 6 个阶段节点
    - [ ] 当前阶段有脉冲动画
    - [ ] Typecheck passes

- [ ] DT-012: RequirementCard 组件 (`文件: viewer/src/components/RequirementCard.tsx`)
  - 全宽卡片：标题 + StageProgressBar + 阶段标签 + 操作按钮
  - 按钮点击 stopPropagation，卡片点击开抽屉
  - **验收标准:**
    - [ ] 卡片正确显示需求信息和进度条
    - [ ] 按钮和卡片点击分别触发不同回调
    - [ ] Typecheck passes
    - [ ] Verify in browser

- [ ] DT-013: StageTimeline + RequirementDrawer (`文件: viewer/src/components/StageTimeline.tsx`, `viewer/src/components/RequirementDrawer.tsx`)
  - StageTimeline: 垂直 6 阶段时间线，每阶段显示状态+操作
  - RequirementDrawer: 使用 shadcn Sheet side="right"，上半时间线+下半任务列表
  - **验收标准:**
    - [ ] 抽屉从右侧滑出
    - [ ] 时间线正确显示 6 个阶段
    - [ ] 当前阶段有操作按钮
    - [ ] Typecheck passes
    - [ ] Verify in browser

- [ ] DT-014: CreateRequirementDialog (`文件: viewer/src/components/CreateRequirementDialog.tsx`)
  - 合并 NewPrdDialog + ImportPrdDialog
  - 两个 Tab：从头开始 / 导入已有文档
  - 创建后进入 Stage 1
  - **验收标准:**
    - [ ] 从头创建流程正常
    - [ ] 导入文件流程正常
    - [ ] 重复导入检测正常
    - [ ] Typecheck passes
    - [ ] Verify in browser

- [ ] DT-015: Dashboard 页面重写 (`文件: viewer/src/app/page.tsx`)
  - 移除 2 列布局、Tab 切换、TaskHistory 侧边栏
  - 新布局：Header + 筛选栏 + 全宽卡片列表 + RequirementDrawer
  - ~938 行 → ~300 行
  - **验收标准:**
    - [ ] 筛选器（全部/进行中/已完成）工作正常
    - [ ] 搜索功能正常
    - [ ] 卡片点击开抽屉，按钮开 Tab/跳转
    - [ ] 空状态正确显示
    - [ ] Typecheck passes
    - [ ] Verify in browser

- [ ] DT-016: Rules 设置页面 (`文件: viewer/src/app/rules/page.tsx`)
  - 将 RulesManager 迁移到 `/rules` 路由
  - Dashboard Header 放"规范"入口链接
  - **验收标准:**
    - [ ] `/rules` 页面渲染 RulesManager
    - [ ] 返回 Dashboard 导航正常
    - [ ] Typecheck passes

- [ ] DT-017: Stage 页面路由兼容 (`文件: viewer/src/app/stage1/page.tsx` ~ `stage5/page.tsx`)
  - 添加 `req` 参数支持：从 Requirement 解析 session/prd/mode/file
  - 旧 URL 参数继续兼容
  - **验收标准:**
    - [ ] `/stage1?req={id}` 正确解析并进入对应会话
    - [ ] `/stage1?session=xxx` 旧 URL 仍然工作
    - [ ] Typecheck passes

### 7.4 Phase 4: Header Tab Bar (P1)

> **前置**: Phase 3
> **产出**: Header Tab Bar + Dashboard 打开项目 tab + 路由同步
> **对应设计**: Section 5.4, 5.7

- [ ] DT-018: Stage 3 页面传递 projectId 到 agent API (`文件: viewer/src/app/stage3/page.tsx`)
  - 从 Requirement 获取 id 作为 projectId
  - 启动/停止/状态查询都带 projectId
  - **验收标准:**
    - [ ] Stage 3 启动 Agent 时发送 projectId
    - [ ] 状态轮询使用 projectId 过滤
    - [ ] Typecheck passes

- [ ] DT-019: TabContext + tab-storage (`文件: viewer/src/contexts/TabContext.tsx`, `viewer/src/lib/tab-storage.ts`)
  - tab-storage: TabItem/TabStorage 接口，loadTabs/saveTabs，scopedKey('tabs')
  - TabContext: openTab/closeTab/switchTab/updateTabName
  - openTab 时设置 activeProject + router.push
  - **验收标准:**
    - [ ] openTab 创建新 tab 并导航
    - [ ] 重复 openTab 只切换不创建
    - [ ] closeTab Dashboard 无效
    - [ ] 刷新后 tab 状态恢复
    - [ ] Typecheck passes

- [ ] DT-020: TabBar 组件 (`文件: viewer/src/components/TabBar.tsx`)
  - Dashboard tab: LayoutDashboard 图标，无关闭按钮
  - 项目 tab: 项目名 + (S{stage}) + hover 显示 ✕
  - 关闭运行中项目弹 shadcn Dialog 确认
  - **验收标准:**
    - [ ] Dashboard tab 始终第一位
    - [ ] 关闭运行中项目弹确认对话框
    - [ ] Typecheck passes
    - [ ] Verify in browser

- [ ] DT-021: 重写 Header 为 Tab Bar 布局 (`文件: viewer/src/components/Header.tsx`)
  - 移除 ProjectSwitcher 和 Dashboard Link
  - 布局: Brand + 版本 | 分隔线 | TabBar (flex-1) | repoName + ClaudeStatus
  - **验收标准:**
    - [ ] Header 显示 tab bar
    - [ ] Brand 在左，repoName/Usage 在右
    - [ ] Typecheck passes
    - [ ] Verify in browser

- [ ] DT-022: TabProvider 接入 layout (`文件: viewer/src/app/layout.tsx`)
  - 在 RequirementProvider 内部包裹 TabProvider
  - 清理 ProjectSwitcher 引用
  - **验收标准:**
    - [ ] TabProvider 正确包裹应用
    - [ ] 无 ProjectSwitcher 残留引用
    - [ ] Typecheck passes

- [ ] DT-023: Dashboard 集成 — 卡片/抽屉打开 Tab (`文件: viewer/src/app/page.tsx`)
  - 卡片"继续→"按钮调用 openTab
  - 抽屉中"继续"按钮也调用 openTab
  - 新建/导入后通过 openTab 在新 tab 中打开
  - **验收标准:**
    - [ ] 点击按钮 → 新 Tab + 页面切换
    - [ ] Dashboard tab → 返回 Dashboard
    - [ ] Typecheck passes
    - [ ] Verify in browser

- [ ] DT-024: Tab 状态与路由同步 (`文件: viewer/src/contexts/TabContext.tsx`)
  - 监听 pathname，`/` 时同步 activeTabId 为 dashboard
  - Stage 切换时 tab 标签自动更新 (S{n})
  - **验收标准:**
    - [ ] 手动导航到 `/` 时 Dashboard tab 高亮
    - [ ] Stage 切换后 tab 标签数字更新
    - [ ] Typecheck passes

### 7.5 Phase 5: 清理收尾 (P1)

> **前置**: Phase 3 + Phase 4
> **产出**: Worktree 清理 + 废弃组件删除
> **对应设计**: Section 3.4

- [ ] DT-025: Stage 5 合并后清理 worktree (`文件: viewer/src/app/stage5/page.tsx`)
  - 合并成功后调用 `git worktree remove .worktrees/{projectId}`
  - 清理 per-project PID 和 Status 文件
  - **验收标准:**
    - [ ] 合并后 `.worktrees/{id}/` 被删除
    - [ ] `tasks/{id}/agent-pid` 被清理
    - [ ] Typecheck passes

- [ ] DT-026: `.gitignore` 添加 worktree 目录 (`文件: .gitignore`)
  - 添加 `.worktrees/`
  - **验收标准:**
    - [ ] `.worktrees/` 不被 git track

- [ ] DT-027: 删除废弃组件
  - 删除: `ProjectCard.tsx`, `TaskHistory.tsx`, `NewPrdDialog.tsx`, `ImportPrdDialog.tsx`
  - 清理所有残留 import
  - **验收标准:**
    - [ ] 无编译错误
    - [ ] Typecheck passes
    - [ ] `npx next build` 成功

## 8. 附录

### A. 代码文件索引

| 文件路径 | 状态 | Phase | 任务 |
|---------|------|-------|------|
| `viewer/src/lib/project-root.ts` | 重写 | Phase 1 | DT-000a, DT-004 |
| `viewer/src/app/api/prd/route.ts` | 修改 | Phase 1 | DT-000a |
| `viewer/src/app/api/prd/convert/route.ts` | 修改 | Phase 1 | DT-000a, DT-000 |
| `viewer/src/app/api/prd/update/route.ts` | 修改 | Phase 1 | DT-000a, DT-000 |
| `viewer/src/app/api/prd/save/route.ts` | 修改 | Phase 1 | DT-000a |
| `viewer/src/app/api/prd-sessions/route.ts` | 修改 | Phase 1 | DT-000a |
| `tasks/.prd-sessions.json` | 拆分 | Phase 1 | DT-000a (→ tasks/{id}/prd-session.json) |
| `scripts/BotoolAgent.sh` | 修改 | Phase 1 | DT-000, DT-001, DT-002, DT-003 |
| `CLAUDE.lead.md` | 修改 | Phase 1 | DT-000, DT-001 |
| `viewer/src/app/api/agent/start/route.ts` | 修改 | Phase 2 | DT-004, DT-005 |
| `viewer/src/app/api/agent/status/route.ts` | 修改 | Phase 2 | DT-006, DT-007 |
| `viewer/src/components/ui/sheet.tsx` | 新增 | Phase 3 | DT-008 |
| `viewer/src/lib/requirement-types.ts` | 新增 | Phase 3 | DT-008 |
| `viewer/src/app/api/requirements/route.ts` | 新增 | Phase 3 | DT-009 |
| `viewer/src/contexts/RequirementContext.tsx` | 新增 | Phase 3 | DT-010 |
| `viewer/src/components/StageProgressBar.tsx` | 新增 | Phase 3 | DT-011 |
| `viewer/src/components/RequirementCard.tsx` | 新增 | Phase 3 | DT-012 |
| `viewer/src/components/StageTimeline.tsx` | 新增 | Phase 3 | DT-013 |
| `viewer/src/components/RequirementDrawer.tsx` | 新增 | Phase 3 | DT-013 |
| `viewer/src/components/CreateRequirementDialog.tsx` | 新增 | Phase 3 | DT-014 |
| `viewer/src/app/page.tsx` | 重写 | Phase 3, 4 | DT-015, DT-023 |
| `viewer/src/app/rules/page.tsx` | 新增 | Phase 3 | DT-016 |
| `viewer/src/app/stage1/page.tsx` ~ `stage5/page.tsx` | 修改 | Phase 3, 4 | DT-017, DT-018 |
| `viewer/src/lib/tab-storage.ts` | 新增 | Phase 4 | DT-019 |
| `viewer/src/contexts/TabContext.tsx` | 新增 | Phase 4 | DT-019, DT-024 |
| `viewer/src/components/TabBar.tsx` | 新增 | Phase 4 | DT-020 |
| `viewer/src/components/Header.tsx` | 重写 | Phase 4 | DT-021 |
| `viewer/src/app/layout.tsx` | 修改 | Phase 3, 4 | DT-010, DT-022 |
| `viewer/src/components/ProjectCard.tsx` | 删除 | Phase 5 | DT-027 |
| `viewer/src/components/TaskHistory.tsx` | 删除 | Phase 5 | DT-027 |
| `viewer/src/components/NewPrdDialog.tsx` | 删除 | Phase 5 | DT-027 |
| `viewer/src/components/ImportPrdDialog.tsx` | 删除 | Phase 5 | DT-027 |
| `.gitignore` | 修改 | Phase 5 | DT-026 |

### B. 风险与缓解措施

#### HIGH
- **根目录 prd.json 并发覆盖**: 双写策略下多项目同时运行时，根目录 `prd.json` 被最后一个项目覆盖，Lead Agent 读到错误项目的任务清单 → **缓解**: DT-000a 目录重组 + DT-000 消除双写，每个项目只读写 `tasks/{id}/prd.json`

#### MEDIUM
- **Git worktree 磁盘占用**: worktree 共享 .git objects，只占工作文件空间（~50-100MB/worktree）→ **缓解**: Phase 5 合并后自动清理
- **同分支多 worktree**: Git 禁止 → **缓解**: `botool/{projectId}` 唯一命名
- **Dashboard 数据迁移**: 现有 localStorage Projects 需兼容 → **缓解**: 保留 ProjectContext 向后兼容，RequirementContext 可从旧数据推断

#### LOW
- **Worktree 残留**: 异常退出后残留 → **缓解**: Stage 5 清理 + `git worktree prune`
- **Tab 与项目不同步**: 项目被删但 tab 存在 → **缓解**: TabBar 渲染时自动检查移除
- **Stage 页面路由兼容**: 旧 URL 格式需继续支持 → **缓解**: 双参数兼容（req 优先，旧参数回退）

### C. 测试策略

#### 单元测试
- `normalizeProjectId()` 防路径穿越
- `loadTabs()` / `saveTabs()` 读写 localStorage
- RequirementContext CRUD 操作
- Stage 推断逻辑

#### 集成测试
- 两个不同 projectId 同时 POST `/api/agent/start`
- `/api/requirements` 正确聚合所有数据源
- 两个 Lead Agent 并发运行时各自只读写自己的 `tasks/{id}/prd.json`（DT-000 验证）

#### E2E 测试
- Dashboard 筛选器正常工作
- 卡片点击开抽屉，按钮跳转
- Tab 创建/切换/关闭流程
- 关闭运行中项目弹确认对话框
- 刷新后 Tab 状态恢复

### D. 非目标 (Out of Scope)

- 多 Viewer 实例
- 多仓库支持
- Stage 4 并发测试
- Tab 拖拽排序
- Tab 溢出滚动（限制 ~8 个 tab）
- Tab 内容缓存
- 完全废弃 ProjectContext（保留向后兼容）
- 移动端响应式优化
- 键盘导航

### E. 安全检查项

| DT | 安全项 | 说明 |
|----|--------|------|
| DT-000a | 路径穿越防护 | `normalizeProjectId()` 过滤 `../` 等攻击，只允许 `[a-zA-Z0-9_-]` |
| DT-000a | 目录创建安全 | `getProjectDir()` 的 `mkdirSync` 限制在 `tasks/` 目录内 |
| DT-000 | 环境变量路径注入 | `BOTOOL_PRD_FILE` 传递绝对路径，Lead Agent 不应拼接或篡改路径 |
| DT-004 | API 层路径安全 | API route 使用 DT-000a 的路径函数，不自行拼接路径 |
| DT-005 | projectId 合法性校验 | 只允许 `[a-zA-Z0-9_-]` |
| DT-005, DT-006 | 错误信息不泄露 | API 错误使用通用消息 |
| DT-009 | 文件路径安全 | DRAFT/PRD 扫描限制在 tasks/ 目录内 |
