# PRD: Viewer 工作流优化

## Introduction

BotoolAgent Viewer 是面向非开发者（业务员/工程师）的智能开发助手界面。当前 Stage 1-5 之间的工作流存在割裂问题：Stage 完成后缺乏明确指示，页面跳转不流畅，刷新后状态丢失。本次优化将建立统一的项目状态管理，实现流畅的 Stage 过渡体验，并支持多项目并行。

## Goals

- 建立全局项目状态管理，支持多项目并行
- Stage 完成后显示确认弹窗，引导用户进入下一阶段
- 刷新页面后自动恢复到上次 Stage
- Dashboard 改造为项目状态中心，展示所有项目卡片
- 项目卡片简洁展示状态，悬浮显示完整信息
- 更新 CLAUDE.md 说明 Viewer 产品定位

## User Stories

### US-001: 创建 ProjectContext 全局状态管理
**Description:** As a developer, I need a global project state context so that all stages can share project information.

**Acceptance Criteria:**
- [ ] 创建 `viewer/src/contexts/ProjectContext.tsx`
- [ ] 包含 `ProjectState` 接口：id, name, currentStage, prdId, branchName, status, createdAt, updatedAt
- [ ] 提供 `ProjectProvider` 组件
- [ ] 提供 `useProject` hook 获取和更新项目状态
- [ ] 支持多项目：`projects: Record<string, ProjectState>`, `activeProjectId: string | null`
- [ ] 在 `layout.tsx` 中包裹 `ProjectProvider`
- [ ] Typecheck passes

### US-002: 创建项目状态持久化存储
**Description:** As a user, I want my project state to persist so that I can resume work after refreshing the page.

**Acceptance Criteria:**
- [ ] 创建 `viewer/src/lib/project-storage.ts`
- [ ] 使用 localStorage key: `botool-projects`
- [ ] 提供 `saveProject`, `getProject`, `getAllProjects`, `deleteProject`, `archiveProject` 方法
- [ ] 在 `ProjectContext` 中集成，状态变化时自动保存
- [ ] 页面加载时自动从 localStorage 恢复
- [ ] Typecheck passes

### US-003: 创建 StageTransitionModal 组件
**Description:** As a user, I want to see a confirmation when a stage is complete so that I know what happened and what's next.

**Acceptance Criteria:**
- [ ] 创建 `viewer/src/components/StageTransitionModal.tsx`
- [ ] Props: `isOpen`, `fromStage`, `toStage`, `summary`, `onConfirm`, `onLater`
- [ ] 显示完成摘要（如 "PRD 已保存"）
- [ ] "继续" 按钮跳转到下一 Stage
- [ ] "稍后" 按钮回到 Dashboard
- [ ] 简洁设计，与现有 UI 风格一致
- [ ] Typecheck passes
- [ ] Verify in browser

### US-004: Stage 1 集成项目状态和过渡弹窗
**Description:** As a user, I want Stage 1 to show a transition modal after saving PRD so that I can smoothly proceed to Stage 2.

**Acceptance Criteria:**
- [ ] Stage 1 使用 `useProject` hook
- [ ] PRD 保存成功后创建/更新项目状态
- [ ] 显示 `StageTransitionModal` 而非直接跳转
- [ ] 移除 `setTimeout` 自动跳转逻辑
- [ ] 点击"继续"后更新项目 stage 并跳转 Stage 2
- [ ] Typecheck passes
- [ ] Verify in browser

### US-005: Stage 2 集成项目状态和过渡弹窗
**Description:** As a user, I want Stage 2 to show project context and transition modal so that the workflow feels connected.

**Acceptance Criteria:**
- [ ] Stage 2 使用 `useProject` hook
- [ ] 如果有活动项目，自动加载对应 PRD
- [ ] Header 显示项目名称和来源信息
- [ ] 转换完成并点击"开始开发"后显示过渡弹窗
- [ ] 点击"继续"后更新项目 stage 并跳转 Stage 3
- [ ] Typecheck passes
- [ ] Verify in browser

### US-006: Stage 3 集成项目状态和过渡弹窗
**Description:** As a user, I want Stage 3 to automatically transition to Stage 4 when all tasks are complete.

**Acceptance Criteria:**
- [ ] Stage 3 使用 `useProject` hook
- [ ] 所有任务完成时显示过渡弹窗
- [ ] 弹窗显示完成任务数量摘要
- [ ] 点击"继续"后更新项目 stage 并跳转 Stage 4
- [ ] Typecheck passes
- [ ] Verify in browser

### US-007: Stage 4 和 Stage 5 集成项目状态
**Description:** As a user, I want Stage 4 and 5 to integrate with project state for a complete workflow.

**Acceptance Criteria:**
- [ ] Stage 4 使用 `useProject` hook
- [ ] Stage 4 测试通过后显示过渡弹窗，跳转 Stage 5
- [ ] Stage 5 使用 `useProject` hook
- [ ] Stage 5 合并完成后更新项目状态为 completed
- [ ] 合并完成后显示完成弹窗，返回 Dashboard
- [ ] Typecheck passes
- [ ] Verify in browser

### US-008: Dashboard 项目卡片组件
**Description:** As a user, I want to see all my projects on the Dashboard with clear status indicators.

**Acceptance Criteria:**
- [ ] 创建 `viewer/src/components/ProjectCard.tsx`
- [ ] 卡片简洁显示：项目名、当前 Stage 图标、状态文字
- [ ] 悬浮时显示完整信息：进度、分支名、更新时间
- [ ] 不同状态显示不同操作按钮
- [ ] Stage 1-4 进行中：查看、删除
- [ ] Stage 5 待合并：查看、归档
- [ ] 已完成：查看、归档
- [ ] Typecheck passes
- [ ] Verify in browser

### US-009: Dashboard 集成项目列表
**Description:** As a user, I want the Dashboard to show all projects from ProjectContext.

**Acceptance Criteria:**
- [ ] Dashboard 使用 `useProject` hook 获取所有项目
- [ ] 替换现有的 `PrdSessionList` 为 `ProjectCard` 列表
- [ ] 活动项目（有 activeProjectId）显示在顶部突出位置
- [ ] 点击项目卡片"查看"按钮跳转到对应 Stage
- [ ] 归档和删除操作调用 ProjectContext 方法
- [ ] 保留现有的 TaskHistory 组件
- [ ] Typecheck passes
- [ ] Verify in browser

### US-010: 页面加载时自动恢复项目状态
**Description:** As a user, I want to automatically return to my last working stage after refreshing or reopening the browser.

**Acceptance Criteria:**
- [ ] `ProjectProvider` 加载时读取 localStorage
- [ ] 如果有 `activeProjectId`，获取该项目的 `currentStage`
- [ ] 在 Dashboard 或根路由判断：如果有活动项目，自动跳转到对应 Stage
- [ ] Stage 页面加载时验证项目状态有效性
- [ ] Typecheck passes
- [ ] Verify in browser

### US-011: 更新 CLAUDE.md 产品定位
**Description:** As a developer, I need the CLAUDE.md to document the Viewer's target audience and use case.

**Acceptance Criteria:**
- [ ] 在 CLAUDE.md 添加 "## BotoolAgent Viewer" 章节
- [ ] 说明目标用户：非开发者（业务员/工程师）
- [ ] 说明使用场景：用于开发自己的工具
- [ ] 说明与 CLI Skills 的关系
- [ ] Typecheck passes (no code changes, just docs)

### US-012: StageIndicator 增强显示
**Description:** As a user, I want the StageIndicator to show more context about current progress.

**Acceptance Criteria:**
- [ ] StageIndicator 新增 `projectName` 显示（已有，确认正常工作）
- [ ] 新增可选的 `stageStatus` prop 显示当前状态（如"已回答 3/5 问题"）
- [ ] 各 Stage 页面传入对应的状态文字
- [ ] Typecheck passes
- [ ] Verify in browser

## Functional Requirements

- FR-1: 项目状态必须在页面刷新后保持
- FR-2: 多个项目可以并行存在，但同一时间只有一个活动项目
- FR-3: Stage 过渡弹窗必须等待用户确认才能跳转
- FR-4: 项目卡片操作必须有确认提示（删除、归档）
- FR-5: 归档的项目不显示在主列表，可在历史中查看

## Non-Goals (Out of Scope)

- 不修改 Skills 的行为（保持现有逻辑）
- 不修改后端 API
- 不修改 Agent 执行逻辑
- 不添加项目搜索或过滤功能
- 不添加项目分组或标签功能

## Technical Considerations

- 使用 React Context 管理全局状态
- localStorage 用于持久化，key 为 `botool-projects`
- 与现有 `prd-session-storage.ts` 共存，不删除旧代码
- 项目 ID 使用 UUID 格式
- Stage 编号：1=PRD生成, 2=JSON转换, 3=开发, 4=测试, 5=Review

## Success Metrics

- 用户可以从 Dashboard 看到所有项目状态
- 每个 Stage 完成后有明确的完成提示
- 刷新页面后能自动恢复到上次工作位置
- 工作流从 Stage 1 到 Stage 5 无断点

## Open Questions

- 是否需要项目导出/导入功能？（暂不实现）
- 归档项目的保留时间？（暂不限制）
