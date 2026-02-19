# Stage 3 Cockpit 重设计

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 Stage 3 页面从"静态流程图 + 状态面板"重设计为信息密度更高的 Cockpit 驾驶舱视图，让非技术用户在 10-30 分钟的自动开发过程中始终获得有效的实时反馈。

**Architecture:** 保留三列布局框架（左侧任务列表 / 中间主区域 / 右侧状态面板），但中间区域从静态 ReactFlow 流程图替换为"批次面板（Agent Teams 并行卡片）+ 批次时间线"双层结构，清晰展示 Lead Agent → Teammate 的并行派遣和进度。右侧面板新增统计区和实时活动日志。顶部进度条增强为包含耗时、ETA、速度的完整进度带。新增 `.state/teammates.json` 由 Lead Agent 写入，提供实时批次状态；前端通过 `useFileWatcher` 监听该文件并以 `prd.json` 依赖图拓扑排序作为 fallback。

**Tech Stack:** Next.js 16+ App Router, React 19+, TypeScript 5+, Tailwind CSS 4+, shadcn/ui (new-york), lucide-react, 纯 CSS 实现时间线条形图（不引入额外图表库）。

---

## 1. 问题分析

### 1.1 当前布局

```
┌─────────────────────────────────────────────────────────┐
│ StageIndicator                              [启动代理]   │
├──────────┬──────────────────────────┬───────────────────┤
│          │  [流程图│进度日志│文件变更│提交记录]            │          │
│  任务列表 │                          │   代理状态面板     │
│  240px   │   ReactFlow 流程图        │   260px           │
│          │   (占中间区域 100%)        │                   │
│  DT-001  │                          │  迭代进度          │
│  DT-002  │   10 个节点               │  完成率            │
│  DT-003  │   流程循环图              │  当前任务          │
│  ...     │                          │  状态指示灯        │
│  DT-013  │                          │                   │
└──────────┴──────────────────────────┴───────────────────┘
```

### 1.2 核心问题

| 问题 | 数据依据 | 影响 |
|------|----------|------|
| 流程图占 60% 屏幕但无实时信息 | FlowChart 10 个节点中仅 1 个（#5 "Claude 执行任务"）对应 90% 的运行时间 | 用户在等待期间看到的是文档而非仪表盘 |
| 没有时间维度信息 | 无 elapsed timer、无 ETA、无每个任务耗时 | 用户无法判断"这正常吗？" |
| 代码变更量需要切 tab 才能看到 | `文件变更` 和 `提交记录` 在非默认 tab 下 | 用户错过了最直观的"正在产出"信号 |
| 进度条只有百分比 | `4/13 · 31%` 无速度和估时 | 用户无法回答"还要等多久？" |
| 异常时无明显视觉告警 | 任务卡住 > 2x 平均耗时时无特殊指示 | 用户在焦虑阶段无法获得答案 |

### 1.3 现有数据源清单

以下是 **已经可用** 的数据，无需新增 API：

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
| **Teammate 批次状态** | **`.state/teammates.json`（新增，Lead Agent 写入）** | **Lead 写入时更新（SSE via useFileWatcher）** |

---

## 2. 用户场景分析

Stage 3 运行期间用户经历 5 个阶段性情绪：

| 阶段 | 情绪 | 出现时间 | 用户心理 | 需要的信息 | 设计响应 |
|------|------|----------|----------|------------|----------|
| 1. 启动 | 兴奋 | 点击"启动代理"后 0-30s | "它开始了！" | 第一个任务的信号 | 当前焦点卡片从空状态 → 显示 DT-001，配合进场动画 |
| 2. 好奇 | 好奇心 | 前 1-3 分钟 | "它在做什么？" | 实时活动细节 | 活动时间线第一个条形增长 + 右侧实时日志滚动 |
| 3. 安心 | 需要安全感 | 3-15 分钟（中段） | "一切正常吗？" | 绿灯 + 稳定推进 | 状态灯全绿 + 进度条稳步前进 + 统计数据增长 |
| 4. 期待 | 期待完成 | 任务 > 70% 完成时 | "还剩几个？" | 倒计时 / 剩余量 | ETA 倒计时 + 时间线中灰色（待处理）明显少于绿色（已完成） |
| 5. 焦虑 | 担忧 | 某任务耗时 > 2x 平均 | "为什么卡住了？" | 错误信息 + 异常高亮 | 当前焦点卡片计时器变黄/红 + 重试指示 + 错误描述 |

---

## 3. 设计方案

### 3.1 新布局总览

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

### 3.2 增强进度带 (Progress Strip)

位于 StageIndicator 和三列内容之间，全宽横跨。

```
┌──────────────────────────────────────────────────────────┐
│ [████████████░░░░░░░░░░░░░░░░░░░] 4/13 任务 · 31%       │
│ ⏱ 已运行 3m12s · 均速 48s/任务 · ETA 约 8 分钟剩余       │
└──────────────────────────────────────────────────────────┘
```

**数据来源：**
- 4/13 任务：`agentStatus.completed` / `agentStatus.total`（或 fallback 到 PRD `completedTasks`/`totalTasks`）
- 已运行时间：组件内 `useState` + `setInterval`，Agent 启动时开始计时（从 `agentStatus.timestamp` 推算起始时间）
- 均速：`elapsedTime / completedTasks`
- ETA：`avgTime * remainingTasks`

**行为：**
- Agent 未运行时：只显示 `4/13 任务 · 31%`，不显示时间信息
- Agent 运行中：完整显示所有字段
- 所有任务完成时：显示 `13/13 任务 · 100% · 总耗时 12m34s`

### 3.3 批次面板 (Batch Panel — Agent Teams 可视化)

中间区域上半部分。核心创新：**清晰展示 Lead Agent 同时派遣多个 Teammate 并行执行任务的过程**。

#### 并行模式（批次内 2-4 个任务）

当 Lead Agent 通过 Task tool 同时 spawn 多个 Teammate 时，显示为卡片网格：

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

当 Lead Agent 直接执行单个任务时，退化为详情卡片（信息更丰富）：

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

**数据来源（优先级）：**

1. **`teammates.json`（首选）：** Lead Agent 在 spawn Teammate 前写入 `.state/teammates.json`，包含批次内所有任务的 ID、状态、开始时间
2. **`prd.json` 依赖图 fallback：** 若 `teammates.json` 不存在或过期（>60s 未更新），前端从 `prd.json` 的 `dependsOn` 字段做拓扑排序，推断当前批次中哪些任务可并行
3. **任务详情：** 从 `prdData.devTasks` 中按 ID 查找标题、PRD Section、验收标准

**`teammates.json` 格式：**

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

**计时器颜色逻辑（串行卡片 + 并行卡片通用）：**
- 正常（< 2x 平均）：`text-neutral-700`
- 警告（>= 2x 平均）：`text-amber-600`（黄色）
- 危险（>= 3x 平均）：`text-red-600`（红色）

**状态切换行为：**
- Agent 未运行 → 显示空状态："等待启动代理..."，灰色边框
- Agent 运行 + 单任务批次 → 详情卡片（含验收标准）
- Agent 运行 + 多任务批次 → 卡片网格（精简信息）
- Agent 完成 → "全部任务已完成"，绿色边框 + 对号图标

### 3.4 批次时间线 (Batch Timeline)

中间区域下半部分。与原版平铺时间线不同，**按拓扑排序的批次分组显示**，清晰体现哪些任务是并行执行的。

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
- **批次分组**：按 `dependsOn` 拓扑排序计算批次，批次间用分隔线 + `B1` `B2` 标签区分
- **同批次并排**：同一批次内的任务紧邻显示，视觉上暗示它们是并行执行的
- 每行一个任务，水平排列：`[批次标签] [ID] [标题(truncate)] [条形] [时间] [状态图标]`
- 批次标签只在该批次第一行显示，其余行缩进对齐
- 条形宽度按实际耗时比例（相对于最长已完成任务）
- 颜色编码：
  - `bg-green-500` — 已完成
  - `bg-neutral-700` — 执行中（带脉冲动画）
  - `bg-neutral-200` — 等待中
  - `bg-red-500` — 失败
- 执行中任务的条形：实色部分表示已经过时间，虚线/低透明度部分表示预估剩余
- 溢出时垂直滚动，**自动滚动到当前执行中的批次**

**数据来源 & 每个任务耗时计算：**

需要在前端组件中从多个数据源推导：

1. **批次分组**：从 `prd.json` 的 `dependsOn` 字段做拓扑排序，计算哪些任务属于同一批次
2. **已完成任务的耗时**：优先从 `teammates.json` 的 `startedAt`/`completedAt` 计算；fallback 到解析 `progressLog`（progress.txt）的 `## YYYY-MM-DD - DT-XXX` 时间戳差
3. **当前执行中任务的耗时**：从 `teammates.json` 的 `startedAt` 或组件内计时器计算
4. **待处理任务**：显示空灰条，无时间

**Fallback**：若 `teammates.json` 不存在且 progress.txt 无法解析时间戳，则所有已完成条形等宽，仅当前任务显示实时计时。

### 3.5 Tab 重排序

中间区域底部保留 tab 切换，但重新排序：

**原顺序：** `流程图 | 进度日志 | 文件变更 | 提交记录`
**新顺序：** `文件变更 | 提交记录 | 流程图ℹ️`

- `进度日志` tab 移除 — 其内容已融入活动时间线和右侧实时活动日志
- `流程图` 降级至最后一个 tab，添加 `ℹ️` 标记表示"信息/帮助"性质
- `文件变更` 成为默认 tab（最有价值的实时产出信号）

### 3.6 右侧面板增强

在现有 `AgentDataPanel` 基础上新增两个区块：

#### 3.6.1 统计区 (Stats Section)

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

**数据来源：**
- 均耗时：`elapsedTime / completedTasks`（与进度带共享计算）
- 代码变更：`gitChanges.totals.additions` / `deletions`（复用现有 `/api/git/changes`）
- 文件数：`gitChanges.totals.files`
- 提交数：`gitCommits.count`（复用现有 `/api/git/commits`）
- ETA：`avgTime * remainingTasks`

#### 3.6.2 实时活动日志 (Live Log)

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

**设计：**
- 5 行高，深色背景（`bg-neutral-900`），等宽字体
- 自动滚动到底部
- 数据来源：`progressLog` 的最后 5 行（已通过 `useFileWatcher` 实时获取）

**实现方式（Phase 1）：**
- 从 `progressLog` 状态中 split by `\n`，取最后 5 行显示
- 不需要新增 API，直接复用现有数据流

**未来扩展（Phase 2，非本 PRD 范围）：**
- 新增 `/api/agent/output` API，使用 `tmux capture-pane -t botool-agent -p | tail -5` 获取更细粒度的终端输出
- 但这需要 tmux 会话名称约定和权限控制，暂不实现

---

## 4. 组件设计

### 4.1 `ProgressStrip`

**文件：** `viewer/src/components/ProgressStrip.tsx`

```typescript
interface ProgressStripProps {
  completed: number;
  total: number;
  isRunning: boolean;
  agentStartTimestamp?: string; // ISO string from agentStatus.timestamp
}
```

**内部状态：**
- `elapsed: number` — 从 Agent 启动到现在的秒数，`setInterval(1000)` 更新
- `avgTime: number` — `elapsed / completed`（completed > 0 时）
- `eta: number` — `avgTime * (total - completed)`

**行为：**
- `isRunning` 为 false 时隐藏时间信息
- 进度条使用 `bg-green-500`，与现有左侧面板进度条一致
- 组件高度固定 48px，padding 水平 16px

### 4.2 `BatchPanel`

**文件：** `viewer/src/components/BatchPanel.tsx`

```typescript
interface TeammateStatus {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'pending';
  startedAt?: string;  // ISO string
  completedAt?: string;
}

interface BatchPanelProps {
  tasks: DevTask[];           // 当前批次内的所有任务（从 prdData.devTasks 查找）
  teammates: TeammateStatus[]; // 来自 teammates.json 或 fallback 推断
  batchIndex: number;
  isRunning: boolean;
  isComplete: boolean;
  iteration: number;
  retryCount: number;
  avgTaskTime: number;        // 秒，用于计时器颜色判断
}
```

**内部状态：**
- `taskTimers: Record<string, number>` — 每个执行中任务的已耗时，从 `startedAt` 推算，`setInterval(1000)` 更新
- 各任务 `timerColor: string` — 根据 `elapsed` vs `avgTaskTime` 计算

**行为：**
- **空状态**（`!isRunning && tasks.length === 0`）：显示"等待启动代理..."
- **完成状态**（`isComplete`）：显示"全部任务已完成"
- **并行模式**（`tasks.length >= 2`）：卡片网格，每张卡片显示 ID + 标题 + 计时器 + 状态
  - 2 个任务：`grid-cols-2`
  - 3 个任务：`grid-cols-3`
  - 4 个任务：`grid-cols-4`（或 `grid-cols-2` + 两行，待 UI 测试决定）
- **串行模式**（`tasks.length === 1`）：单张大卡片，显示完整详情（验收标准、PRD Section、迭代编号等）
- 计时器变色阈值：`1x-2x avg` 正常，`2x-3x` 黄色，`>3x` 红色
- 运行中卡片使用 `border-2` + 呼吸动画（复用现有 `task-card-breathing` CSS class）
- 已完成卡片绿色边框 + 对号图标

### 4.3 `BatchTimeline`

**文件：** `viewer/src/components/BatchTimeline.tsx`

```typescript
interface BatchTimelineEntry {
  id: string;
  title: string;
  status: 'completed' | 'in-progress' | 'pending' | 'failed';
  duration?: number;  // 秒
  batchIndex: number; // 所属批次编号
}

interface BatchTimelineProps {
  batches: BatchTimelineEntry[][]; // 按批次分组的二维数组
  maxDuration: number;             // 最长任务耗时（用于条形比例计算）
  activeBatchIndex: number;        // 当前正在执行的批次
}
```

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

**行为：**
- 按批次分组显示，批次间用 `border-t border-neutral-200` 分隔
- 每个批次第一行显示 `B{n}` 标签（`text-xs text-neutral-400 font-mono`），其余行缩进
- 垂直列表，每行高度 32px
- 条形最大宽度占行宽 50%，剩余空间给批次标签 + ID + 标题 + 时间
- 超过可视区域时垂直滚动，**自动滚动到当前执行中的批次**
- 当前批次有高亮背景（`bg-neutral-50`）

### 4.4 `StatsSection`

**文件：** 不创建独立组件，直接在 `AgentDataPanel` 中添加

在现有 `AgentDataPanel.tsx` 中新增一个 `<div>` 区块，props 扩展：

```typescript
interface AgentDataPanelProps {
  // ... 现有 props
  elapsedSeconds: number;
  gitStats?: {
    additions: number;
    deletions: number;
    files: number;
    commits: number;
  };
}
```

### 4.5 `LiveLog`

**文件：** `viewer/src/components/LiveLog.tsx`

```typescript
interface LiveLogProps {
  progressLog: string;
  maxLines?: number; // 默认 5
}
```

**实现：**
- 从 `progressLog` 中 split `\n`，取最后 `maxLines` 行
- `font-mono text-xs text-neutral-300` 在 `bg-neutral-900 rounded-lg` 容器中
- 固定高度 120px
- 每次 `progressLog` 更新时自动滚动到底部

---

## 5. 数据源设计

### 5.1 数据流图

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
    (新增)             ──→  BatchPanel (并行/串行模式切换)
                      ──→  BatchTimeline (当前批次高亮 + 执行中状态)

/api/git/changes      ──→  StatsSection (additions, deletions, files)
(10s polling)         ──→  文件变更 tab [保持不变]

/api/git/commits      ──→  StatsSection (commits count)
(10s polling)         ──→  提交记录 tab [保持不变]
```

### 5.2 Teammate 状态 Hook（新增）

新增自定义 hook：`useTeammates`

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

### 5.3 任务耗时推算 Hook

新增自定义 hook：`useTaskTimings`

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

### 5.4 Git 数据轮询优化

当前 git 数据（changes + commits）仅在对应 tab 激活时才轮询。Cockpit 设计中 StatsSection 始终可见，需要：

- 将 `fetchGitChanges` 和 `fetchGitCommits` 的轮询条件从 `activeTab === 'changes'` 改为 `isRunning || activeTab === 'changes'`
- Agent 运行中始终 10s 轮询 git 数据
- Agent 停止后仅在 tab 激活时轮询

---

## 6. 设计决策

### Q1: 流程图处理方式？

**决定：降级为最后一个 tab，标记为参考信息。**

理由：
- 流程图作为"BotoolAgent 是如何工作的"教学内容仍有价值
- 首次使用的用户可能需要理解循环逻辑
- 完全移除会丢失已投入的 ReactFlow 开发工作
- 作为最后一个 tab + `ℹ️` 标记，明确其"参考"定位

### Q2: 时间线使用纯 CSS 还是图表库？

**决定：纯 CSS 条形（`div` + `width%` + Tailwind）。**

理由：
- 条形图非常简单，只需 width 比例 + 颜色
- 不引入额外依赖（如 recharts / chart.js），保持 bundle 精简
- 纯 CSS 动画性能更好，尤其是在条形增长动画场景
- 如果未来需要更复杂的图表，再引入库也不迟

### Q3: 实时日志数据来源？

**决定：Phase 1 使用 progress.txt 最后 5 行（已有数据流）。**

理由：
- 零额外开发成本：`progressLog` 已通过 `useFileWatcher` SSE 实时推送
- progress.txt 更新频率与 Agent 迭代频率一致（每次迭代结束写入）
- tmux capture-pane 方案虽然更细粒度，但需要处理 tmux 会话管理、权限、跨平台兼容性
- Phase 2 可作为后续增强

### Q4: 当前焦点区显示单任务还是多任务？

**决定：自适应 — 并行时多卡片网格，串行时单任务详情卡片。**

理由：
- BotoolAgent 通过 Agent Teams（Task tool）支持同批次内多任务并行执行
- `teammates.json` 提供实时批次状态，`dependsOn` 拓扑排序提供 fallback
- 并行时用网格展示 2-4 张精简卡片，每张显示 ID + 标题 + 计时器 + 状态
- 串行时退化为详情卡片，展示验收标准等完整信息（信息密度更高）
- 两种模式自动切换，用户无需手动操作

### Q5: ETA 计算方式？

**决定：简单平均法（`avgTime * remainingTasks`），后续可升级。**

理由：
- 简单直观，用户容易理解
- 前几个任务完成后就能给出合理估计
- 复杂度加权需要任务元数据中的预估信息（当前 PRD 格式不包含）
- 简单平均在大多数情况下已经足够（任务粒度设计上应相对均匀）

**已知局限：**
- 第一个任务完成前 ETA 显示 "计算中..."
- 如果存在极端长短差异的任务，ETA 会不准确
- 可在 UI 上用 "约" 前缀表示这是估算值

### Q6: Teammate 状态的数据来源？

**决定：混合方案 — Lead Agent 写 `teammates.json` + 前端从 `prd.json` 依赖图推断作为 fallback。**

理由：
- `teammates.json` 由 Lead Agent 在 spawn/完成 Teammate 时主动写入，提供精确的批次状态
- LLM 可能偶尔忘记写入（指令遵从不是 100%），所以必须有 fallback
- Fallback 从 `dependsOn` 拓扑排序推断当前批次，结合 `passes` 状态判断执行中/已完成
- Fallback 无法区分"正在执行"和"排队中"，但对用户来说这个区别不关键
- 两层数据源都不需要新增后端 API，维护成本低

### Q7: 时间线按批次分组还是平铺？

**决定：按批次分组，用分隔线和 `B{n}` 标签区分。**

理由：
- 批次分组直观体现了 Agent Teams 的并行执行结构
- 同批次任务紧邻显示，用户一眼就能看出哪些任务是同时跑的
- 分隔线标记批次边界，比平铺列表更有信息层次
- 基于 `dependsOn` 拓扑排序计算批次，数据已存在于 `prd.json`

---

## 7. 开发任务

### DT-1: 增强进度带组件 (ProgressStrip)

**文件：**
- 创建：`viewer/src/components/ProgressStrip.tsx`
- 修改：`viewer/src/app/stage3/page.tsx` — 在 StageIndicator 下方插入 ProgressStrip

**验收标准：**
- [ ] 显示 `X/Y 任务 · Z%` 基础进度
- [ ] Agent 运行中显示 `已运行 Xm Ys · 均速 Xs/任务 · ETA 约 Xm`
- [ ] Agent 未运行时隐藏时间信息
- [ ] 全部完成时显示总耗时
- [ ] 进度条动画平滑（`transition-all duration-500`）
- [ ] typecheck + lint 通过

### DT-2: Teammate 状态 Hook + 数据基础设施 (useTeammates)

**文件：**
- 创建：`viewer/src/hooks/useTeammates.ts`
- 修改：`viewer/src/hooks/index.ts` — 导出新 hook
- 修改：`CLAUDE.lead.md` — 新增 teammates.json 写入指令
- 修改：`viewer/src/app/api/files/watch/route.ts` — 添加 `.state/teammates.json` 到监听列表（如需）

**验收标准：**
- [ ] 解析 `.state/teammates.json` 获取当前批次和 Teammate 状态
- [ ] 过期检测：`updatedAt` > 60s 时切换到 fallback
- [ ] Fallback：从 `prd.json` 的 `dependsOn` 做拓扑排序推断当前批次
- [ ] 拓扑排序结果用 `useMemo` 缓存
- [ ] 返回 `isParallel` 标志（`teammates.length >= 2`）
- [ ] `CLAUDE.lead.md` 新增明确指令让 Lead 在 batch 开始/任务完成时写 `teammates.json`
- [ ] typecheck + lint 通过

### DT-3: 任务耗时推算 Hook (useTaskTimings)

**文件：**
- 创建：`viewer/src/hooks/useTaskTimings.ts`
- 修改：`viewer/src/hooks/index.ts` — 导出新 hook

**验收标准：**
- [ ] 优先从 `teammates.json` 的 `startedAt`/`completedAt` 计算精确耗时
- [ ] 次选从 progressLog 解析每个任务的时间戳
- [ ] 计算已完成任务耗时、平均耗时、当前任务耗时、总耗时、最长耗时
- [ ] 返回按批次分组的二维数组 `batches: TaskTiming[][]`
- [ ] progressLog 为空且无 teammates.json 时 fallback 到均分计算
- [ ] 每秒更新 currentTaskElapsed
- [ ] typecheck + lint 通过

### DT-4: 批次面板 (BatchPanel — Agent Teams 可视化)

**文件：**
- 创建：`viewer/src/components/BatchPanel.tsx`
- 修改：`viewer/src/app/stage3/page.tsx` — 在中间区域上半部分插入

**验收标准：**
- [ ] **并行模式**（批次 >= 2 任务）：卡片网格显示所有 Teammate
  - 每张卡片：ID + 标题 + 计时器 + 状态指示
  - 响应式网格：2 列（2 任务）/ 3 列（3 任务）/ 4 列或 2x2（4 任务）
- [ ] **串行模式**（批次 = 1 任务）：详情卡片，含验收标准、PRD Section、迭代编号
- [ ] 计时器实时更新（秒级精度）
- [ ] 计时器颜色：正常白、>2x 均值黄、>3x 均值红
- [ ] 批次标题显示：`当前批次: Batch N · X 个 Teammate 并行`
- [ ] 空状态："等待启动代理..."
- [ ] 完成状态："全部任务已完成"
- [ ] 运行中卡片有呼吸动画，已完成卡片绿色边框 + 对号
- [ ] typecheck + lint 通过

### DT-5: 批次时间线 (BatchTimeline)

**文件：**
- 创建：`viewer/src/components/BatchTimeline.tsx`
- 修改：`viewer/src/app/stage3/page.tsx` — 在中间区域批次面板下方插入

**验收标准：**
- [ ] 按拓扑排序的批次分组显示，批次间有分隔线
- [ ] 每个批次第一行显示 `B{n}` 标签，其余行缩进
- [ ] 每行：ID + 标题 + 条形 + 时间 + 状态图标
- [ ] 条形宽度按实际耗时比例
- [ ] 颜色编码：绿色已完成、中性色执行中（脉冲）、浅灰等待、红色失败
- [ ] 执行中批次有高亮背景
- [ ] 垂直溢出滚动，自动滚动到当前批次
- [ ] 纯 CSS 实现，无额外依赖
- [ ] typecheck + lint 通过

### DT-6: 统计区 + 实时活动日志

**文件：**
- 创建：`viewer/src/components/LiveLog.tsx`
- 修改：`viewer/src/components/AgentDataPanel/AgentDataPanel.tsx` — 新增统计区 + 接收新 props
- 修改：`viewer/src/app/stage3/page.tsx` — 传递 git stats + progressLog 给右侧面板

**验收标准：**
- [ ] 统计区显示：均耗时、代码变更、文件数、提交数、ETA
- [ ] 实时活动日志：深色背景、等宽字体、5 行、自动滚动
- [ ] 日志从 progressLog 最后 5 行提取
- [ ] Agent 运行中自动轮询 git 数据（不仅在 tab 激活时）
- [ ] typecheck + lint 通过

### DT-7: Tab 重排序 + 流程图降级

**文件：**
- 修改：`viewer/src/app/stage3/page.tsx` — tab 顺序、默认 tab、流程图标记

**验收标准：**
- [ ] Tab 新顺序：`文件变更 | 提交记录 | 流程图ℹ️`
- [ ] 默认激活 tab 为 `文件变更`（`activeTab` 初始值改为 `'changes'`）
- [ ] `进度日志` tab 移除
- [ ] 流程图 tab 加 ℹ️ 标记
- [ ] 现有 FlowChart 组件在流程图 tab 中正常渲染（不做修改）
- [ ] typecheck + lint 通过

### DT-8: 页面集成 + 布局调整

**文件：**
- 修改：`viewer/src/app/stage3/page.tsx` — 组装所有新组件，调整中间区域布局

**验收标准：**
- [ ] 中间区域垂直分割：ProgressStrip（顶部） → BatchPanel（上） → BatchTimeline（中） → Tabs（下）
- [ ] 所有数据正确从 hooks 传递到各组件
- [ ] 布局在 1280px 宽度下不溢出
- [ ] 布局在 1920px 宽度下信息密度合理
- [ ] Agent 未运行 → 运行中 → 完成的全流程状态切换正常
- [ ] 现有功能不退化：任务列表展开、Agent 启停控制、阶段切换 modal
- [ ] typecheck + lint + build 通过

---

## 8. 风险与非目标

### 8.1 风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| Lead Agent 忘记写 teammates.json | 中 | BatchPanel 退化为 fallback 推断模式 | 从 prd.json 依赖图自动推断，UI 不空白；在 CLAUDE.lead.md 中用**加粗 + 重复**强调写入指令 |
| progress.txt 格式不一致导致时间解析失败 | 中 | 时间线条形全部等宽 | Fallback 到均分计算，不 crash |
| 拓扑排序计算在大任务图上性能问题 | 极低 | 前端卡顿 | 当前最大 ~15 个任务，BFS 复杂度 O(V+E) 可忽略；用 useMemo 缓存 |
| 中间区域垂直空间不足（小屏幕） | 低 | 布局挤压 | BatchPanel 和时间线各设最小高度，溢出滚动 |
| Agent 长时间无状态更新（SSE 断连） | 中 | 计时器继续走但数据不更新 | 已有 SSE 重连机制 + 连接状态指示 |
| Git 数据轮询频率增加导致性能问题 | 低 | API 响应变慢 | 10s 间隔已经很保守；git 命令执行 <100ms |

### 8.2 非目标（Out of Scope）

- **tmux capture-pane 实时终端输出**：复杂度高，留给 Phase 2
- **Teammate 中间过程实时流**：当前 Task tool 子进程无法被外部观测，只能看到开始/完成/失败
- **历史运行记录 / 对比**：属于独立功能
- **移动端适配**：Stage 3 是桌面监控场景，暂不考虑响应式
- **FlowChart 组件重写或移除**：仅降级 tab 位置，不修改组件本身
- **新增后端 API**：所有数据来源均复用现有 API 和 SSE（teammates.json 由 Lead Agent 直接写文件，不经过 API）
- **任务复杂度权重的 ETA 算法**：需要 PRD 格式扩展，留给后续
