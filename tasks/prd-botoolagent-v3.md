# PRD: BotoolAgent v3.0 - 完整开发流程

## Introduction

本次升级将 BotoolAgent 从一个基础的自主开发代理升级为完整的开发流程管理系统。包括：
1. CLI 工具交互渲染（AskUserQuestion）
2. Stage 4 测试阶段
3. Stage 5 Review 和合并阶段
4. Ralph 高级功能（Rate Limiting、Circuit Breaker 等）
5. 配置文件系统（.botoolagentrc）

## Goals

- 让 Stage 1 对话中的 AskUserQuestion 工具能正确渲染和交互
- 实现完整的测试阶段（Stage 4），支持多种测试类型
- 实现 Review 阶段（Stage 5），包括 PR 创建和合并流程
- 增强 BotoolAgent.sh 的健壮性和可配置性
- 在 Dashboard 显示完整的任务历史和状态

## Dev Tasks

### DT-001: CLI 输出解析器 - 工具调用识别
**Description:** 作为开发者，我需要解析 CLI 的 stream-json 输出，识别工具调用消息。

**Acceptance Criteria:**
- 修改 `viewer/src/lib/cli-manager.ts` 添加工具调用解析
- 识别 `tool_use` 类型消息并提取工具名称和参数
- 特别处理 `AskUserQuestion` 工具
- 发出 `tool_use` 事件供前端处理
- Typecheck passes

### DT-002: AskUserQuestion 前端组件
**Description:** 作为用户，我希望在 Stage 1 对话中看到可交互的问题选项。

**Acceptance Criteria:**
- 创建 `viewer/src/components/ToolRenderer.tsx` 组件
- 渲染 AskUserQuestion 的问题和选项
- 支持单选和多选模式
- 点击选项后发送答案回 CLI
- 选项使用卡片样式，有 hover 效果
- Typecheck passes
- Verify in browser

### DT-003: useCliChat Hook 支持工具交互
**Description:** 作为开发者，我需要 useCliChat 支持工具调用的双向通信。

**Acceptance Criteria:**
- 修改 `viewer/src/hooks/useCliChat.ts`
- 添加 `pendingToolUse` 状态
- 添加 `respondToTool(toolId, response)` 方法
- 工具响应通过 CLI stdin 发送
- Typecheck passes

### DT-004: Stage 1 集成工具渲染
**Description:** 作为用户，我希望 Stage 1 页面能正确显示和处理工具调用。

**Acceptance Criteria:**
- 修改 Stage 1 页面集成 ToolRenderer
- AskUserQuestion 显示为可交互选项
- 选择后自动继续对话
- 处理多个连续的工具调用
- Typecheck passes
- Verify in browser

### DT-005: Stage 4 测试 API 端点
**Description:** 作为开发者，我需要 API 端点来运行测试套件。

**Acceptance Criteria:**
- 创建 `/api/test/run/route.ts` API 端点
- 自动检测项目的测试命令（从 package.json）
- 支持运行：typecheck、unit test、integration test、e2e test
- 返回 SSE 流式输出测试结果
- 返回测试通过/失败统计
- Typecheck passes

### DT-006: Stage 4 测试结果组件
**Description:** 作为用户，我希望看到清晰的测试结果展示。

**Acceptance Criteria:**
- 创建 `viewer/src/components/TestResults.tsx` 组件
- 显示测试类型和状态（通过/失败/跳过）
- 显示通过/失败数量统计
- 失败测试可展开查看详细错误
- 显示测试覆盖率（如有）
- Typecheck passes
- Verify in browser

### DT-007: Stage 4 手动验证清单
**Description:** 作为用户，我希望有一个手动验证清单来确认 UI 功能。

**Acceptance Criteria:**
- 创建 `viewer/src/components/ManualChecklist.tsx` 组件
- 从 prd.json 提取带有"Verify in browser"的任务
- 显示为可勾选的清单
- 保存勾选状态
- 全部勾选后显示"验证完成"
- Typecheck passes
- Verify in browser

### DT-008: Stage 4 页面整合
**Description:** 作为用户，我希望 Stage 4 页面整合所有测试功能。

**Acceptance Criteria:**
- 创建 `viewer/src/app/stage4/page.tsx`
- 集成测试运行、结果显示、手动验证
- "运行测试"按钮启动所有测试
- 测试全部通过且手动验证完成后，启用"进入 Review"按钮
- 更新 StageIndicator 启用 Stage 4
- Typecheck passes
- Verify in browser

### DT-009: Stage 5 Git 变更 API
**Description:** 作为开发者，我需要 API 获取分支的所有代码变更。

**Acceptance Criteria:**
- 创建 `/api/git/diff/route.ts` API 端点
- 返回与 main 分支的所有文件差异
- 包含每个文件的增删行数
- 支持获取具体文件的 diff 内容
- Typecheck passes

### DT-010: Stage 5 变更展示组件
**Description:** 作为用户，我希望看到所有代码变更的概览。

**Acceptance Criteria:**
- 创建 `viewer/src/components/ChangeSummary.tsx` 组件
- 显示修改文件列表，每个文件显示 +xx -xx 行
- 点击文件可展开查看 diff
- diff 使用语法高亮（绿色增加，红色删除）
- Typecheck passes
- Verify in browser

### DT-011: Stage 5 完成总结组件
**Description:** 作为用户，我希望看到任务完成的总结。

**Acceptance Criteria:**
- 创建 `viewer/src/components/CompletionSummary.tsx` 组件
- 从 progress.txt 提取完成的任务列表
- 显示每个任务的标题和简要描述
- 显示"经验教训"部分的问题和解决方案
- Typecheck passes
- Verify in browser

### DT-012: Stage 5 PR 创建 API
**Description:** 作为开发者，我需要 API 来创建 GitHub PR。

**Acceptance Criteria:**
- 创建 `/api/git/pr/route.ts` API 端点
- POST 创建 PR，自动生成标题和描述
- 描述包含完成的任务列表
- 返回 PR URL
- GET 获取 PR 状态
- Typecheck passes

### DT-013: Stage 5 合并 API
**Description:** 作为开发者，我需要 API 来合并 PR 到 main。

**Acceptance Criteria:**
- 创建 `/api/git/merge/route.ts` API 端点
- POST 执行合并操作
- 合并后删除功能分支
- 返回合并结果
- Typecheck passes

### DT-014: Stage 5 页面整合
**Description:** 作为用户，我希望 Stage 5 页面提供完整的 Review 流程。

**Acceptance Criteria:**
- 创建 `viewer/src/app/stage5/page.tsx`
- 集成变更展示、完成总结、PR 信息
- 进入页面时自动创建 PR
- 显示 PR 链接
- "合并到 main"按钮执行合并
- 合并成功后显示完成状态
- 更新 StageIndicator 启用 Stage 5
- Typecheck passes
- Verify in browser

### DT-015: Dashboard 任务历史状态
**Description:** 作为用户，我希望在 Dashboard 看到所有任务的完整状态。

**Acceptance Criteria:**
- 修改 Dashboard 页面显示任务历史
- 每个任务显示：名称、阶段、进度、时间
- 未合并的任务有明显"待合并"标识
- 显示时间线视图
- 提供"继续"/"合并"/"删除"操作按钮
- Typecheck passes
- Verify in browser

### DT-016: 任务状态持久化
**Description:** 作为开发者，我需要持久化存储任务状态。

**Acceptance Criteria:**
- 创建 `tasks/.task-history.json` 存储任务历史
- 记录每个任务的阶段、进度、时间、合并状态
- 创建 API 端点读写任务历史
- 任务状态变化时自动更新
- Typecheck passes

### DT-017: BotoolAgent.sh - Rate Limiting
**Description:** 作为开发者，我需要限制 API 调用频率防止超限。

**Acceptance Criteria:**
- 添加调用计数器和时间窗口
- 默认每小时最多 100 次调用
- 超过限制时自动等待
- 从 .botoolagentrc 读取配置
- 显示限制状态
- Typecheck passes (for any TypeScript parts)

### DT-018: BotoolAgent.sh - Circuit Breaker
**Description:** 作为开发者，我需要在无进展时自动停止。

**Acceptance Criteria:**
- 跟踪每次迭代后的任务完成数
- 连续 3 次迭代无进展（无新任务完成）时停止
- 停止时更新状态文件
- 从 .botoolagentrc 读取阈值配置
- 显示警告信息

### DT-019: BotoolAgent.sh - 双条件退出验证
**Description:** 作为开发者，我需要更可靠的完成检测。

**Acceptance Criteria:**
- 检测 Claude 输出中的 `<promise>COMPLETE</promise>`
- 同时验证 prd.json 中所有任务 passes: true
- 两个条件都满足才退出
- 只满足一个条件时记录警告

### DT-020: BotoolAgent.sh - API 限制处理
**Description:** 作为开发者，我需要处理 5 小时 API 限制。

**Acceptance Criteria:**
- 检测 API 限制错误响应
- 解析限制解除时间
- 显示倒计时
- 自动等待并重试
- 更新状态为 "waiting_rate_limit"

### DT-021: BotoolAgent.sh - 响应分析器
**Description:** 作为开发者，我需要语义分析 Claude 输出判断任务完成。

**Acceptance Criteria:**
- 分析 Claude 输出文本
- 检测是否有实际的代码修改
- 检测是否有 git commit
- 避免误判（如"我会做X"但没实际做）
- 记录分析结果到日志

### DT-022: .botoolagentrc 配置文件支持
**Description:** 作为用户，我希望通过配置文件自定义 BotoolAgent 行为。

**Acceptance Criteria:**
- 创建 `.botoolagentrc.example` 示例文件
- BotoolAgent.sh 启动时读取 .botoolagentrc
- 支持所有配置项（见设计文档）
- 配置文件不存在时使用默认值
- 支持环境变量覆盖

### DT-023: .botoolagentrc Hooks 支持
**Description:** 作为用户，我希望在关键节点执行自定义脚本。

**Acceptance Criteria:**
- 支持 preIteration hook
- 支持 postIteration hook
- 支持 onComplete hook
- 支持 onError hook
- Hook 脚本路径从 .botoolagentrc 读取
- Hook 执行失败不影响主流程

### DT-024: 完成通知功能
**Description:** 作为用户，我希望任务完成或出错时收到通知。

**Acceptance Criteria:**
- 支持 macOS 系统通知
- 通知内容包含任务名和状态
- 可在 .botoolagentrc 中启用/禁用
- 支持完成通知和错误通知

## Functional Requirements

- FR-1: CLI 工具调用必须能被前端正确解析和渲染
- FR-2: AskUserQuestion 必须支持用户交互并将答案发送回 CLI
- FR-3: Stage 4 必须能运行所有配置的测试并显示结果
- FR-4: Stage 5 必须能创建 PR 并执行合并
- FR-5: Dashboard 必须显示所有任务的当前状态和历史
- FR-6: BotoolAgent.sh 必须支持从 .botoolagentrc 读取配置
- FR-7: Rate Limiting 必须防止 API 超限
- FR-8: Circuit Breaker 必须在无进展时自动停止

## Non-Goals (Out of Scope)

- 不实现 Edit/Write/Bash 等其他工具的前端渲染（仅 AskUserQuestion）
- 不实现跨项目的任务管理
- 不实现团队协作功能
- 不实现 CI/CD 集成

## Technical Considerations

- CLI 输出格式为 stream-json，每行一个 JSON 对象
- 工具调用通过 stdin 发送响应
- PR 创建使用 `gh` CLI 工具
- 配置文件使用 JSON 格式
- macOS 通知使用 `osascript`

## Success Metrics

- Stage 1 对话中 AskUserQuestion 能正常工作
- Stage 4/5 功能完整可用
- Dashboard 能显示所有任务状态
- BotoolAgent.sh 更加健壮，减少卡死情况

## Open Questions

- 是否需要支持 Linux 系统通知？
- 是否需要 Slack/Discord 等远程通知？
- E2E 测试是否默认跳过（耗时较长）？
