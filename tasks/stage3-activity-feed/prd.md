# PRD: Stage 3 实时代理活动流

**项目 ID**: stage3-activity-feed
**技术栈**: Next.js 16.1.6 + React 19 + TypeScript + Tailwind v4 + shadcn/ui
**模式**: 功能开发

---

## 1. 项目概述

当代理在 Stage 3 启动后，需要 2-4 分钟读取 PRD、规划任务、创建 worktree，此期间 Viewer 界面显示零可见活动——无文件变更、无提交记录，只有空白区域。用户因此误以为系统卡住。

本功能通过捕获代理 tmux 会话的终端输出，在 Stage 3 的新增"活动"Tab 中实时展示代理正在执行的操作，填补代理启动初期的空白期，提升用户体验。

**核心目标：**
- 实时展示代理 tmux 终端输出，让用户看到代理的工作进展
- 通过"活动"Tab 填补代理启动 2-4 分钟的空白期
- 智能格式化工具调用（复用 TerminalActivityFeed 的 formatTerminalLine），提升输出可读性

---

## 3. 架构设计

```
tmux botool-teams-{projectId}
     │  capture-pane -p -l 40
     ▼  (execFile 安全调用，防命令注入)
/api/agent/logs  [新建]
  ├── normalizeProjectId() 防路径穿越
  ├── ANSI 控制码去除
  ├── formatTerminalLine() 格式化工具调用行
  └── 返回 { lines: string[], sessionName: string, alive: boolean }
        alive = tmux has-session 检测会话是否存活
     │  3s 轮询（仅 isRunning 时）
     ▼
useAgentLogs Hook  [新建]
  ├── Set<string> ref 去重（避免 tmux 快照内容重叠）
  ├── 累积最多 50 行，新行追加，超出丢弃最旧
  └── reset() 清空 lines 和 Set 缓存
     │
     ▼
Stage 3 page.tsx  [修改]
  ├── 新增"活动" Tab（第 4 个 Tab）
  ├── 绿色脉冲点（alive=true 时）
  ├── 当 isRunning && fileChanges.length === 0 → 自动切入活动 Tab
  └── AgentActivityFeed 组件  [新建]
        bg-neutral-900 深色终端风格
        font-mono text-xs，自动滚动到底部
```

### 复用的现有代码

- `viewer/src/components/TerminalActivityFeed.tsx` → `formatTerminalLine()` 函数，将 Claude 工具调用格式化为 `cat/grep` 风格
- `viewer/src/lib/project-root.ts` → `normalizeProjectId()` 防路径穿越校验
- `viewer/src/hooks/useAgentStatus.ts` → `agentStatus.isRunning` 状态判断

---

## 7. 开发计划

### 7.0 Phase 依赖图

```
Phase 1 ──▶ Phase 2 ──▶ Phase 3
API 端点    Hook+组件    Stage3 集成
(P0)        (P0)         (P0)

依赖关系:
Phase 1 是 Phase 2 的前置
Phase 2 是 Phase 3 的前置
```

### 7.1 Phase 1: API 端点 (P0)

> **前置**: 无
> **产出**: `/api/agent/logs` 端点可用，返回过滤后的 tmux 输出
> **对应设计**: Section 3

- [ ] DT-001: 新建 /api/agent/logs GET 端点 (`文件: viewer/src/app/api/agent/logs/route.ts`)
  - 接受 `?projectId=xxx` 查询参数，缺失时返回 400
  - 使用 `normalizeProjectId()` 校验，无效时返回 400
  - sessionName: `botool-teams-${projectId}`（与 BotoolAgent.sh line 120 一致）
  - 使用 `execFile('tmux', ['has-session', '-t', sessionName])` 检测会话，失败时返回 `{ lines: [], sessionName, alive: false }`
  - 使用 `execFile('tmux', ['capture-pane', '-t', sessionName, '-p', '-l', '40'])` 捕获输出（非 exec，防命令注入）
  - 过滤 ANSI 控制码（正则 `/\x1b\[[0-9;]*[mGKHF]/g`）
  - 调用 `formatTerminalLine()` 格式化已知工具调用行，未知格式原样保留
  - 过滤空行，返回 `{ lines: string[], sessionName: string, alive: boolean }`
  - 整体 try/catch，catch 中 console.error，返回 `{ error: string }` + 500
  - [安全] 使用 execFile（非 exec），tmux 参数为固定数组，不拼接用户输入
  - [安全] 错误响应不暴露内部路径信息
  - [ ] Typecheck passes

### 7.2 Phase 2: Hook + 组件 (P0)

> **前置**: Phase 1
> **产出**: useAgentLogs Hook 和 AgentActivityFeed 组件可用
> **对应设计**: Section 3

- [ ] DT-002: 新建 useAgentLogs Hook (`文件: viewer/src/hooks/useAgentLogs.ts`)
  - 接受 `{ projectId: string, enabled: boolean }` 参数
  - 轮询 `/api/agent/logs?projectId=xxx` 每 3000ms，仅当 `enabled === true` 时轮询
  - 使用 `useRef<Set<string>>` 跟踪已见过的行（tmux 快照内容重叠去重）
  - 累积最多 50 行，新行追加到末尾，超出时丢弃最旧行（`slice(-50)`）
  - 导出 `{ lines: string[], alive: boolean, isPolling: boolean, reset: () => void }`
  - `reset()` 清空 lines 状态和 Set 去重缓存
  - enabled 变为 false 时停止轮询（clearInterval）
  - [ ] Typecheck passes

- [ ] DT-003: 新建 AgentActivityFeed 组件 (`文件: viewer/src/components/AgentActivityFeed.tsx`)
  - Props: `interface AgentActivityFeedProps { lines: string[]; alive: boolean; }`
  - 容器：`bg-neutral-900 rounded-lg overflow-hidden flex flex-col h-full`
  - Header：`flex items-center gap-2 px-3 py-2 border-b border-neutral-800`，显示"代理活动 · 实时"
  - alive=true 时在 Header 显示 `animate-pulse` 绿色圆点（`bg-green-400 rounded-full w-1.5 h-1.5`）
  - 内容区：`font-mono text-xs overflow-y-auto flex-1 p-3 space-y-0.5`
  - 每行前缀 `$ ` (text-neutral-500)，内容 text-neutral-200
  - 展示最新 15 行（`lines.slice(-15)`）
  - 新内容出现时 useRef + scrollIntoView 自动滚动到底部
  - fallback（alive=true，lines 为空）：显示 `text-neutral-500 text-xs` "等待代理输出..."
  - fallback（alive=false）：显示 `text-neutral-600 text-xs` "代理未运行"
  - [ ] Typecheck passes
  - [ ] Verify in browser: 深色背景白色文字，脉冲点，自动滚动

### 7.3 Phase 3: Stage 3 集成 (P0)

> **前置**: Phase 2
> **产出**: Stage 3 活动 Tab 可见且自动切换运行
> **对应设计**: Section 3

- [ ] DT-004: 修改 stage3/page.tsx + hooks/index.ts 集成活动 Tab
  - **a.** 扩展 Tab 类型（`文件: viewer/src/app/stage3/page.tsx`）:
    ```typescript
    type RightPanelTab = 'changes' | 'commits' | 'flowchart' | 'activity';
    ```
  - **b.** 添加 Hook 调用（在 useAgentStatus 调用之后）:
    ```typescript
    const agentLogs = useAgentLogs({ projectId, enabled: agentStatus.isRunning });
    ```
  - **c.** 添加"活动"Tab 按钮（在"流程图"Tab 按钮之后）:
    ```tsx
    <button
      onClick={() => setActiveTab('activity')}
      className={cn('...', activeTab === 'activity' ? '...' : '...')}
    >
      {agentLogs.alive && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />}
      活动
    </button>
    ```
  - **d.** 添加活动 Tab 内容（在流程图内容之后）:
    ```tsx
    {activeTab === 'activity' && (
      <AgentActivityFeed lines={agentLogs.lines} alive={agentLogs.alive} />
    )}
    ```
  - **e.** 自动切换逻辑：useEffect 监听 `agentStatus.isRunning` 和 `fileChanges.length`
    - 当 `isRunning && fileChanges.length === 0 && activeTab !== 'activity'` → `setActiveTab('activity')`
    - 仅单向切换（切入活动），不自动切回
  - **f.** 增强"暂无文件变更"空状态：在空状态文字下方添加"查看代理活动"按钮，点击 `setActiveTab('activity')`
  - **g.** `handleStartAgent` 函数中在调用 API 之前添加 `agentLogs.reset()`
  - **h.** 更新 hooks/index.ts:
    ```typescript
    export { useAgentLogs } from './useAgentLogs';
    ```
  - [ ] Typecheck passes (`cd viewer && npx tsc --noEmit`)
  - [ ] Verify in browser: 活动 Tab 出现，脉冲点，内容展示，空状态链接可用

---

## 8. 附录

### A. 代码文件索引

| 文件路径 | 状态 | Phase | 任务 |
|---------|------|-------|------|
| `viewer/src/app/api/agent/logs/route.ts` | 待开发（新建） | Phase 1 | DT-001 |
| `viewer/src/hooks/useAgentLogs.ts` | 待开发（新建） | Phase 2 | DT-002 |
| `viewer/src/components/AgentActivityFeed.tsx` | 待开发（新建） | Phase 2 | DT-003 |
| `viewer/src/app/stage3/page.tsx` | 修改 | Phase 3 | DT-004 |
| `viewer/src/hooks/index.ts` | 修改 | Phase 3 | DT-004 |
| `viewer/src/components/TerminalActivityFeed.tsx` | 已有（复用） | - | `formatTerminalLine` |
| `viewer/src/lib/project-root.ts` | 已有（复用） | - | `normalizeProjectId` |

### B. 风险与缓解措施

#### MEDIUM
- **tmux 会话不存在**: execFile('tmux', ['has-session', ...]) 失败 → 缓解: catch 中返回 `{ lines: [], alive: false }` 而非 500 错误，前端正常显示"代理未运行"

#### LOW
- **tmux 输出含未知格式**: formatTerminalLine 只处理已知工具名称 → 缓解: 未知格式原样输出，不崩溃，保持可读性
- **3s 轮询导致轻微延迟**: 用户看到的输出最多延迟 3s → 缓解: 对 UX 影响可接受，无需改为 SSE

### D. 非目标 (Out of Scope)

- 修改 BotoolAgent.sh
- 历史记录持久化（刷新页面后日志消失）
- tmux 输出语义解析（只做格式化，不做 AI 分析）
- 搜索/过滤功能
- 多版本 tmux 会话支持
- 首个文件变更出现时自动切回"文件变更"Tab

### E. 安全检查项

- [DT-001] 使用 `execFile`（非 `exec`），tmux 参数为固定数组，用户输入 projectId 经 normalizeProjectId 校验后仅用于构造 sessionName 字符串（不直接传入 shell）
- [DT-001] `normalizeProjectId()` 拒绝包含 `/`、`\`、`..`、`\0` 的 projectId，防路径穿越
- [DT-001] 错误响应仅返回通用错误信息，不暴露内部路径或堆栈
