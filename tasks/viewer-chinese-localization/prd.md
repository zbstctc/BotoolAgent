# PRD: Viewer 前端中文本地化

## Introduction

将 BotoolAgent Viewer 前端界面的所有英文 UI 文本改成中文，让非技术用户能够更直观地使用系统。采用直接硬编码方式替换，不实现 i18n 国际化框架。专业术语（如 PRD、API、JSON 等）保留英文，但 Stage 名称改为"阶段 X"格式。

## Goals

- 所有 Stage 页面（1-5）的 UI 文本中文化
- 通用组件的 UI 文本中文化
- Toast/通知消息中文化
- Stage 名称改为"阶段 1"、"阶段 2"等形式
- 翻译风格简洁直接（如"提交"而非"请点击提交按钮"）

## 范围

**包含：**
- 按钮文本
- 标签和标题
- 提示信息和 Toast 通知
- 占位符（placeholder）
- 状态文本
- 空状态描述
- Stage 名称（改为"阶段 X"）

**排除：**
- 代码注释
- console.log 日志
- 后端 API 响应消息
- 专业术语（PRD、API、JSON 等）
- 文档和 README

## Dev Tasks

### DT-001: StageIndicator 组件本地化
**Description:** 将 StageIndicator 组件中的 Stage 名称和导航文本改成中文

**Files to modify:**
- `viewer/src/components/StageIndicator.tsx`

**Terms to translate:**
- "Dashboard" → "仪表板"
- "Stage 1" → "阶段 1"
- "Stage 2" → "阶段 2"
- "Stage 3" → "阶段 3"
- "Stage 4" → "阶段 4"
- "Stage 5" → "阶段 5"
- "Coding" → "代码开发"
- "Review" → "代码审查"
- "Coming Soon" → "即将推出"

**Acceptance Criteria:**
- [ ] 所有 Stage 名称显示为"阶段 X"格式
- [ ] 导航状态文本显示为中文
- [ ] Typecheck passes

---

### DT-002: Dashboard 首页本地化
**Description:** 将首页 page.tsx 中的英文词条改成中文

**Files to modify:**
- `viewer/src/app/page.tsx`

**Terms to translate:**
- "PRD Documents" → "PRD 文档"
- "+ New PRD" → "+ 新建 PRD"
- "No PRD documents yet" → "暂无 PRD 文档"
- "Create your first PRD..." → "创建你的第一个 PRD..."
- "No sessions yet" → "暂无会话记录"
- "Completed development sessions will appear here." → "已完成的开发会话将显示在这里。"
- "Execute" → "执行"
- PRD 状态：Draft→草稿, Ready→就绪, In Progress→进行中, Completed→已完成
- Session 状态：Completed→已完成, Failed→失败, Partial→部分完成
- "Development Tasks" → "开发任务"
- "Progress Log" → "进度日志"

**Acceptance Criteria:**
- [ ] 首页所有用户可见文字为中文
- [ ] 状态标签中文化
- [ ] 空状态提示中文化
- [ ] Typecheck passes

---

### DT-003: 阶段 1 页面本地化
**Description:** 检查并完善阶段 1 (PRD 编写) 页面的中文文本

**Files to modify:**
- `viewer/src/app/stage1/page.tsx`

**Acceptance Criteria:**
- [ ] 所有用户可见文本为中文
- [ ] Typecheck passes

---

### DT-004: 阶段 2 页面本地化
**Description:** 将阶段 2 (开发规划) 页面的文本改成中文

**Files to modify:**
- `viewer/src/app/stage2/page.tsx`

**Acceptance Criteria:**
- [ ] Pipeline 步骤名称为中文
- [ ] 状态提示为中文
- [ ] Typecheck passes

---

### DT-005: 阶段 3 页面本地化
**Description:** 将阶段 3 (自动开发) 页面的文本改成中文

**Files to modify:**
- `viewer/src/app/stage3/page.tsx`

**Terms to translate:**
- "Dev Tasks" → "开发任务"
- "Live" → "在线"
- "Disconnected" → "已断开"
- "Flowchart" → "流程图"
- "Progress Log" → "进度日志"
- "Changes" → "变更"
- "Commits" → "提交"
- "Acceptance Criteria:" → "验收标准："
- "No PRD loaded" → "未加载 PRD"
- "No changes detected" → "未检测到变更"
- "No commits found on this branch" → "此分支暂无提交"
- "Refresh" → "刷新"
- "Last update:" → "最后更新："

**Acceptance Criteria:**
- [ ] 所有标签页名称为中文
- [ ] 所有状态文本为中文
- [ ] 所有按钮文本为中文
- [ ] Typecheck passes

---

### DT-006: 阶段 4 页面本地化
**Description:** 将阶段 4 (测试验证) 页面的文本改成中文

**Files to modify:**
- `viewer/src/app/stage4/page.tsx`

**Acceptance Criteria:**
- [ ] 测试状态显示为中文
- [ ] 按钮和标签为中文
- [ ] Typecheck passes

---

### DT-007: 阶段 5 页面本地化
**Description:** 将阶段 5 (代码审查与合并) 页面的文本改成中文

**Files to modify:**
- `viewer/src/app/stage5/page.tsx`

**Terms to translate:**
- "Pull Request" → "拉取请求"
- "Code Changes" → "代码变更"
- "Completion Summary" → "完成总结"
- "Development Tasks" → "开发任务"
- "Progress Log" → "进度日志"
- "Open" → "打开"
- "Merged" → "已合并"
- "Completed" → "已完成"
- "Failed" → "失败"
- "Partial" → "部分完成"

**Acceptance Criteria:**
- [ ] 所有标签页名称为中文
- [ ] PR 状态显示为中文
- [ ] Typecheck passes

---

### DT-008: 通用组件本地化
**Description:** 将通用组件中的英文文本改成中文

**Files to modify:**
- `viewer/src/components/PRDPreview.tsx`
- `viewer/src/components/TaskEditor.tsx`
- `viewer/src/components/ChatInterface.tsx`
- `viewer/src/components/ChangeSummary.tsx`
- `viewer/src/components/CompletionSummary.tsx`
- `viewer/src/components/ManualChecklist.tsx`
- `viewer/src/components/TestResults.tsx`
- `viewer/src/components/ProjectCard.tsx`
- `viewer/src/components/NewPrdDialog.tsx`
- `viewer/src/components/TaskHistory.tsx`
- `viewer/src/components/StageTransitionModal.tsx`
- `viewer/src/components/SessionResumeDialog.tsx`

**Acceptance Criteria:**
- [ ] 所有对话框按钮为中文
- [ ] 所有表单标签为中文
- [ ] 所有状态文本为中文
- [ ] Typecheck passes

---

### DT-009: FlowChart 和 Pipeline 组件本地化
**Description:** 将流程图和 Pipeline 组件中的标签改成中文

**Files to modify:**
- `viewer/src/components/FlowChart/constants.ts`
- `viewer/src/components/FlowChart/FlowChart.tsx`
- `viewer/src/components/pipeline/PipelineProgress.tsx`

**Acceptance Criteria:**
- [ ] 流程图节点标签为中文
- [ ] Pipeline 步骤名称为中文
- [ ] Typecheck passes

---

### DT-010: Pyramid 组件本地化
**Description:** 将金字塔问答相关组件中的英文词条改成中文

**Files to modify:**
- `viewer/src/components/pyramid/PyramidNavigation.tsx`
- `viewer/src/components/pyramid/DimensionCard.tsx`
- `viewer/src/components/pyramid/QuestionItem.tsx`
- `viewer/src/components/pyramid/LevelPanel.tsx`

**Acceptance Criteria:**
- [ ] Pyramid 相关组件英文 UI 文本已替换为中文
- [ ] Typecheck passes

---

### DT-011: Toast 通知消息本地化
**Description:** 将各页面中的 toast 通知消息改成中文

**Files to modify:**
- 所有使用 toast 的页面和组件

**Acceptance Criteria:**
- [ ] 成功/失败/警告消息为中文
- [ ] Typecheck passes

---

### DT-012: 最终验证
**Description:** 运行 typecheck 和在浏览器中验证各页面显示正常

**Acceptance Criteria:**
- [ ] `npm run typecheck` 通过
- [ ] 在浏览器中打开各页面确认显示正确
- [ ] 无中文编码问题

## Functional Requirements

- FR-1: 所有用户界面文字必须显示中文（专业术语除外）
- FR-2: 翻译风格简洁直接（如"提交"、"下一步"而非"请点击提交按钮"）
- FR-3: 占位符（placeholder）也翻译成中文
- FR-4: 专业术语保留英文：PRD、API、JSON 等
- FR-5: Stage 名称改为"阶段 X"格式
- FR-6: Toast/通知消息中文化

## Non-Goals (Out of Scope)

- 后端 API 错误消息不改
- console.log 调试日志不改
- 项目文档和 README 不改
- 代码注释不改
- 不做 i18n 国际化框架，直接硬编码中文
- 不预留多语言切换能力

## Technical Considerations

- 直接在组件中替换硬编码字符串
- 保持现有代码结构不变
- 不引入额外的依赖库
- 确保中文字符在 UTF-8 编码下正确显示
- 注意字符串长度变化可能影响 UI 布局

## Success Metrics

- 所有阶段页面的用户可见文本 100% 中文化
- Typecheck 和 Lint 全部通过
- 无 UI 布局问题
