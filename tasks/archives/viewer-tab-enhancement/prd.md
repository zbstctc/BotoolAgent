# PRD: Viewer Tab 优化

## 1. 项目概述

### 1.1 背景与动机
BotoolAgent Viewer 的 Tab 栏当前存在以下体验问题：
- Tab 命名显示 "PRD: xxx" 格式，"PRD:" 前缀占用空间，名称过长时截断严重
- 仅有运行中项目显示绿色脉冲圆点，无法区分错误/等待/空闲等状态
- 多项目并行时，用户无法快速判断哪个项目需要关注
- 进程完成后无提醒机制，用户可能长时间不知道任务已结束

### 1.2 核心目标
- 去掉 Tab 中 "PRD:" 前缀，只显示项目名称，节省空间
- 通过颜色编码（黄/绿/红）让用户一眼看出每个项目的状态
- 鼠标悬浮时立即展示项目精简信息和状态（使用 shadcn Popover）
- 进程结束或报错时播放提示音并触发 Tab 黄色闪烁，吸引用户注意

### 1.3 成功指标
- Tab 名称不再包含 "PRD:" 前缀
- 所有项目 Tab 显示对应状态颜色
- 悬浮信息卡在 hover 时立即展示
- 状态变化（完成/报错）触发声音和闪烁提醒

## 3. 架构设计（概要）

### 3.1 核心工作流

```
useAgentStatus (各 stage 页面已有)
     │
     ├── status 变化 ──▶ TabContext.updateTabStatus(id, status)
     │                        │
     │                        ├─▶ TabBar: border 颜色渲染（黄/绿/红）
     │                        ├─▶ TabBar: CSS 闪烁动画（needsAttention）
     │                        └─▶ Popover: 状态标签 Badge
     │
     └── 状态转换检测 ──▶ useTabNotification (新 hook)
                              ├─▶ Web Audio API: 播放提示音
                              └─▶ TabContext: 设置 needsAttention 标记

用户点击闪烁 Tab ──▶ TabContext.clearAttention(id)
                         └─▶ 停止闪烁 + 保持状态颜色
```

### 3.2 状态映射表

| agent-status 值 | Tab 颜色 | 含义 | 触发提醒 |
|-----------------|---------|------|---------|
| `running` / `starting` / `waiting_network` | 绿色 (`border-green-500`) | 运行中 | 否 |
| `error` / `failed` / `stopped` | 红色 (`border-red-500`) | 报错 | 是（声音+闪烁） |
| `idle` / `complete` / `session_done` / `max_iterations` / `max_rounds` / `iteration_complete` | 黄色 (`border-amber-400`) | 待用户操作 | 是（从 running→此状态时） |
| 无状态（新建项目）| 黄色 (`border-amber-400`) | 待用户操作 | 否 |

**提醒触发条件：** 从 running/starting/waiting_network 变为任何终止状态（idle/complete/error/failed 等）时触发。

## 4. 数据设计（概要）

### 4.1 TabItem 扩展

| 字段 | 类型 | 说明 | 状态 |
|------|------|------|------|
| `id` | `string` | requirementId | 已有 |
| `name` | `string` | 项目名称（不含 PRD 前缀）| 已有（需清洗） |
| `stage` | `number` | 当前阶段 1-5 | 已有 |
| `isRunning` | `boolean` | agent 是否运行中 | 已有 |
| `url` | `string` | 工具 tab 的固定 URL | 已有 |
| `agentStatus` | `string` | agent-status 原始值 | **新增** |
| `needsAttention` | `boolean` | 是否需要用户注意（闪烁标记）| **新增** |
| `progress` | `{ completed: number; total: number }` | 任务进度 | **新增** |

### 4.2 TabContext 新增方法

| 方法 | 签名 | 说明 |
|------|------|------|
| `updateTabStatus` | `(id: string, status: string, progress?: { completed: number; total: number }) => void` | 更新 Tab 的 agent 状态和进度 |
| `setNeedsAttention` | `(id: string, needsAttention: boolean) => void` | 设置/清除闪烁标记 |
| `clearAttention` | `(id: string) => void` | 快捷方法，等同于 `setNeedsAttention(id, false)` |

## 5. UI 设计（概要）

### 5.1 组件清单

| 组件 | Props | 状态 |
|------|-------|------|
| `TabBar` | 现有 Props | 修改（颜色/Popover/闪烁） |
| `Popover` (shadcn) | 内置 | 已有组件，新增使用 |
| `Badge` (shadcn) | 内置 variant | 已有组件，新增使用 |

### 5.2 Tab 显示优化

**当前：**
```
┌───────────────────────────────┐
│ ● PRD: Viewer Tab 优化 (S3)  │
└───────────────────────────────┘
```

**优化后（运行中 - 绿色）：**
```
┌───────────────────────────────┐  border-green-500
│ Viewer Tab 优化               │
└───────────────────────────────┘
```

**优化后（待操作 - 黄色闪烁）：**
```
┌───────────────────────────────┐  border-amber-400 + animate-pulse-border
│ Viewer Tab 优化               │
└───────────────────────────────┘
```

**优化后（报错 - 红色）：**
```
┌───────────────────────────────┐  border-red-500
│ Viewer Tab 优化               │
└───────────────────────────────┘
```

### 5.3 悬浮信息卡布局

```
┌─────────────────────────────┐
│  Viewer Tab 优化             │  ← 项目全名
│  ─────────────────────────  │
│  阶段: Stage 3 - 自动开发   │  ← 当前阶段描述
│  进度: ████████░░ 8/10      │  ← 进度条 + 数字
│  ┌─────────┐                │
│  │ 运行中  │                │  ← 状态 Badge（success/warning/error variant）
│  └─────────┘                │
└─────────────────────────────┘
```

Popover 使用 shadcn `<Popover>` 组件：
- 触发方式：hover（`onMouseEnter`/`onMouseLeave` 控制 `open` state）
- 位置：Tab 下方 (`side="bottom"`)
- 背景：白色 (`bg-white`)
- 宽度：`w-64`

### 5.4 闪烁动画

使用 CSS `@keyframes` 定义黄色边框闪烁：
```css
@keyframes pulse-border-amber {
  0%, 100% { border-color: rgb(251 191 36); } /* amber-400 */
  50% { border-color: transparent; }
}
```
- 闪烁频率：1s 循环
- 仅在 `needsAttention === true` 时激活
- 用户点击 Tab 后停止

### 5.5 声音提示

使用 Web Audio API 生成简短提示音（两种）：
- **完成提示音**：轻快上升音调（如 440Hz → 660Hz，200ms）
- **错误提示音**：低沉下降音调（如 440Hz → 220Hz，300ms）
- 静默失败：如果浏览器未经用户交互不允许播放，不弹权限请求

## 7. 开发计划

### 7.0 Phase 依赖图

```
Phase 1 ──▶ Phase 2 ──▶ Phase 3
Tab显示      悬浮信息卡  提醒机制
(P0)        (P0)        (P0)

依赖关系:
Phase 1 是所有后续 Phase 的前置
Phase 2 和 Phase 3 可在 Phase 1 完成后并行
```

### 7.1 Phase 1: Tab 显示优化 (P0)

> **前置**: 无
> **产出**: Tab 去掉 PRD 前缀，显示状态颜色，TabItem 支持新字段
> **对应设计**: Section 3.2, 4.1, 5.2
> **适用规范**: 前端命名规范, 状态管理规范, 前端样式规范, 项目结构规范
> **规范要点**: Props 接口用 `{ComponentName}Props` 格式; Context hook 必须含 null check; localStorage 读取检查 SSR; 状态色仅用于小元素; 自定义动画定义在 globals.css

- [ ] DT-001: 扩展 TabItem 数据结构，新增 agentStatus/needsAttention/progress 字段 (`文件: viewer/src/lib/tab-storage.ts`)
  - 在 `TabItem` 接口中添加 `agentStatus?: string`、`needsAttention?: boolean`、`progress?: { completed: number; total: number }`
  - 确保 `loadTabs()` 对旧数据向后兼容（缺失字段使用默认值）
  - [ ] [规范] localStorage 读取检查 `typeof window === 'undefined'` 防止 SSR
  - [ ] [规范] 数据结构新字段使用 optional（`?`）保证向后兼容
  - Typecheck passes

- [ ] DT-002: TabContext 新增状态更新方法 (`文件: viewer/src/contexts/TabContext.tsx`)
  - 添加 `updateTabStatus(id, status, progress?)` 方法
  - 添加 `setNeedsAttention(id, needsAttention)` 方法
  - 在 `switchTab` 中，当切换到目标 Tab 时自动 `clearAttention`
  - 更新 `TabContextValue` 接口
  - [ ] [规范] Context hook 必须包含 null check 并 throw 明确错误
  - [ ] [规范] Provider 和 hook 使用 `{Name}Provider` / `use{Name}` 命名
  - Typecheck passes

- [ ] DT-003: TabBar 去掉 PRD 前缀 + 状态颜色边框 (`文件: viewer/src/components/TabBar.tsx`)
  - Tab 名称去掉 "PRD:" 前缀显示（在渲染时 `name.replace(/^PRD:\s*/i, '')`）
  - 移除现有的绿色脉冲圆点指示器
  - 根据 `tab.agentStatus` 添加状态颜色 border（绿色/红色/黄色）
  - 无状态项目默认显示黄色 border
  - 当 `tab.needsAttention` 为 true 时添加黄色闪烁 CSS 动画
  - 在 `globals.css` 或内联 style 中定义 `@keyframes pulse-border-amber`
  - [ ] [规范] 状态色仅用于 border/badge 小元素，不用于按钮
  - [ ] [规范] 使用 `cn()` 合并类名，不手动拼接
  - [ ] [规范] 自定义动画定义在 `globals.css`
  - Verify in browser
  - Typecheck passes

### 7.2 Phase 2: 悬浮信息卡 (P0)

> **前置**: Phase 1 (DT-001, DT-002)
> **产出**: hover 时展示项目精简信息的 Popover
> **对应设计**: Section 5.3
> **适用规范**: 前端样式规范, 前端命名规范
> **规范要点**: 弹窗背景必须白色 `bg-white`; 使用 shadcn 组件不手写 modal; 状态 Badge 使用规范色系

- [ ] DT-004: 在 TabBar 中集成 shadcn Popover 实现悬浮信息卡 (`文件: viewer/src/components/TabBar.tsx`)
  - 每个 Tab 用 `<Popover>` 包裹，`open` 状态由 `onMouseEnter`/`onMouseLeave` 控制
  - Popover 内容：项目全名、阶段描述（Stage 1-5 映射为中文名）、进度条 + 数字、状态 Badge
  - 使用 shadcn `<Badge>` 组件显示状态（variant: success/warning/error）
  - Popover 背景白色，位于 Tab 下方
  - 确保 Popover 不阻碍 Tab 点击事件
  - [ ] [规范] 弹窗/下拉必须白色背景 `bg-white`，禁止透明
  - [ ] [规范] Badge 状态色用 success(绿)/warning(琥珀)/error(红) variant
  - Verify in browser
  - Typecheck passes

- [ ] DT-005: Stage 页面中将 agent-status 同步到 TabContext (`文件: viewer/src/app/stage3/page.tsx`, `viewer/src/app/stage4/page.tsx`, `viewer/src/app/stage5/page.tsx`)
  - 在各 stage 页面中，当 `useAgentStatus` 返回状态变化时，调用 `updateTabStatus()` 同步到 TabContext
  - 同步 agentStatus 值和 progress（completed/total）
  - 确保仅在状态实际变化时更新，避免不必要渲染
  - [ ] [规范] 使用 useEffect 监听状态变化，不在渲染中直接调用 setState
  - Typecheck passes

### 7.3 Phase 3: 提醒机制 (P0)

> **前置**: Phase 1 (DT-001, DT-002)
> **产出**: 声音提醒 + Tab 闪烁动画
> **对应设计**: Section 3.1, 5.4, 5.5
> **适用规范**: 项目结构规范, 前端命名规范, 前端样式规范
> **规范要点**: 新 hook 必须 `use` 前缀放在 `hooks/` 目录; 自定义动画定义在 `globals.css`; 使用浏览器 API 的组件标记 `'use client'`

- [ ] DT-006: 创建 useTabNotification hook，实现 Web Audio 提示音 (`文件: viewer/src/hooks/useTabNotification.ts`)
  - 使用 Web Audio API 生成两种提示音：完成（上升音调）和错误（下降音调）
  - 监听 TabContext 中各 Tab 的 agentStatus 变化
  - 当从 running/starting/waiting_network 变为终止状态时触发提醒
  - 完成状态（idle/complete/session_done 等）播放完成音 + 设置 needsAttention
  - 错误状态（error/failed/stopped）播放错误音 + 设置 needsAttention
  - 静默失败处理：Web Audio 播放失败时 catch 错误不弹提示
  - [ ] [规范] hook 文件名与 hook 名一致（`useTabNotification.ts`）
  - [ ] [规范] 使用浏览器 API 需标记 `'use client'`
  - Typecheck passes

- [ ] DT-007: 在 TabBar 中实现闪烁动画 (`文件: viewer/src/components/TabBar.tsx`, `viewer/src/app/globals.css`)
  - 定义 `@keyframes pulse-border-amber` CSS 动画（1s 循环，border-color 在 amber-400 和 transparent 之间切换）
  - 当 `tab.needsAttention === true` 时给 Tab 添加闪烁动画 class
  - 闪烁与状态颜色共存：闪烁时使用黄色，闪烁停止后恢复实际状态颜色
  - [ ] [规范] 自定义动画定义在 `globals.css`
  - [ ] [规范] 使用 `transition-colors` 或 `transition-all` 过渡
  - Verify in browser
  - Typecheck passes

- [ ] DT-008: 在 Layout 中挂载 useTabNotification hook (`文件: viewer/src/app/layout.tsx` 或合适的全局位置)
  - 在 TabProvider 子组件中调用 `useTabNotification()` hook
  - 确保 hook 在整个应用生命周期中保持活跃
  - 确保不与现有的 status polling 冲突
  - [ ] [规范] hook 在 Provider 子组件中调用，不在 Provider 外
  - Typecheck passes

## 8. 附录

### A. 代码文件索引

| 文件路径 | 状态 | Phase | 任务 |
|---------|------|-------|------|
| `viewer/src/lib/tab-storage.ts` | 修改 | Phase 1 | DT-001 |
| `viewer/src/contexts/TabContext.tsx` | 修改 | Phase 1 | DT-002 |
| `viewer/src/components/TabBar.tsx` | 修改 | Phase 1-3 | DT-003, DT-004, DT-007 |
| `viewer/src/hooks/useTabNotification.ts` | 新建 | Phase 3 | DT-006 |
| `viewer/src/app/stage3/page.tsx` | 修改 | Phase 2 | DT-005 |
| `viewer/src/app/stage4/page.tsx` | 修改 | Phase 2 | DT-005 |
| `viewer/src/app/stage5/page.tsx` | 修改 | Phase 2 | DT-005 |
| `viewer/src/app/globals.css` | 修改 | Phase 3 | DT-007 |
| `viewer/src/app/layout.tsx` | 修改 | Phase 3 | DT-008 |

### B. 风险与缓解措施

#### LOW
- **Popover 与 Tab 点击事件冲突**: hover 展示 Popover 时点击可能误触 → **缓解**: Popover 使用 `pointerEvents: none` 或合理的 `openDelay` 隔离点击和悬浮
- **Web Audio API 浏览器限制**: 首次交互前浏览器可能阻止音频播放 → **缓解**: 静默失败，用户首次点击任何 UI 后自然解除限制
- **localStorage 向后兼容**: 旧版 TabItem 无新字段 → **缓解**: `loadTabs()` 中对缺失字段设默认值

### D. 非目标 (Out of Scope)
- 不新建独立的 ProjectTab 组件或 NotificationProvider
- 不实现通知中心/消息队列
- 不提供声音自定义设置
- 不修改后端 agent-status 逻辑
- 不修改 Dashboard 页面的项目列表展示
