# PRD: Stage 3 Cockpit 重设计

## 1. 项目概述

### 1.1 背景与动机

BotoolAgent Viewer 的 Stage 3（自动开发阶段）持续 10-30 分钟。当前界面以静态 ReactFlow 流程图为主，占据 60% 屏幕但无实时信息——10 个节点中仅 1 个（#5 "Claude 执行任务"）对应 90% 的运行时间。用户在等待期间看到的是文档而非仪表盘，无法回答"还要等多久？""一切正常吗？"等核心问题。

同时，BotoolAgent 已启用 Agent Teams（通过 Claude Code Task tool 并行 spawn 多个 Teammate），但当前 UI 完全没有展示这一并行执行结构。

### 1.2 核心目标

- 将中间区域从静态流程图替换为"批次面板（Agent Teams 并行卡片）+ 批次时间线"双层结构
- 清晰展示 Lead Agent → Teammate 的并行派遣和实时进度
- 提供完整的时间维度信息：已运行时间、均速、ETA、每任务耗时

### 1.3 成功指标

- 用户在默认 tab 下获得所有关键信息（无需切换 tab）
- 5 个情绪阶段（兴奋→好奇→安心→期待→焦虑）均有对应的 UI 响应
- 异常状态（任务耗时 > 2x 均值）< 3s 内获得视觉告警
- 纯前端重设计，复用现有 API 和 SSE（Git API 的 worktree 适配由 Dashboard PRD 负责）

---

## 2. 当前状态

### 2.1 已有能力

| 模块 | 状态 | 说明 |
|------|------|------|
| 三列布局框架 | ✅ 已实现 | 左侧任务列表 240px / 中间主区域 / 右侧面板 260px |
| ReactFlow 流程图 | ✅ 已实现 | 10 个节点展示 BotoolAgent 循环逻辑 |
| 进度日志 Tab | ✅ 已实现 | progress.txt 实时显示 |
| 文件变更 Tab | ✅ 已实现 | `/api/git/changes` 按需轮询 |
| 提交记录 Tab | ✅ 已实现 | `/api/git/commits` 按需轮询 |
| AgentDataPanel | ✅ 已实现 | 迭代进度、完成率、状态灯 |
| SSE useAgentStatus | ✅ 已实现 | 500ms 轮询 Agent 状态 |
| SSE useFileWatcher | ✅ 已实现 | prd.json + progress.txt 实时推送 |
| Agent Teams 执行 | ✅ 已实现 | Lead Agent 通过 Task tool 并行 spawn Teammate |
| **时间维度信息** | ❌ 未实现 | 无 elapsed timer、无 ETA、无每任务耗时 |
| **Agent Teams 可视化** | ❌ 未实现 | 无法看到并行执行状态 |
| **批次进度展示** | ❌ 未实现 | 所有任务平铺，无分组 |
| **teammates.json** | ❌ 未实现 | Lead Agent 不写入实时批次状态文件 |

### 2.2 缺口分析

```
当前布局:
┌──────────┬──────────────────────────┬───────────────────┐
│          │  [流程图│进度日志│文件变更│提交记录]            │
│  任务列表 │                          │   代理状态面板     │
│  240px   │   ReactFlow 流程图        │   260px           │
│          │   (占中间区域 100%)        │                   │
│  DT-001  │                          │  迭代进度          │
│  DT-002  │   10 个节点               │  完成率            │
│  DT-003  │   流程循环图              │  当前任务          │
│  ...     │                          │  状态指示灯        │
│  DT-013  │                          │                   │
└──────────┴──────────────────────────┴───────────────────┘

问题:
• 流程图占 60% 屏幕但无实时信息
• 没有时间维度（elapsed/ETA/每任务耗时）
• 代码变更量需要切 tab 才能看到
• 进度条只有百分比，无速度和估时
• 异常时无明显视觉告警
• Agent Teams 并行结构完全不可见
```

### 2.3 现有数据源清单

| 数据 | 来源 | 更新频率 |
|------|------|----------|
| 任务列表 + passes 状态 | `useFileWatcher` → prd.json | 实时（SSE） |
| 当前任务 ID | `agentStatus.currentTask` | SSE 500ms 轮询 |
| 迭代次数 / 最大迭代 | `agentStatus.iteration` / `maxIterations` | SSE |
| 完成数 / 总数 | `agentStatus.completed` / `total` | SSE |
| 状态类型 | `agentStatus.status` (running/error/...) | SSE |
| Rate Limit / Circuit Breaker | `agentStatus.rateLimit` / `circuitBreaker` | SSE |
| 重试次数 | `agentStatus.retryCount` | SSE |
| 进度日志全文 | `useFileWatcher` → progress.txt | 实时（SSE） |
| 文件变更 | `/api/git/changes` | 按需 + 10s 轮询 |
| 提交记录 | `/api/git/commits` | 按需 + 10s 轮询 |
| SSE 连接状态 | `isConnected` | 实时 |
| **Teammate 批次状态** | **`tasks/{id}/teammates.json`（新增，Lead Agent 写入，per-project）** | **Lead 写入时更新（SSE via useFileWatcher）** |

---

## 3. 架构设计

### 3.1 数据流总览

```
useAgentStatus (SSE)  ──→  ProgressStrip (completed, total, timestamp)
                      ──→  BatchPanel (iteration, retryCount, status)
                      ──→  AgentDataPanel (existing + elapsedSeconds)

useFileWatcher (SSE)  ──→  TaskList (prdData.devTasks) [保持不变]
 ├─ prd.json          ──→  BatchPanel (task details from prdData.devTasks)
 │                    ──→  BatchTimeline (dependsOn → 拓扑排序 → 批次分组)
 │                    ──→  useTeammates fallback (依赖图推断当前批次)
 ├─ progress.txt      ──→  useTaskTimings (时间戳解析 → 任务耗时)
 │                    ──→  LiveLog (last 5 lines)
 └─ teammates.json    ──→  useTeammates (当前批次 + Teammate 实时状态)
    (per-project)      ──→  BatchPanel (并行/串行模式切换)
                      ──→  BatchTimeline (当前批次高亮 + 执行中状态)

/api/git/changes      ──→  StatsSection (additions, deletions, files)
(10s polling)         ──→  文件变更 tab [保持不变]
⚠️ 需 projectId 参数    (Worktree 模式下 git -C .worktrees/{id}/)

/api/git/commits      ──→  StatsSection (commits count)
(10s polling)         ──→  提交记录 tab [保持不变]
⚠️ 需 projectId 参数    (同上，由 Dashboard PRD DT-018 适配)
```

### 3.2 数据源优先级

| 数据 | 首选 | Fallback | 最终 Fallback |
|------|------|----------|--------------|
| 批次状态 | `teammates.json` | `prd.json` 依赖图拓扑排序 | — |
| 任务耗时 | `teammates.json` startedAt/completedAt | `progressLog` 时间戳差 | 均分计算 |
| 当前批次 | `teammates.json` batchIndex | 第一个含未完成任务的拓扑批次 | — |
| Git 变更/提交 | `/api/git/changes+commits`（带 projectId，Worktree 适配后） | 主仓库数据（Dashboard PRD DT-018 适配前降级） | 显示 0 / 隐藏 |

### 3.3 核心 Hook 架构

#### useTeammates（新增）

**文件：** `viewer/src/hooks/useTeammates.ts`

```typescript
interface TeammateInfo {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'pending';
  startedAt?: string;
  completedAt?: string;
}

interface UseTeammatesReturn {
  batchIndex: number;            // 当前批次编号
  teammates: TeammateInfo[];     // 当前批次中的 Teammate 列表
  isParallel: boolean;           // 是否并行（teammates.length >= 2）
  source: 'file' | 'inferred';  // 数据来源：teammates.json 或推断
}

function useTeammates(
  teammatesFileContent: string | null,  // 从 useFileWatcher 获取
  prdData: PrdData | null,              // 从 useFileWatcher 获取
  agentStatus: AgentStatus              // 从 useAgentStatus 获取
): UseTeammatesReturn
```

**逻辑：**

1. **首选**：解析 `teammates.json` 文件内容，直接使用 `batchIndex` 和 `teammates` 数组
2. **过期检测**：若 `updatedAt` 距现在 > 60s 且 Agent 仍在运行，标记为可能过期，切换到 fallback
3. **Fallback**：从 `prd.json` 的 `dependsOn` 做拓扑排序：
   - 计算所有批次
   - 根据各任务的 `passes` 状态，找到第一个包含未完成任务的批次 → 当前批次
   - 该批次中 `passes: false` 的任务 → `status: 'running'`（推测）
   - 该批次中 `passes: true` 的任务 → `status: 'completed'`
4. **拓扑排序算法**（前端计算）：
   - 将所有 `devTasks` 构建为有向无环图（DAG）
   - BFS 层级遍历：无依赖的任务为 Batch 1，只依赖 Batch 1 的为 Batch 2，以此类推
   - 缓存结果（`useMemo`），仅当 `devTasks` 变更时重新计算

**`teammates.json` 格式：**

**存储路径：** `tasks/{projectId}/teammates.json`（per-project，与 prd.json/progress.txt 同目录）
**写入者：** Lead Agent（通过 `$BOTOOL_STATUS_DIR/teammates.json` 环境变量路径写入）

```json
{
  "batchIndex": 2,
  "batchTasks": ["DT-002", "DT-003", "DT-004"],
  "teammates": [
    { "id": "DT-002", "status": "completed", "startedAt": "2026-02-18T10:01:23Z", "completedAt": "2026-02-18T10:02:35Z" },
    { "id": "DT-003", "status": "running",   "startedAt": "2026-02-18T10:01:23Z" },
    { "id": "DT-004", "status": "running",   "startedAt": "2026-02-18T10:01:24Z" }
  ],
  "updatedAt": "2026-02-18T10:03:00Z"
}
```

#### useTaskTimings（新增）

**文件：** `viewer/src/hooks/useTaskTimings.ts`

```typescript
interface TaskTiming {
  taskId: string;
  startTime: number;   // Unix ms
  endTime?: number;    // Unix ms, undefined if in-progress
  duration: number;    // 秒
  batchIndex: number;  // 所属批次
}

interface UseTaskTimingsReturn {
  timings: TaskTiming[];
  batches: TaskTiming[][];     // 按批次分组的二维数组
  avgTime: number;             // 平均完成耗时（秒）
  currentTaskElapsed: number;  // 当前任务已耗时（秒）
  totalElapsed: number;        // Agent 总运行时间（秒）
  maxDuration: number;         // 最长已完成任务耗时（秒，用于条形比例）
}

function useTaskTimings(
  progressLog: string,
  teammates: UseTeammatesReturn,
  currentTaskId: string | null,
  agentStartTimestamp?: string
): UseTaskTimingsReturn
```

**时间推算逻辑（多数据源融合）：**
1. **优先 `teammates.json`**：若 teammate 有 `startedAt`/`completedAt`，直接计算精确耗时
2. **次选 `progressLog`**：解析 `## YYYY-MM-DD - DT-XXX` 格式行，相邻时间戳差 = 任务耗时
3. **当前执行中任务**：从 `teammates.json` 的 `startedAt` 或组件内 `Date.now()` 计算
4. **批次分组**：使用 `useTeammates` 返回的批次信息对 timings 分组
5. 平均耗时 = 所有已完成任务耗时之和 / 已完成任务数

**Fallback：** 若两个数据源都无法提供时间信息，使用 Agent 启动时间戳均分：`totalElapsed / completedTasks`

### 3.4 Git 数据轮询优化

当前 git 数据（changes + commits）仅在对应 tab 激活时才轮询。Cockpit 设计中 StatsSection 始终可见，需要：

- 将轮询条件从 `activeTab === 'changes'` 改为 `isRunning || activeTab === 'changes'`
- Agent 运行中始终 10s 轮询 git 数据
- Agent 停止后仅在 tab 激活时轮询
- **⚠️ Worktree 兼容（跨 PRD 依赖）**：Git API 当前使用全局 `PROJECT_ROOT`，不支持 per-project。Worktree 模式下 Agent 在 `.worktrees/{id}/` 中执行，Git 变更和提交在 worktree 分支上，而非主仓库。Git API 需添加 `projectId` 参数并改用 `git -C .worktrees/{id}/` 执行。**此适配由 Dashboard PRD 负责**，本 PRD 的 DT-006 (StatsSection) 在轮询时传递 `projectId` 参数即可。

---

## 5. UI 设计

### 5.1 新布局总览

```
┌─────────────────────────────────────────────────────────────────────┐
│ StageIndicator                                        [启动代理]     │
├─────────────────────────────────────────────────────────────────────┤
│ [████████████░░░░░░░░░] 4/13 · 31% · ⏱ 3m12s · ETA ~8min         │  ← 增强进度带
├──────────┬──────────────────────────────────┬───────────────────────┤
│          │  当前批次: Batch 3 · 3 Teammates  │  代理状态              │
│  任务列表 │  ┌──────────┬──────────┬────────┐│  ────────             │
│  240px   │  │ DT-006   │ DT-007   │ DT-008 ││  迭代进度 3/10        │
│          │  │ Lead升级  │ 任务规划  │ 测试   ││  完成率 31%           │
│  DT-001  │  │ ⏱ 2m31s  │ ⏱ 1m45s  │ ✓ 48s  ││  当前批次 B3          │
│  DT-002  │  │ ● 执行中  │ ● 执行中  │ ○ 完成 ││  状态灯 ●●●●         │
│  DT-003  │  └──────────┴──────────┴────────┘│  ────────             │
│  ◉DT-006 │                                  │  统计                 │
│  ◉DT-007 │  批次时间线                        │  均耗时 48s/任务      │
│  ◉DT-008 │  B1  DT-001 ████████ 42s    ✓   │  代码变更 +234 -56    │
│  DT-009  │  ─────────────────────────────── │  文件 8 个            │
│  ...     │  B2  DT-002 ██████████ 1m12s ✓   │  提交 4 个            │
│  DT-013  │      DT-003 ██████ 38s       ✓   │  ETA ~8min           │
│          │      DT-004 █████████ 1m35s  ✓   │  ────────             │
│          │  ─────────────────────────────── │  实时活动              │
│          │  B3  DT-006 ████▒▒▒ 2m31s...     │  > 编译 TypeScript    │
│          │      DT-007 ███░░░ 1m45s...      │  > 运行测试...        │
│          │      DT-008 █████ 48s        ✓   │  > 测试通过 ✓         │
│          │  ─────────────────────────────── │  > git add .         │
│          │  B4  DT-009 ░░░░░░ —              │  > git commit -m ..  │
│          │      DT-010 ░░░░░░ —              │                      │
│          │                                  │                      │
│          │  [文件变更│提交记录│流程图ℹ️]       │                      │
│          │  (tab 内容区)                     │                      │
└──────────┴──────────────────────────────────┴───────────────────────┘
```

### 5.2 页面清单

| 页面 | 路由 | 说明 | 状态 |
|------|------|------|------|
| Stage 3 Cockpit | `/stage3?req={id}` | 自动开发监控主页面 | 修改（重设计中间区域） |

### 5.3 组件清单

| 组件 | Props 接口 | 复用位置 | 状态 |
|------|-----------|---------|------|
| `ProgressStrip` | `{ completed, total, isRunning, agentStartTimestamp? }` | stage3/page | 新建 |
| `BatchPanel` | `{ tasks, teammates, batchIndex, isRunning, isComplete, iteration, retryCount, avgTaskTime }` | stage3/page | 新建 |
| `BatchTimeline` | `{ batches, maxDuration, activeBatchIndex }` | stage3/page | 新建 |
| `LiveLog` | `{ progressLog, maxLines? }` | stage3/page (右侧面板内) | 新建 |
| `AgentDataPanel` | 现有 props + `{ elapsedSeconds, gitStats? }` | stage3/page | 修改 |

### 5.4 增强进度带 (ProgressStrip)

```
┌──────────────────────────────────────────────────────────┐
│ [████████████░░░░░░░░░░░░░░░░░░░] 4/13 任务 · 31%       │
│ ⏱ 已运行 3m12s · 均速 48s/任务 · ETA 约 8 分钟剩余       │
└──────────────────────────────────────────────────────────┘
```

**行为：**
- Agent 未运行时：只显示 `4/13 任务 · 31%`，不显示时间信息
- Agent 运行中：完整显示所有字段
- 所有任务完成时：显示 `13/13 任务 · 100% · 总耗时 12m34s`
- 进度条使用 `bg-green-500`
- 组件高度固定 48px，padding 水平 16px

**内部状态：**
- `elapsed: number` — 从 Agent 启动到现在的秒数，`setInterval(1000)` 更新
- `avgTime: number` — `elapsed / completed`（completed > 0 时）
- `eta: number` — `avgTime * (total - completed)`

### 5.5 批次面板 (BatchPanel — Agent Teams 可视化)

核心创新：**清晰展示 Lead Agent 同时派遣多个 Teammate 并行执行任务的过程**。

#### 并行模式（批次内 2-4 个任务）

```
┌──────────────────────────────────────────────────┐
│  当前批次: Batch 3 · 3 个 Teammate 并行            │
├───────────────┬───────────────┬──────────────────┤
│  DT-006       │  DT-007       │  DT-008          │
│  Lead Agent   │  任务规划      │  测试框架         │
│  升级         │  系统          │  搭建            │
│               │               │                  │
│  ⏱ 2m31s      │  ⏱ 1m45s      │  ✓ 48s           │
│  ● 执行中     │  ● 执行中      │  ○ 已完成         │
└───────────────┴───────────────┴──────────────────┘
```

#### 串行模式（批次内仅 1 个任务）

```
┌─────────────────────────────────────────────┐
│  DT-004                    PRD §3.2         │
│  创建搜索 API 接口                           │
│                                             │
│  ⏱ 1m23s                   迭代 #3          │
│                                             │
│  验收标准:                                   │
│  ✓ 搜索端点返回 JSON                         │
│  ⏳ 支持分页参数                              │
│  ○ 错误处理返回标准格式                        │
│                                             │
│  重试: 无  ·  状态: 执行中                    │
└─────────────────────────────────────────────┘
```

**计时器颜色逻辑：**
- 正常（< 2x 平均）：`text-neutral-700`
- 警告（>= 2x 平均）：`text-amber-600`（黄色）
- 危险（>= 3x 平均）：`text-red-600`（红色）

**状态切换行为：**
- Agent 未运行 → 显示空状态："等待启动代理..."，灰色边框
- Agent 运行 + 单任务批次 → 详情卡片（含验收标准）
- Agent 运行 + 多任务批次 → 卡片网格（精简信息）
- Agent 完成 → "全部任务已完成"，绿色边框 + 对号图标

**网格布局：**
- 2 个任务：`grid-cols-2`
- 3 个任务：`grid-cols-3`
- 4 个任务：`grid-cols-4`（或 `grid-cols-2` + 两行）

**动画：**
- 运行中卡片使用 `border-2` + 呼吸动画（复用现有 `task-card-breathing` CSS class）
- 已完成卡片绿色边框 + 对号图标

### 5.6 批次时间线 (BatchTimeline)

```
B1  DT-001  创建数据库表     ████████████████████  42s    ✓
────────────────────────────────────────────────────────────
B2  DT-002  用户认证模块     ██████████████████████████  1m12s  ✓
    DT-003  API 路由设置     ██████████████████  52s    ✓
    DT-004  创建搜索 API     ████████████████████████  1m35s  ✓
────────────────────────────────────────────────────────────
B3  DT-006  Lead Agent 升级  ████████▒▒▒▒  2m31s...
    DT-007  任务规划系统     ██████░░░░░░  1m45s...
    DT-008  测试框架搭建     ██████████  48s    ✓
────────────────────────────────────────────────────────────
B4  DT-009  搜索页面         ░░░░░░░░░░░░░░░░  —
    DT-010  集成测试         ░░░░░░░░░░░░░░░░  —
```

**设计细节：**
- **批次分组**：按 `dependsOn` 拓扑排序计算，批次间用 `border-t border-neutral-200` 分隔
- **批次标签**：每个批次第一行显示 `B{n}`（`text-xs text-neutral-400 font-mono`），其余行缩进
- 每行高度 32px
- 条形最大宽度占行宽 50%，剩余空间给标签 + ID + 标题 + 时间

**条形实现（纯 CSS）：**
```tsx
<div className="h-3 rounded-full overflow-hidden bg-neutral-100" style={{ width: '100%' }}>
  <div
    className={cn(
      'h-full rounded-full transition-all duration-500',
      status === 'completed' && 'bg-green-500',
      status === 'in-progress' && 'bg-neutral-700 animate-pulse',
      status === 'failed' && 'bg-red-500',
    )}
    style={{ width: `${(duration / maxDuration) * 100}%` }}
  />
</div>
```

**颜色编码：**
- `bg-green-500` — 已完成
- `bg-neutral-700` — 执行中（带脉冲动画）
- `bg-neutral-200` — 等待中
- `bg-red-500` — 失败

**滚动行为：**
- 超过可视区域时垂直滚动
- 自动滚动到当前执行中的批次
- 当前批次有高亮背景（`bg-neutral-50`）

### 5.7 右侧面板增强

#### 统计区 (Stats Section)

```
┌──────────────────────┐
│  统计                 │
│                      │
│  均耗时   48s/任务    │
│  代码变更  +234 -56   │
│  文件     8 个        │
│  提交     4 个        │
│  ETA     约 8 分钟    │
└──────────────────────┘
```

不创建独立组件，直接在 `AgentDataPanel` 中添加。

#### 实时活动日志 (LiveLog)

```
┌──────────────────────┐
│  实时活动             │
│  ┌──────────────────┐│
│  │> tsc --noEmit    ││
│  │> 编译成功         ││
│  │> jest --ci       ││
│  │> 3 tests passed  ││
│  │> git commit -m...││
│  └──────────────────┘│
└──────────────────────┘
```

- 5 行高，深色背景（`bg-neutral-900`），等宽字体
- 固定高度 120px
- 自动滚动到底部
- 数据来源：`progressLog` split `\n`，取最后 5 行

### 5.8 Tab 重排序

**原顺序：** `流程图 | 进度日志 | 文件变更 | 提交记录`
**新顺序：** `文件变更 | 提交记录 | 流程图ℹ️`

- `进度日志` tab 移除 — 其内容已融入活动时间线和右侧实时活动日志
- `流程图` 降级至最后一个 tab，添加 `ℹ️` 标记
- `文件变更` 成为默认 tab

---

## 6. 业务规则

### 6.1 用户场景规则

| ID | 规则 | 说明 | 影响任务 |
|----|------|------|---------|
| BR-001 | 5 阶段情绪响应 | 启动(兴奋)→好奇→安心→期待→焦虑，每阶段有对应 UI | DT-004, DT-005 |
| BR-002 | 计时器变色阈值 | <2x均值=正常, 2x-3x=黄, >3x=红 | DT-004 |
| BR-003 | 空状态处理 | Agent 未运行时显示"等待启动代理..."，已完成时显示"全部任务已完成" | DT-004 |
| BR-004 | 自适应并行/串行 | ≥2 任务=卡片网格，=1 任务=详情卡片 | DT-004 |
| BR-005 | ETA 计算 | 简单平均法：`avgTime * remainingTasks`，第一个任务前显示"计算中..." | DT-001 |
| BR-006 | 自动滚动 | BatchTimeline 自动滚动到当前执行中的批次 | DT-005 |
| BR-007 | teammates.json 过期 | updatedAt > 60s 时切换到 prd.json fallback | DT-002 |

### 6.2 设计决策

| ID | 决策 | 理由 |
|----|------|------|
| Q1 | 流程图降级为最后 tab，标记为参考信息 | 保留教学价值，明确"参考"定位 |
| Q2 | 纯 CSS 条形图（`div` + `width%` + Tailwind） | 不引入额外依赖，保持 bundle 精简 |
| Q3 | Phase 1 使用 progress.txt 最后 5 行 | 零额外开发成本，已有数据流 |
| Q4 | 自适应并行/串行 BatchPanel | Agent Teams 结构匹配，自动切换 |
| Q5 | 简单平均法 ETA | 简单直观，够用；复杂度加权需 PRD 格式扩展 |
| Q6 | 混合 teammates.json（per-project）+ prd.json fallback | 双层容错，零新 API；teammates.json 存储在 `tasks/{id}/` 下 |
| Q7 | 拓扑排序批次分组 | 直观体现并行结构 |

---

## 7. 开发计划

### 7.0 Phase 依赖图

```
Phase 1 ──▶ Phase 2 ──▶ Phase 3 ──▶ Phase 4
数据层      组件+Hook   核心可视化   页面集成
(P0)       (P0)       (P0)       (P0)

依赖关系:
Phase 1 → Phase 2（DT-003 依赖 DT-002 的 useTeammates）
Phase 2 → Phase 3（DT-004/005 依赖 DT-003 的 useTaskTimings）
Phase 3 → Phase 4（DT-008 依赖所有组件）
Phase 2 内 DT-006/DT-007 可与 DT-003 并行
```

### 7.1 Phase 1: 数据层基础 (P0)

> **前置**: 无
> **产出**: ProgressStrip 组件 + useTeammates hook + CLAUDE.lead.md 写入指令
> **对应设计**: Section 3.3, 5.4

- [ ] DT-001: 增强进度带组件 (ProgressStrip) (`组件: <ProgressStrip>`, `文件: viewer/src/components/ProgressStrip.tsx`)
  - 显示 `X/Y 任务 · Z%` 基础进度
  - Agent 运行中显示 `已运行 Xm Ys · 均速 Xs/任务 · ETA 约 Xm`
  - Agent 未运行时隐藏时间信息
  - 全部完成时显示总耗时
  - 进度条动画平滑（`transition-all duration-500`）
  - Typecheck passes

- [ ] DT-002: Teammate 状态 Hook + 数据基础设施 (useTeammates) (`文件: viewer/src/hooks/useTeammates.ts`, `修改: viewer/src/hooks/index.ts`, `修改: CLAUDE.lead.md`)
  - 解析 `tasks/{projectId}/teammates.json`（per-project 路径）获取当前批次和 Teammate 状态
  - ⚠️ 路径兼容：Dashboard PRD DT-000a 完成后路径为 `tasks/{id}/teammates.json`；DT-000a 未完成时 fallback 到 `.state/teammates.json`
  - 过期检测：`updatedAt` > 60s 时切换到 fallback
  - Fallback：从 `prd.json` 的 `dependsOn` 做拓扑排序推断当前批次
  - 拓扑排序结果用 `useMemo` 缓存
  - 返回 `isParallel` 标志（`teammates.length >= 2`）
  - `CLAUDE.lead.md` 新增明确指令让 Lead 在 batch 开始/任务完成时写 `teammates.json`（使用 `$BOTOOL_STATUS_DIR/teammates.json` 环境变量路径）
  - 修改 `viewer/src/hooks/index.ts` 导出新 hook
  - 修改 `viewer/src/app/api/files/watch/route.ts` 添加 `tasks/{projectId}/teammates.json` 到监听列表
  - Typecheck passes

### 7.2 Phase 2: 组件 + Hook (P0)

> **前置**: Phase 1
> **产出**: useTaskTimings hook + 统计区 + LiveLog + Tab 重排序
> **对应设计**: Section 3.3, 5.7, 5.8

- [ ] DT-003: 任务耗时推算 Hook (useTaskTimings) (`文件: viewer/src/hooks/useTaskTimings.ts`, `修改: viewer/src/hooks/index.ts`)
  - 优先从 `teammates.json` 的 `startedAt`/`completedAt` 计算精确耗时
  - 次选从 progressLog 解析每个任务的时间戳
  - 计算已完成任务耗时、平均耗时、当前任务耗时、总耗时、最长耗时
  - 返回按批次分组的二维数组 `batches: TaskTiming[][]`
  - progressLog 为空且无 teammates.json 时 fallback 到均分计算
  - 每秒更新 currentTaskElapsed
  - Typecheck passes

- [ ] DT-006: 统计区 + 实时活动日志 (`组件: <LiveLog>`, `文件: viewer/src/components/LiveLog.tsx`, `修改: viewer/src/components/AgentDataPanel/AgentDataPanel.tsx`)
  - 统计区显示：均耗时、代码变更、文件数、提交数、ETA
  - 实时活动日志：深色背景、等宽字体、5 行、自动滚动
  - 日志从 progressLog 最后 5 行提取
  - Agent 运行中自动轮询 git 数据（不仅在 tab 激活时）
  - ⚠️ Git 轮询传递 `projectId` 参数：`/api/git/changes?projectId={id}`（Worktree 模式下 Git API 需 projectId 以定位 `.worktrees/{id}/`。Git API 端点的 worktree 适配由 Dashboard PRD 负责；本任务只需在 fetch URL 中附加 projectId 参数）
  - Typecheck passes
  - Verify in browser

- [ ] DT-007: Tab 重排序 + 流程图降级 (`修改: viewer/src/app/stage3/page.tsx`)
  - Tab 新顺序：`文件变更 | 提交记录 | 流程图ℹ️`
  - 默认激活 tab 为 `文件变更`（`activeTab` 初始值改为 `'changes'`）
  - `进度日志` tab 移除
  - 流程图 tab 加 ℹ️ 标记
  - 现有 FlowChart 组件在流程图 tab 中正常渲染（不做修改）
  - Typecheck passes
  - Verify in browser

### 7.3 Phase 3: 核心可视化组件 (P0)

> **前置**: Phase 2
> **产出**: BatchPanel + BatchTimeline 核心组件
> **对应设计**: Section 5.5, 5.6

- [ ] DT-004: 批次面板 (BatchPanel — Agent Teams 可视化) (`组件: <BatchPanel>`, `文件: viewer/src/components/BatchPanel.tsx`)
  - **并行模式**（批次 >= 2 任务）：卡片网格显示所有 Teammate
    - 每张卡片：ID + 标题 + 计时器 + 状态指示
    - 响应式网格：2 列（2 任务）/ 3 列（3 任务）/ 4 列或 2x2（4 任务）
  - **串行模式**（批次 = 1 任务）：详情卡片，含验收标准、PRD Section、迭代编号
  - 计时器实时更新（秒级精度）
  - 计时器颜色：正常白、>2x 均值黄、>3x 均值红
  - 批次标题显示：`当前批次: Batch N · X 个 Teammate 并行`
  - 空状态："等待启动代理..."
  - 完成状态："全部任务已完成"
  - 运行中卡片有呼吸动画，已完成卡片绿色边框 + 对号
  - Typecheck passes
  - Verify in browser

- [ ] DT-005: 批次时间线 (BatchTimeline) (`组件: <BatchTimeline>`, `文件: viewer/src/components/BatchTimeline.tsx`)
  - 按拓扑排序的批次分组显示，批次间有分隔线
  - 每个批次第一行显示 `B{n}` 标签，其余行缩进
  - 每行：ID + 标题 + 条形 + 时间 + 状态图标
  - 条形宽度按实际耗时比例
  - 颜色编码：绿色已完成、中性色执行中（脉冲）、浅灰等待、红色失败
  - 执行中批次有高亮背景
  - 垂直溢出滚动，自动滚动到当前批次
  - 纯 CSS 实现，无额外依赖
  - Typecheck passes
  - Verify in browser

### 7.4 Phase 4: 页面集成 (P0)

> **前置**: Phase 3
> **产出**: 完整 Stage 3 Cockpit 页面
> **对应设计**: Section 5.1

- [ ] DT-008: 页面集成 + 布局调整 (`修改: viewer/src/app/stage3/page.tsx`)
  - 中间区域垂直分割：ProgressStrip（顶部） → BatchPanel（上） → BatchTimeline（中） → Tabs（下）
  - 所有数据正确从 hooks 传递到各组件
  - 从 URL 参数获取 projectId：优先 `req` 参数（Dashboard PRD DT-017 统一路由后），fallback 到现有 `projectId` 参数
  - 将 projectId 传递给所有 hooks（useFileWatcher、useAgentStatus、useTeammates）和 Git 轮询
  - 布局在 1280px 宽度下不溢出
  - 布局在 1920px 宽度下信息密度合理
  - Agent 未运行 → 运行中 → 完成的全流程状态切换正常
  - 现有功能不退化：任务列表展开、Agent 启停控制、阶段切换 modal
  - Typecheck + lint + build 通过
  - Verify in browser

---

## 8. 附录

### A. 代码文件索引

| 文件路径 | 状态 | Phase | 任务 |
|---------|------|-------|------|
| `viewer/src/components/ProgressStrip.tsx` | 待开发 | Phase 1 | DT-001 |
| `viewer/src/hooks/useTeammates.ts` | 待开发 | Phase 1 | DT-002 |
| `viewer/src/hooks/useTaskTimings.ts` | 待开发 | Phase 2 | DT-003 |
| `viewer/src/components/BatchPanel.tsx` | 待开发 | Phase 3 | DT-004 |
| `viewer/src/components/BatchTimeline.tsx` | 待开发 | Phase 3 | DT-005 |
| `viewer/src/components/LiveLog.tsx` | 待开发 | Phase 2 | DT-006 |
| `viewer/src/hooks/index.ts` | 修改（+导出） | Phase 1,2 | DT-002, DT-003 |
| `viewer/src/components/AgentDataPanel/AgentDataPanel.tsx` | 修改（+统计区） | Phase 2 | DT-006 |
| `viewer/src/app/stage3/page.tsx` | 修改（布局重构） | Phase 2,4 | DT-007, DT-008 |
| `CLAUDE.lead.md` | 修改（+teammates.json 写入指令） | Phase 1 | DT-002 |
| `viewer/src/app/api/files/watch/route.ts` | 可能修改（+监听） | Phase 1 | DT-002 |
| `viewer/src/components/FlowChart/FlowChart.tsx` | ✅ 已有（不修改） | — | — |
| `viewer/src/hooks/useFileWatcher.ts` | ✅ 已有 | — | — |
| `viewer/src/hooks/useAgentStatus.ts` | ✅ 已有 | — | — |

### B. 风险与缓解措施

#### 中

- **Lead Agent 忘记写 teammates.json**: LLM 指令遵从不是 100% → **缓解**: prd.json 依赖图拓扑排序 fallback，UI 不空白；CLAUDE.lead.md 用加粗+重复强调写入指令
- **progress.txt 格式不一致导致时间解析失败**: 格式无严格校验 → **缓解**: fallback 到均分计算，不 crash
- **SSE 断连导致数据不更新**: 网络不稳定 → **缓解**: 已有 SSE 重连机制 + 连接状态指示
- **Git API 未适配 worktree（跨 PRD 依赖）**: `/api/git/changes` 和 `/api/git/commits` 当前用全局 `PROJECT_ROOT`，Worktree 模式下返回数据可能为空或不正确 → **缓解**: DT-006 先传递 projectId 参数；Git API 端点的 worktree 适配由 Dashboard PRD DT-018 负责；Cockpit PRD 的 StatsSection 在 Git API 未适配前仍能显示主仓库数据（降级而非崩溃）

#### 低

- **中间区域垂直空间不足（小屏幕）**: 1280px 以下 → **缓解**: BatchPanel 和时间线各设最小高度，溢出滚动
- **Git 数据轮询频率增加**: StatsSection 始终可见 → **缓解**: 10s 间隔已经很保守，git 命令执行 <100ms

#### 极低

- **拓扑排序计算性能**: 大任务图 → **缓解**: 当前最大 ~15 个任务，BFS O(V+E) 可忽略；用 useMemo 缓存

### C. 测试策略

#### 单元测试
- `useTeammates`: 测试 teammates.json 解析、过期检测、拓扑排序 fallback
- `useTaskTimings`: 测试多源时间融合、批次分组、均分 fallback
- 拓扑排序算法：测试各种 DAG 结构（链式、扇出、菱形依赖）

#### 集成测试
- ProgressStrip: 测试各状态切换（未运行→运行中→完成）
- BatchPanel: 测试并行/串行模式切换、计时器颜色变化
- BatchTimeline: 测试批次分组渲染、自动滚动

#### E2E 测试
- 启动 Agent → 观察 BatchPanel 从空状态变为显示第一个批次
- 模拟多任务完成 → 观察 BatchTimeline 条形增长
- 模拟异常（任务超时）→ 观察计时器变色

### D. 非目标 (Out of Scope)

- tmux capture-pane 实时终端输出（复杂度高，留给 Phase 2）
- Teammate 中间过程实时流（Task tool 子进程无法被外部观测）
- 历史运行记录 / 对比（属于独立功能）
- 移动端适配（Stage 3 是桌面监控场景）
- FlowChart 组件重写或移除（仅降级 tab 位置）
- 新增后端 API（所有数据均复用现有 API 和 SSE）
- 任务复杂度权重的 ETA 算法（需 PRD 格式扩展）
