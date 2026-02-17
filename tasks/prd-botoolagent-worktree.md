# PRD: BotoolAgent Worktree 并发执行 + Header Tabs

## 1. 项目概述

### 1.1 背景与动机

BotoolAgent 当前只能同时运行一个 Stage 3 (Coding) 任务。用户在 Viewer 中可以创建多个 PRD（Stage 1-2 已支持并发），但点击"开始开发"时，只有一个能跑，其余必须等待。

根本原因：
- tmux session 名硬编码为 `botool-teams`，只能有一个
- PID lock 和 status 文件是全局单文件（`.state/agent-pid`、`.state/agent-status`）
- Git 工作目录只能 checkout 一个分支

使用 Git Worktree 可以为每个项目创建独立的工作目录，配合动态命名的 tmux session 和 per-project 状态文件，实现真正的多项目并发开发。

同时，Viewer 的 Header 需要改造为 **Tab Bar**，让用户以浏览器标签页的方式在多个项目之间切换，取代当前的 ProjectSwitcher 组件。

### 1.2 核心目标

- 支持多个 Stage 3 任务并发执行（不同 PRD 各自独立开发）
- 每个并发任务使用独立的 git worktree，互不干扰
- **Header 改造为 Tab Bar**：Dashboard 为固定 tab，每个打开的项目为独立 tab
- 完成后自动清理 worktree

### 1.3 技术栈

Next.js App Router + TypeScript + Tailwind CSS (Viewer)
Bash (BotoolAgent.sh)
Git Worktree (分支隔离)
React Context + localStorage (Tab 状态管理)
shadcn/ui Dialog + lucide-react (UI 组件)

## 2. 当前状态

### 2.1 已有能力

| 模块 | 状态 | 说明 |
|------|------|------|
| Stage 1-2 并发 | ✅ 已实现 | 每个 tab 独立 Claude CLI 进程 |
| `--prd-path` 多 PRD | ✅ 已实现 | `tasks/prd-{id}.json` 命名已就位 |
| `tasks/registry.json` | ✅ 已实现 | 多项目注册表 |
| ProjectContext | ✅ 已实现 | 前端多项目状态管理（localStorage） |
| `/api/agent/start` | ⚠️ 部分 | 支持 projectId 但 PID lock 是全局的 |
| `/api/agent/status` | ⚠️ 部分 | 状态文件是全局单文件 |
| BotoolAgent.sh | ❌ 不支持并发 | tmux session 名硬编码为 `botool-teams` |
| Git 分支隔离 | ❌ 不支持 | 只有一个工作目录 |
| Header 多项目切换 | ❌ 不支持 | ProjectSwitcher 只能切换当前项目，无 tab 概念 |

### 2.2 阻塞点分析

```
阻塞 1: BotoolAgent.sh SESSION_NAME="botool-teams" (硬编码，第 11 行)
阻塞 2: .state/agent-pid 和 .state/agent-status (全局单文件)
阻塞 3: Git 只能 checkout 一个分支 (需要 worktree)
阻塞 4: Header 无 Tab Bar，无法同时展示多个项目工作区
```

### 2.3 现有代码关键实现

**`project-root.ts` 已有的 per-project 路径函数（但 PID/Status 尚未支持）：**
```typescript
// 已有 — prd.json 路径
getProjectPrdJsonPath(projectId?: string)  // → tasks/prd-{projectId}.json

// 已有 — progress 路径
getProjectProgressPath(projectId?: string) // → tasks/progress-{projectId}.txt

// 缺失 — PID 和 Status 路径（当前是全局的）
getAgentPidPath()    // → .state/agent-pid（需改为 per-project）
getAgentStatusPath() // → .state/agent-status（需改为 per-project）
```

**BotoolAgent.sh 已有的参数解析：**
```bash
--project-dir <path>  # 已支持（第 41-44 行）
--prd-path <path>     # 已支持（第 45-48 行）
# 缺失: --project-id <id>
```

**API 启动逻辑（`/api/agent/start/route.ts`）：**
```typescript
// 已有：传递 --prd-path
if (projectId) {
  args.push('--prd-path', PRD_PATH);
}
// 缺失：传递 --project-id
// 缺失：per-project PID lock 检查
```

**Header 当前布局（`viewer/src/components/Header.tsx`）：**
```
[Botool Agent] [Viewer] v1.0.0              [repoName] [● Usage] [ProjectSwitcher] Dashboard
```

## 3. 架构设计

### 3.1 Worktree 并发模型

```
BotoolAgent/                          (主仓库 - Viewer 运行在这里)
├── .git/                             (共享 Git object store)
├── viewer/                           (Viewer 前端 - 始终在主仓库运行)
├── scripts/BotoolAgent.sh
├── .state/
│   ├── agent-pid-{projectId}         (per-project PID lock)
│   ├── agent-status-{projectId}      (per-project 状态)
│   └── ...
├── tasks/
│   ├── prd-auth.json
│   └── prd-export.json
│
├── .worktrees/auth/                  (worktree - 项目 A 的工作目录)
│   ├── .git  → 指回主仓库            (文件，不是目录)
│   ├── viewer/                       (独立文件副本)
│   └── (branch: botool/auth)
│
└── .worktrees/export/                (worktree - 项目 B 的工作目录)
    ├── .git  → 指回主仓库
    └── (branch: botool/export)
```

### 3.2 调用流程

```
Viewer Header Tab Bar
  │
  ├── 用户在 Dashboard tab 点击项目 A 的"查看"
  │   │
  │   ▼
  │   TabContext.openTab("auth", "认证系统", 3)
  │   → Header 新增 tab: "认证系统 (S3)"
  │   → ProjectContext.setActiveProject("auth")
  │   → router.push("/stage3")
  │   │
  │   ▼
  │   Stage 3 页面:
  │     useAgentStatus({ projectId: "auth" })
  │     → 轮询 /api/agent/status?projectId=auth
  │     → 启动: POST /api/agent/start { projectId: "auth" }
  │   │
  │   ▼
  │   API 层:
  │     getAgentPidPath("auth") → .state/agent-pid-auth
  │     spawn BotoolAgent.sh --prd-path tasks/prd-auth.json --project-id auth
  │   │
  │   ▼
  │   BotoolAgent.sh:
  │     1. PROJECT_ID=auth
  │     2. SESSION_NAME=botool-teams-auth
  │     3. git worktree add .worktrees/auth botool/auth (如不存在)
  │     4. tmux new-session -s botool-teams-auth -c .worktrees/auth
  │
  ├── 用户切换到 Dashboard tab，点击项目 B 的"查看"
  │   │
  │   ▼
  │   TabContext.openTab("export", "导出功能", 1)
  │   → Header 新增 tab: "导出功能 (S1)"
  │   → 完全独立的 PID lock / tmux session / worktree
  │
  └── 用户点击不同 tab 切换项目工作区
```

### 3.3 Worktree 生命周期

```
创建 ─────────── 使用中 ─────────── 清理

git worktree add   Lead Agent 在      Stage 5 合并后:
.worktrees/{id}    worktree 中        git worktree remove
{branch}           编码/提交/推送      .worktrees/{id}
```

## 4. Header Tab Bar 设计

### 4.1 新 Header 布局

```
[Botool Agent] [Viewer] v1.0.0 │ [Dashboard] | 认证系统 (S3) ✕ | 导出功能 (S1) ✕     [repoName] [● Usage]
```

- Dashboard 从最右边移到版本号右边，作为固定不可关闭的第一个 tab
- 项目 tab 跟在 Dashboard 后面，显示 `项目名 (S{n})` + 关闭按钮
- **ProjectSwitcher 组件移除**（被 tab 取代）
- repoName 和 Usage 保持在最右边
- 无 [+] 按钮，所有新 tab 只能从 Dashboard 触发

### 4.2 Tab 行为规则

| 行为 | 说明 |
|------|------|
| Dashboard tab | 固定第一个位置，不可关闭 |
| 打开项目 tab | 只能从 Dashboard 触发（点击项目卡片 / 新建 / 导入） |
| 关闭项目 tab | Agent 运行中 → 弹确认对话框；否则直接关闭 |
| 关闭不停止 Agent | 关闭 tab 只是移除界面显示，后台 Agent 不受影响 |
| 切换 tab | 切换 ProjectContext 的 activeProject，router.push 到对应 stage |
| Tab 标签格式 | `{项目名} (S{当前stage})` |
| Tab 状态持久化 | localStorage（刷新页面后恢复） |

### 4.3 Tab 状态模型

```typescript
// viewer/src/lib/tab-storage.ts
interface TabItem {
  id: string;              // 'dashboard' 或 projectId
  type: 'dashboard' | 'project';
  projectId?: string;
  projectName?: string;
}

interface TabStorage {
  openTabs: TabItem[];     // 打开的 tab 列表
  activeTabId: string;     // 当前选中的 tab ID
}
```

### 4.4 Tab 关闭确认对话框

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

## 5. 业务规则

### 5.1 并发规则

| ID | 规则 | 说明 | 影响任务 |
|----|------|------|---------|
| BR-001 | 同分支禁止多 worktree | Git 禁止同一分支被两个 worktree checkout，branch 名必须唯一 | DT-002 |
| BR-002 | projectId 为空时向后兼容 | 无 `--project-id` 时保持 `botool-teams` 默认 session 名和全局状态文件 | DT-001, DT-004 |
| BR-003 | cleanup 只杀自己的 session | `cleanup()` 中只 kill 当前 PROJECT_ID 对应的 tmux session，不影响其他项目 | DT-003 |
| BR-004 | 状态查询无 projectId 时返回全部 | `/api/agent/status` 无 projectId 时遍历 `.state/agent-status-*` 返回所有活跃项目 | DT-006 |
| BR-005 | Worktree 目录固定在 .worktrees/ | 所有 worktree 统一放在 `.worktrees/{projectId}/` 下，不可自定义路径 | DT-002, DT-010 |

### 5.2 Tab 规则

| ID | 规则 | 说明 | 影响任务 |
|----|------|------|---------|
| BR-006 | Dashboard tab 不可关闭 | 固定第一个位置 | DT-012 |
| BR-007 | Tab 只能从 Dashboard 打开 | 无 [+] 按钮，统一从 Dashboard 触发 | DT-014 |
| BR-008 | 关闭 tab 不停止 Agent | 仅移除 UI 显示，后台进程不受影响 | DT-012 |
| BR-009 | 重复打开同项目切换到已有 tab | 不创建重复 tab | DT-013 |

### 5.3 决策树：启动 Agent

```
用户点击"开始开发"
├── 有 projectId?
│   ├── 是 → getAgentPidPath(projectId)
│   │        ├── PID 存活? → 返回 "已在运行"
│   │        └── PID 不存活 → 启动 BotoolAgent.sh --project-id {id}
│   └── 否 → 使用全局 PID lock（向后兼容）
│
BotoolAgent.sh 内部：
├── .worktrees/{id} 存在?
│   ├── 是 → 检查分支一致 → 直接使用
│   └── 否 → git worktree add .worktrees/{id} botool/{id}
└── tmux new-session -s botool-teams-{id} -c .worktrees/{id}
```

## 6. 开发计划

### 6.0 Phase 依赖图

```
Phase 1 ──▶ Phase 2 ──▶ Phase 3
Sh并发化     API层适配    Header Tabs
(P0)        (P0)        (P1)

Phase 1 ──▶ Phase 4
             Worktree清理 (P1)

依赖关系:
Phase 1 是所有后续 Phase 的前置
Phase 3 和 Phase 4 可并行
```

### 6.1 Phase 1: BotoolAgent.sh 并发化 (P0)

> **前置**: 无
> **产出**: BotoolAgent.sh 支持动态 session 名 + worktree 创建
> **对应设计**: Section 3.1, 3.2, 3.3

- [ ] DT-001: BotoolAgent.sh 添加 `--project-id` 参数，动态生成 SESSION_NAME (`文件: scripts/BotoolAgent.sh`)
  - 解析 `--project-id` 参数，或从 `--prd-path` 自动提取 (prd-{id}.json → id)
  - `SESSION_NAME="botool-teams-${PROJECT_ID}"`
  - `STATUS_FILE=".state/agent-status-${PROJECT_ID}"`
  - `PID_FILE=".state/agent-pid-${PROJECT_ID}"`
  - 向后兼容：无 project-id 时保持 `botool-teams` 默认名
  - **验收标准:**
    - [ ] `BotoolAgent.sh --project-id auth` 创建 tmux session `botool-teams-auth`
    - [ ] `BotoolAgent.sh --prd-path tasks/prd-auth.json` 自动提取 project-id 为 `auth`
    - [ ] 无参数时仍使用 `botool-teams` 默认 session
    - [ ] Status 文件写入 `.state/agent-status-auth`

- [ ] DT-002: BotoolAgent.sh 添加 worktree 自动创建/复用逻辑 (`文件: scripts/BotoolAgent.sh`)
  - 在 `start_session()` 中，tmux 创建前检查 `.worktrees/${PROJECT_ID}` 是否存在
  - 不存在 → `git worktree add .worktrees/${PROJECT_ID} -b botool/${PROJECT_ID}`（自动创建分支）
  - 已存在 → 直接使用，确认分支一致
  - 将 `PROJECT_DIR` 设为 worktree 路径
  - tmux session 的 `-c` 参数指向 worktree
  - **验收标准:**
    - [ ] 首次运行自动创建 `.worktrees/auth/` 目录和 `botool/auth` 分支
    - [ ] 二次运行复用已有 worktree
    - [ ] tmux session 的工作目录为 worktree 路径

- [ ] DT-003: BotoolAgent.sh cleanup 逻辑更新 (`文件: scripts/BotoolAgent.sh`)
  - `cleanup()` 中只 kill 当前 PROJECT_ID 对应的 tmux session
  - 不要 kill 其他项目的 session
  - 归档逻辑适配 per-project 状态文件
  - **验收标准:**
    - [ ] 停止项目 A 不影响正在运行的项目 B
    - [ ] Per-project 状态文件正确更新为 stopped

### 6.2 Phase 2: API 层 per-project 状态 (P0)

> **前置**: Phase 1
> **产出**: API 支持查询/管理指定 projectId 的 Agent
> **对应设计**: Section 3.2

- [ ] DT-004: `project-root.ts` 路径函数支持 projectId (`文件: viewer/src/lib/project-root.ts`)
  - `getAgentPidPath(projectId?: string)` → `.state/agent-pid-{projectId}` 或默认 `.state/agent-pid`
  - `getAgentStatusPath(projectId?: string)` → `.state/agent-status-{projectId}` 或默认 `.state/agent-status`
  - 向后兼容：projectId 为空时返回原路径
  - **验收标准:**
    - [ ] `getAgentPidPath("auth")` 返回 `.state/agent-pid-auth`
    - [ ] `getAgentPidPath()` 返回 `.state/agent-pid`（向后兼容）
    - [ ] Typecheck passes
    - [ ] [安全] 使用 `normalizeProjectId()` 防路径穿越

- [ ] DT-005: `/api/agent/start` 传递 projectId 到 BotoolAgent.sh (`文件: viewer/src/app/api/agent/start/route.ts`)
  - 从请求 body 读取 projectId
  - 使用 `getAgentPidPath(projectId)` 检查 PID lock
  - spawn 时添加 `--project-id ${projectId}` 参数
  - 写入 per-project PID 文件
  - **验收标准:**
    - [ ] POST body `{ projectId: "auth" }` 启动时传递 `--project-id auth`
    - [ ] PID 文件写入 `.state/agent-pid-auth`
    - [ ] 两个不同 projectId 可同时启动
    - [ ] Typecheck passes
    - [ ] [安全] 错误响应不泄露内部信息
    - [ ] [安全] 添加权限检查（projectId 合法性校验）

- [ ] DT-006: `/api/agent/status` 支持 projectId 查询参数 (`文件: viewer/src/app/api/agent/status/route.ts`)
  - 从 query params 读取 projectId
  - 使用 `getAgentStatusPath(projectId)` 读取状态
  - 无 projectId 时返回所有活跃项目的状态（遍历 `.state/agent-status-*`）
  - 孤儿检测逻辑适配 per-project PID 文件
  - **验收标准:**
    - [ ] `GET /api/agent/status?projectId=auth` 返回项目 auth 的状态
    - [ ] `GET /api/agent/status` 返回所有活跃项目状态数组
    - [ ] 孤儿检测正确使用 per-project PID 文件
    - [ ] Typecheck passes
    - [ ] [安全] 错误响应不泄露内部信息

- [ ] DT-007: `/api/agent/stop` (DELETE) 支持 projectId (`文件: viewer/src/app/api/agent/status/route.ts`)
  - kill 指定 projectId 的进程（从 per-project PID 文件读取）
  - 清理对应的 PID 文件
  - **验收标准:**
    - [ ] DELETE 请求带 projectId 只停止对应项目
    - [ ] 不影响其他正在运行的项目
    - [ ] Typecheck passes

### 6.3 Phase 3: Header Tabs 前端改造 (P1)

> **前置**: Phase 2
> **产出**: Header Tab Bar + Dashboard 打开项目 tab + Stage 页面传递 projectId
> **对应设计**: Section 4

- [ ] DT-008: Stage 3 页面传递 projectId 到 agent API (`文件: viewer/src/app/stage3/page.tsx`)
  - 从 ProjectContext 获取 activeProject.id 作为 projectId
  - 启动/停止/状态查询都带上 projectId
  - `useAgentStatus` hook 传递 projectId 参数
  - **验收标准:**
    - [ ] Stage 3 页面启动 Agent 时发送 projectId
    - [ ] 状态轮询使用 projectId 过滤
    - [ ] Typecheck passes
    - [ ] Verify in browser: 两个 tab 分别打开不同项目的 Stage 3，互不干扰

- [ ] DT-009: 创建 TabContext + tab-storage (`文件: viewer/src/contexts/TabContext.tsx`, `viewer/src/lib/tab-storage.ts`)
  - `tab-storage.ts`: TabItem / TabStorage 接口，loadTabs / saveTabs 函数，使用 scopedKey('tabs')
  - `TabContext.tsx`: TabProvider 提供 openTab / closeTab / switchTab / updateTabName / getProjectTab
  - openTab 时设置 ProjectContext.setActiveProject + router.push 到对应 stage
  - closeTab 时若关闭当前 tab，切换到前一个 tab 或 Dashboard
  - switchTab 时切换 ProjectContext + router.push
  - Tab 状态持久化到 localStorage
  - **验收标准:**
    - [ ] openTab 创建新 tab 并导航到对应 stage
    - [ ] 重复 openTab 同一 projectId 只切换不创建
    - [ ] closeTab Dashboard 无效（固定 tab）
    - [ ] 刷新页面后 tab 状态恢复
    - [ ] Typecheck passes

- [ ] DT-010: 创建 TabBar 组件 (`文件: viewer/src/components/TabBar.tsx`)
  - Dashboard tab: LayoutDashboard 图标 + "Dashboard" 文字，无关闭按钮
  - 项目 tab: 项目名 + (S{stage}) + hover 显示 ✕ 关闭按钮
  - 关闭时检查 Agent 运行状态，运行中弹 shadcn Dialog 确认
  - 使用 cn() 合并样式，active tab 有 bg-white shadow-sm
  - **验收标准:**
    - [ ] Dashboard tab 始终显示在第一位
    - [ ] 项目 tab 显示项目名和当前 stage
    - [ ] 关闭运行中项目弹确认对话框
    - [ ] 关闭非运行项目直接关闭
    - [ ] Typecheck passes

- [ ] DT-011: 重写 Header 为 Tab Bar 布局 (`文件: viewer/src/components/Header.tsx`)
  - 移除 ProjectSwitcher 和 Dashboard Link
  - 布局: Brand + 版本 | 分隔线 | TabBar (flex-1) | repoName + ClaudeStatus
  - Header 高度从 h-14 改为 h-11（更紧凑）
  - **验收标准:**
    - [ ] Header 显示 tab bar
    - [ ] Brand/版本在左，repoName/Usage 在右
    - [ ] Tab bar 占据中间可用空间
    - [ ] Typecheck passes

- [ ] DT-012: TabProvider 接入 layout + 清理 ProjectSwitcher (`文件: viewer/src/app/layout.tsx`, `viewer/src/components/index.ts`)
  - layout.tsx: 在 ProjectProvider 内部包裹 TabProvider
  - index.ts: 移除 ProjectSwitcher 导出
  - 清理所有 ProjectSwitcher 引用
  - **验收标准:**
    - [ ] TabProvider 正确包裹应用
    - [ ] 无 ProjectSwitcher 残留引用
    - [ ] Typecheck passes

- [ ] DT-013: Dashboard 集成 — 从项目卡片打开 tab (`文件: viewer/src/app/page.tsx`)
  - "我的项目" 改名为 "处理中项目"
  - handleViewProject 改为调用 openTab(project.id, project.name, project.currentStage)
  - 新建/导入 PRD 后也通过 openTab 在新 tab 中打开
  - **验收标准:**
    - [ ] 点击项目卡片 → 新 tab 出现 + 页面切换到该项目 stage
    - [ ] 点击 Dashboard tab → 返回 Dashboard
    - [ ] 新建项目后自动在新 tab 中打开
    - [ ] Typecheck passes

- [ ] DT-014: Tab 状态与路由同步 (`文件: viewer/src/contexts/TabContext.tsx`)
  - 监听 pathname 变化，当路由为 `/` 时自动同步 activeTabId 为 dashboard
  - Stage 页面内切换 stage 时 tab 标签自动更新 (S{n}) — 通过 ProjectContext.currentStage 响应式实现
  - **验收标准:**
    - [ ] 手动导航到 `/` 时 Dashboard tab 高亮
    - [ ] Stage 切换后 tab 标签数字更新
    - [ ] Typecheck passes

### 6.4 Phase 4: Worktree 清理 (P1)

> **前置**: Phase 1
> **产出**: 合并完成后自动清理 worktree
> **对应设计**: Section 3.3

- [ ] DT-015: Stage 5 合并后清理 worktree (`文件: viewer/src/app/stage5/page.tsx`, `viewer/src/app/api/agent/start/route.ts`)
  - 合并成功后调用 `git worktree remove .worktrees/{projectId}`
  - 可在现有 `/api/git/merge` 响应后或新增 `/api/agent/cleanup` 端点处理
  - 清理 per-project PID 和 Status 文件
  - **验收标准:**
    - [ ] 合并成功后 `.worktrees/{projectId}/` 目录被删除
    - [ ] 对应的 `.state/agent-pid-{id}` 和 `.state/agent-status-{id}` 被清理
    - [ ] Typecheck passes

- [ ] DT-016: `.gitignore` 添加 worktree 目录 (`文件: .gitignore`)
  - 添加 `.worktrees/`
  - **验收标准:**
    - [ ] `.worktrees/` 不被 git track

## 7. 附录

### A. 代码文件索引

| 文件路径 | 状态 | Phase | 任务 |
|---------|------|-------|------|
| `scripts/BotoolAgent.sh` | 修改 | Phase 1 | DT-001, DT-002, DT-003 |
| `viewer/src/lib/project-root.ts` | 修改 | Phase 2 | DT-004 |
| `viewer/src/app/api/agent/start/route.ts` | 修改 | Phase 2, 4 | DT-005, DT-015 |
| `viewer/src/app/api/agent/status/route.ts` | 修改 | Phase 2 | DT-006, DT-007 |
| `viewer/src/app/stage3/page.tsx` | 修改 | Phase 3 | DT-008 |
| `viewer/src/lib/tab-storage.ts` | 新增 | Phase 3 | DT-009 |
| `viewer/src/contexts/TabContext.tsx` | 新增 | Phase 3 | DT-009, DT-014 |
| `viewer/src/components/TabBar.tsx` | 新增 | Phase 3 | DT-010 |
| `viewer/src/components/Header.tsx` | 重写 | Phase 3 | DT-011 |
| `viewer/src/app/layout.tsx` | 修改 | Phase 3 | DT-012 |
| `viewer/src/components/index.ts` | 修改 | Phase 3 | DT-012 |
| `viewer/src/components/ProjectSwitcher.tsx` | 删除 | Phase 3 | DT-012 |
| `viewer/src/app/page.tsx` | 修改 | Phase 3 | DT-013 |
| `viewer/src/app/stage5/page.tsx` | 修改 | Phase 4 | DT-015 |
| `.gitignore` | 修改 | Phase 4 | DT-016 |

### B. 风险与缓解措施

#### MEDIUM
- **Git worktree 磁盘占用**: worktree 共享 .git objects，只占工作文件空间。中等项目约 50-100MB/worktree → **缓解**: 可接受，且 Phase 4 会在合并后清理
- **同一分支两个 worktree**: Git 禁止同分支多 worktree checkout → **缓解**: branch 名使用 `botool/{projectId}` 命名约定，projectId 天然唯一

#### LOW
- **Worktree 残留**: 异常退出后 worktree 可能残留 → **缓解**: Stage 5 清理 + 可手动 `git worktree prune` 清理孤立引用
- **Tab 状态与项目不同步**: 项目被删除但 tab 仍存在 → **缓解**: TabBar 渲染时检查 ProjectContext 中项目是否存在，不存在则自动移除 tab

### C. 测试策略

#### 单元测试
- `getAgentPidPath(projectId)` 返回正确路径
- `getAgentStatusPath(projectId)` 返回正确路径
- `normalizeProjectId()` 防路径穿越
- `loadTabs()` / `saveTabs()` 正确读写 localStorage
- TabContext openTab/closeTab/switchTab 逻辑

#### 集成测试
- 两个不同 projectId 同时 POST `/api/agent/start` → 两个进程启动
- DELETE `/api/agent/status?projectId=auth` → 只停止 auth 项目

#### E2E 测试
- 两个项目同时进入 Stage 3 → Header 显示两个项目 tab
- 停止其中一个 → 另一个不受影响
- 关闭 tab 时 Agent 运行中 → 弹确认对话框
- 刷新页面 → tab 状态恢复

### D. 非目标 (Out of Scope)

- 多 Viewer 实例（不需要，单 Viewer 管理多项目）
- 多仓库支持（所有项目在同一个 Git 仓库）
- Stage 4 并发测试（本次只解决 Stage 3 并发）
- Tab 内容缓存（切换时允许重新加载）
- Tab 拖拽排序
- Tab 溢出滚动（初期限制最多 ~8 个 tab）

### E. 安全检查项

| DT | 安全项 | 说明 |
|----|--------|------|
| DT-004 | 路径穿越防护 | 使用 `normalizeProjectId()` 过滤 projectId 中的 `../` 等攻击 |
| DT-005 | projectId 合法性校验 | API 入口校验 projectId 格式（只允许 `[a-zA-Z0-9_-]`） |
| DT-005, DT-006 | 错误信息不泄露内部路径 | API 错误响应使用通用消息 |
