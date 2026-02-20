# PRD: 全自动模式 (Auto Mode)

## 1. 项目概述

### 1.1 背景与动机
BotoolAgent Viewer 面向非技术用户（业务员、PM、领域专家），提供 5 阶段工作流将自然语言需求转化为可运行的代码。当前用户在 Stage 1 完成 PRD 生成后，仍需手动操作 Stage 2-5 的每个步骤（选择规则、确认修复、启动 Agent、启动测试、创建 PR、合并代码），这对非技术用户是不必要的认知负担。

### 1.2 核心目标
- Stage 2-5 全自动执行：一个开关控制全流程
- 失败自动重试一次：提高成功率
- 随时可手动关闭：用户保留完全控制权

### 1.3 成功指标
- 勾选 autoMode 后，用户无需任何额外点击即可完成 Stage 2→5 全流程
- 自动模式下 Stage 2-5 的用户交互点降为零

## 2. 当前状态

### 2.1 已有能力

| 模块 | 状态 | 说明 |
|------|------|------|
| ProjectContext | ✅ 已实现 | 管理项目状态（id, name, currentStage, prdId, branchName, status），持久化到 localStorage |
| StageIndicator | ✅ 已实现 | 顶部横栏展示 Stage 1-5 进度，纯展示组件 |
| StageTransitionModal | ✅ 已实现 | 转场弹窗，已支持 `autoCountdown` 倒计时自动确认 |
| Stage 1-5 页面 | ✅ 已实现 | 完整的手动工作流 |
| project-storage.ts | ✅ 已实现 | 通用序列化，新增字段自动持久化 |

### 2.2 缺口分析

| 缺口 | 说明 |
|------|------|
| autoMode 状态 | ProjectState 中无 autoMode 字段 |
| 自动触发逻辑 | 各 Stage 页面无自动执行能力 |
| UI 入口 | 无全自动模式复选框 |

## 3. 架构设计

### 3.1 核心概念

```
ProjectContext (扩展)
    │
    ├─ autoMode: boolean  ← NEW
    ├─ updateProject()    ← 已有
    └─ activeProject      ← 已有
    │
    └───▶ localStorage 持久化
           (自动通过 project-storage.ts)
```

### 3.2 核心工作流

```
手动模式:                       自动模式:
S1 → [手动] → S2             S1 → [勾选auto] → S2
     ↓                              ↓
S2: 用户逐步确认            S2: 2s间隔自动进步
5个 Step 每个手动点       自动选规则 → 自动接受
     ↓                              ↓
S3: 手动启动 Agent          S3: 自动启动(10轮)
    手动确认转场              3s Modal 自动转场
     ↓                              ↓
S4: 手动启动测试           S4: 自动启动测试
    手动确认转场              3s Modal 自动转场
     ↓                              ↓
S5: 手动 PR + 手动合并    S5: 自动 PR + 自动合并
```

### 3.3 状态机

```
autoMode 状态流转:

  off ──[用户勾选]──▶ on
   ▲                    │
   │                    ├─[用户取消]──▶ off
   │                    ├─[重试失败]──▶ off
   │                    └─[项目完成]──▶ off (自然结束)
```

### 3.4 失败处理决策树

```
Agent/测试失败
├── 首次失败?
│   ├─ 是 → 自动重试 1 次
│   │       ├─ 成功 → 继续自动流程
│   │       └─ 失败 → 关闭 autoMode → 回到手动模式
│   └─ 否(已是重试) → 关闭 autoMode → 回到手动模式
└── 用户手动修复后可重新勾选 autoMode
```

## 4. 数据设计

### 4.1 数据模型概览

| 模型 | 用途 | 关键字段 | 状态 |
|------|------|---------|------|
| ProjectState | 项目状态 | +autoMode: boolean | 修改 |

### 4.2 字段定义

```typescript
// viewer/src/contexts/ProjectContext.tsx
export interface ProjectState {
  // ... 现有字段 ...
  /** 全自动模式开关 */
  autoMode?: boolean;  // 可选，向后兼容旧项目
}
```

- 默认值: `false`（新项目）
- 可空: 使用 `?:` 可选字段，旧项目读取为 `undefined` → 视为 `false`
- 持久化: 自动通过 `project-storage.ts` 序列化到 localStorage
- 向后兼容: 旧项目无此字段时，读取为 `undefined`，在使用处 `!! project.autoMode` 即可

### 4.3 无数据库变更

仅 localStorage 层面的字段扩展，不涉及任何数据库/SQL 变更。

## 5. UI 设计

### 5.1 组件清单

| 组件 | Props 变更 | 状态 |
|------|-----------|------|
| StageIndicator | +autoMode, +onAutoModeChange | 修改 |
| Stage1PageContent | （内部读写 autoMode） | 修改 |

### 5.2 关键 UI 布局

**Stage1 PRD 生成区域（已有页面顶部 header 栏）:**
```
┌──────────────────────────────────────────────┐
│ ✔ PRD 已生成    [☐ 全自动模式] [保存 PRD 并继续] │
├──────────────────────────────────────────────┤
│                                              │
│  PRD 内容预览 (Markdown)                      │
│                                              │
└──────────────────────────────────────────────┘
勾选后在复选框下方显示提示文字:
"将自动完成后续所有步骤"
```

**StageIndicator 顶部横栏（Stage 2+ 可见）:**
```
┌──────────────────────────────────────────────┐
│ 项目名 · 状态  ●──●──●──○──○  [☑ 全自动模式] │
│                S1  S2  S3  S4  S5            │
└──────────────────────────────────────────────┘
```

- 复选框使用 shadcn 原生 `<input type="checkbox">` + 文字标签
- 简洁低调的视觉风格，与现有界面融合
- Stage 2+ 时在 StageIndicator 最右侧可见
- 可随时勾选/取消

## 6. 业务规则

### 6.1 自动模式规则

| ID | 规则 | 说明 | 影响任务 |
|----|------|------|---------|
| BR1 | autoMode 仅在 Stage1 结束后可勾选 | PRD 生成完成后，checkbox 出现在保存按钮旁 | DT-003 |
| BR2 | Stage2 自动选择所有可用规则 | 不跳过规则，全选所有 `rules/*.md` | DT-005 |
| BR3 | Stage3 Agent 默认 10 轮最大轮次 | 沿用现有默认值 | DT-006 |
| BR4 | 转场显示 Modal + 3s 自动确认 | 复用现有 `autoCountdown` 参数 | DT-005,DT-006,DT-007 |
| BR5 | 失败自动重试 1 次，再失败关闭 autoMode | 仅适用于 Agent 运行和测试阶段 | DT-006,DT-007 |
| BR6 | 用户可随时关闭 autoMode | 通过 StageIndicator checkbox | DT-004 |

## 7. 开发计划

### 7.0 Phase 依赖图

```
Phase 1 ──▶ Phase 2 ──▶ Phase 3
基础设施     UI 集成     自动化逻辑
(P0)         (P0)         (P0)

依赖关系:
Phase 1 是所有后续 Phase 的前置
Phase 2, Phase 3 可并行（但建议顺序执行以降低冲突）
```

### 7.1 Phase 1: 基础设施 (P0)

> **前置**: 无
> **产出**: autoMode 字段可在所有 Stage 中读写
> **对应设计**: Section 3.1, 4.2

- [ ] DT-001: ProjectContext 添加 autoMode 字段 (`文件: viewer/src/contexts/ProjectContext.tsx`)
  - 在 `ProjectState` 接口中添加 `autoMode?: boolean`
  - 在 `createProject` 中设置默认值 `autoMode: false`
  - `updateProject` 已支持 `Partial<ProjectState>`，无需修改
  - 验收: TypeScript 类型检查通过，`useProject().activeProject?.autoMode` 可读取

- [ ] DT-002: StageIndicator 添加 autoMode 复选框 (`组件: <StageIndicator>`, `文件: viewer/src/components/StageIndicator.tsx`)
  - Props 新增: `autoMode?: boolean`, `onAutoModeChange?: (checked: boolean) => void`, `showAutoMode?: boolean`
  - 在横栏最右侧添加 checkbox + "全自动模式" 文字标签
  - `showAutoMode` 控制是否显示（Stage 2+ 为 true）
  - 样式: 简洁文字 checkbox，使用 `text-sm text-neutral-600` + `accent-neutral-900`
  - 验收: TypeScript 通过，Stage 2+ 可见 checkbox，可勾选/取消

### 7.2 Phase 2: UI 集成 (P0)

> **前置**: Phase 1
> **产出**: 用户可在 Stage1 和 StageIndicator 中勾选 autoMode
> **对应设计**: Section 5.2, 5.3

- [ ] DT-003: Stage1 页面集成 autoMode 复选框 (`文件: viewer/src/app/stage1/page.tsx`)
  - 在 PRD 生成后的 header 栏中，「保存 PRD 并继续」按钮左侧添加 checkbox
  - 复选框仅在 `prdDraft` 存在时显示
  - 勾选后显示提示文字 "将自动完成后续所有步骤"（`text-xs text-neutral-500`）
  - 勾选状态通过 `updateProject({ autoMode: checked })` 持久化
  - 保存 PRD 时，如果 autoMode 为 true，StageTransitionModal 传入 `autoCountdown={3}`
  - 验收: TypeScript 通过，PRD 生成后 checkbox 可见，勾选后状态持久化，浏览器中验证

- [ ] DT-004: 各 Stage 页面接入 StageIndicator autoMode 复选框 (`文件: viewer/src/app/stage2/page.tsx`, `stage3/page.tsx`, `stage4/page.tsx`, `stage5/page.tsx`)
  - 在每个 Stage 页面的 `<StageIndicator>` 组件调用处，传入 `autoMode`, `onAutoModeChange`, `showAutoMode={true}` props
  - `onAutoModeChange` 回调调用 `updateProject({ autoMode: checked })`
  - 验收: TypeScript 通过，Stage 2-5 的 StageIndicator 右侧显示 checkbox，可勾选/取消

### 7.3 Phase 3: 自动化逻辑 (P0)

> **前置**: Phase 1, Phase 2
> **产出**: 勾选 autoMode 后 Stage 2-5 全自动运行
> **对应设计**: Section 3.2, 3.3, 3.4, 6.1

- [ ] DT-005: Stage2 自动步骤进行逻辑 (`文件: viewer/src/app/stage2/page.tsx`)
  - 读取 `activeProject?.autoMode`
  - 当 autoMode=true 时:
    - Step 0 (规则选择): 自动选择所有可用规则，2s 后自动进入 Step 1
    - Step 1 (PRD 对抗审查): 审查完成后 2s 自动接受修复，进入 Step 2
    - Step 2 (自动富化): 完成后 2s 自动进入 Step 3
    - Step 3 (富化对抗审查): 审查完成后 2s 自动接受修复，进入 Step 4
    - Step 4 (总结): 2s 后自动点击"启动自动开发"
  - 使用 `useEffect` + `setTimeout` 实现 2s 延迟自动进步
  - 需要在 autoMode 关闭时清除定时器
  - StageTransitionModal 传入 `autoCountdown={autoMode ? 3 : undefined}`
  - 验收: TypeScript 通过，autoMode 下 Stage2 自动完成 5 个 Step，浏览器中验证

- [ ] DT-006: Stage3 自动启动 Agent + 自动转场 (`文件: viewer/src/app/stage3/page.tsx`)
  - 读取 `activeProject?.autoMode`
  - 当 autoMode=true 且 Agent 状态为 idle 时:
    - 自动调用 `startAgent` API（mode: 'teams', maxIterations: 10）
  - Agent 完成后，StageTransitionModal 传入 `autoCountdown={3}`
  - 失败处理:
    - 首次失败: 自动重新调用 `startAgent`（重试 1 次）
    - 重试失败: 调用 `updateProject({ autoMode: false })`，关闭自动模式
  - 验收: TypeScript 通过，autoMode 下 Agent 自动启动，完成后 3s 自动转场，浏览器中验证

- [ ] DT-007: Stage4 自动启动测试 + 自动转场 (`文件: viewer/src/app/stage4/page.tsx`)
  - 读取 `activeProject?.autoMode`
  - 当 autoMode=true 且测试状态为 idle 时:
    - 自动调用 `startAgent` API（mode: 'testing'）
  - 测试全部通过后，自动导航到 Stage5（传入 `autoCountdown={3}`）
  - 失败处理:
    - 首次失败: 自动重新调用 `startAgent`（重试 1 次）
    - 重试失败: 调用 `updateProject({ autoMode: false })`，关闭自动模式
  - 验收: TypeScript 通过，autoMode 下测试自动启动，通过后 3s 自动转场，浏览器中验证

- [ ] DT-008: Stage5 自动创建 PR + 自动合并 (`文件: viewer/src/app/stage5/page.tsx`)
  - 读取 `activeProject?.autoMode`
  - 当 autoMode=true 时:
    - 页面加载后，如果无 PR 存在: 自动调用创建 PR API
    - PR 创建完成且 mergeable 时: 自动调用合并 API
    - 合并完成后: StageTransitionModal 传入 `autoCountdown={3}`，自动返回 Dashboard
  - 失败处理:
    - PR 创建或合并失败: 调用 `updateProject({ autoMode: false })`，关闭自动模式（不重试，因为 git 操作失败通常需要人工介入）
  - 验收: TypeScript 通过，autoMode 下 PR 自动创建、自动合并、自动返回 Dashboard，浏览器中验证

## 8. 附录

### A. 代码文件索引

| 文件路径 | 状态 | Phase | 任务 |
|---------|------|-------|------|
| `viewer/src/contexts/ProjectContext.tsx` | 修改 | Phase 1 | DT-001 |
| `viewer/src/components/StageIndicator.tsx` | 修改 | Phase 1 | DT-002 |
| `viewer/src/app/stage1/page.tsx` | 修改 | Phase 2 | DT-003 |
| `viewer/src/app/stage2/page.tsx` | 修改 | Phase 2+3 | DT-004, DT-005 |
| `viewer/src/app/stage3/page.tsx` | 修改 | Phase 2+3 | DT-004, DT-006 |
| `viewer/src/app/stage4/page.tsx` | 修改 | Phase 2+3 | DT-004, DT-007 |
| `viewer/src/app/stage5/page.tsx` | 修改 | Phase 2+3 | DT-004, DT-008 |
| `viewer/src/lib/project-storage.ts` | ✅ 已有 | - | 无需修改 |
| `viewer/src/components/StageTransitionModal.tsx` | ✅ 已有 | - | 无需修改（已支持 autoCountdown） |

### B. 风险与缓解措施

#### MEDIUM
- **旧项目向后兼容**: 无 `autoMode` 字段的项目 → **缓解**: 使用可选字段 `autoMode?: boolean`，读取为 `undefined` 时视为 `false`

#### LOW
- **Stage2 自动步骤时序竞争**: 异步操作未完成时 setTimeout 触发 → **缓解**: 2s 延迟 + 检查当前 Step 状态后再推进
- **浏览器标签切换**: 用户在自动进行中切换到其他标签页 → **缓解**: 使用 `useEffect` 清理机制，组件卸载时取消定时器

### C. 测试策略

#### 手动测试
- 完整 autoMode 流程: Stage1 勾选 → Stage2-5 全自动 → Dashboard
- 中途关闭: Stage3 进行中取消 autoMode → 回到手动模式
- 失败重试: Agent 失败 → 自动重试 → 重试失败 → autoMode 关闭
- 旧项目兼容: 无 autoMode 字段的项目正常使用手动流程

#### TypeScript 类型检查
- `cd viewer && npx tsc --noEmit` 通过

### D. 非目标 (Out of Scope)
- 细粒度配置面板（单独控制每个 Stage、设置最大轮次等）
- Dashboard 上的自动模式入口
- 自动模式日志/历史记录
- 自动模式下的邮件/通知推送
- autoMode 的安全门控（如合并前强制确认弹窗）
- 新增 shadcn 组件（复用原生 HTML checkbox）
