# PRD: Stage 1 批量问答系统

## Introduction

改进 BotoolAgent Viewer 的 Stage 1 PRD 生成流程。将当前不稳定的"一问一答"模式改为"批量问答"模式：
- LLM 一次生成一组相关问题（2-4个）
- 用户批量回答后，根据答案生成下一组
- 支持进度保存，中途退出可继续
- 所有问题和选项使用中文

## Goals

- 提升 PRD 生成的用户体验
- 让用户能预见问题数量和进度
- 支持中途保存，提高完成率
- 确保中文化的一致性

## Dev Tasks

### DT-001: 更新 System Prompt 支持批量中文问题
**Description:** 修改 `/api/cli/chat/route.ts` 的 PRD_SYSTEM_PROMPT，让 Claude 一次生成一组中文问题。

**Acceptance Criteria:**
- [ ] 指示 Claude 使用 AskUserQuestion 的 questions 数组（支持多个问题）
- [ ] 每批 2-4 个相关问题，按主题分组
- [ ] 明确要求所有问题和选项使用中文
- [ ] 包含批次指示（"这是第 X 组问题"）
- [ ] Typecheck passes

### DT-002: 改进触发按钮显示问题数量
**Description:** 修改 ToolRenderer 组件的触发按钮，显示当前批次的问题数量和主题。

**Acceptance Criteria:**
- [ ] 按钮显示"请回答 X 个问题"
- [ ] 显示问题主题标签（如：基础信息、技术方案）
- [ ] 点击打开 Modal
- [ ] Typecheck passes
- [ ] Verify in browser

### DT-003: 改进 Modal 显示进度和编号
**Description:** 改进 AskUserQuestion Modal，添加问题编号和回答进度。

**Acceptance Criteria:**
- [ ] Modal 标题显示问题数量
- [ ] 每个问题显示编号（1、2、3...）
- [ ] 已回答的问题显示绿色勾选标记
- [ ] 底部显示"已回答 X/Y"进度
- [ ] Typecheck passes
- [ ] Verify in browser

### DT-004: 支持文本输入类型问题
**Description:** 扩展 OptionCard 组件，支持纯文本输入类型的问题（无预设选项）。

**Acceptance Criteria:**
- [ ] 当问题没有 options 时，显示文本输入框
- [ ] 支持单行和多行文本输入
- [ ] 输入框有占位符提示
- [ ] Typecheck passes
- [ ] Verify in browser

### DT-005: 实现问答进度保存
**Description:** 保存用户的回答进度，刷新页面或中途退出后可以继续。

**Acceptance Criteria:**
- [ ] 使用 localStorage 保存当前 PRD 会话的回答
- [ ] 回到 Stage 1 时检测是否有未完成的会话
- [ ] 提示用户"继续上次的回答"或"重新开始"
- [ ] Typecheck passes
- [ ] Verify in browser

### DT-006: 添加会话恢复对话框
**Description:** 创建对话框组件，让用户选择继续或重新开始。

**Acceptance Criteria:**
- [ ] 检测到未完成会话时显示对话框
- [ ] 显示上次的项目名称和进度
- [ ] 提供"继续"和"重新开始"按钮
- [ ] "重新开始"清除保存的进度
- [ ] Typecheck passes
- [ ] Verify in browser

## Functional Requirements

- FR-1: Claude 必须使用 AskUserQuestion 工具的 questions 数组一次传递 2-4 个问题
- FR-2: 所有问题文本、选项标签、描述都必须是中文
- FR-3: 用户回答保存在 localStorage，key 格式为 `prd-session-{timestamp}`
- FR-4: Modal 中清晰显示问题编号（1/3、2/3、3/3）和回答进度
- FR-5: 问题支持两种类型：选择题（有 options）和填空题（无 options）

## Non-Goals (Out of Scope)

- 预定义固定的问题列表（保持 LLM 动态生成）
- 服务端保存进度（只用 localStorage）
- 问题之间的跳转/跳过功能
- 多语言支持（只做中文）

## Technical Considerations

- AskUserQuestion 工具的 questions 数组已支持多个问题
- localStorage 存储格式：`{ projectIdea, answers: {}, currentBatch, timestamp }`
- 需要处理 localStorage 不可用的情况（隐私模式）

## Success Metrics

- Claude 稳定地一次生成 2-4 个中文问题
- 用户能看到问题总数和回答进度
- 刷新页面后能恢复之前的回答
- 完成 PRD 生成的用户完成率提升
