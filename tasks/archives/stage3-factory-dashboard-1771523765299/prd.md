# PRD: Stage 3 工厂看板改造

## Introduction

将 Stage 3（自动开发）页面从静态展示改造为实时数据驱动的代理监控面板。通过接入已有的 `useAgentStatus` hook 和 `.agent-status` SSE 数据流，让用户能够直观看到 BotoolAgent 的实时执行进度，包括当前步骤高亮、任务完成情况、保护机制状态等。面板采用"说人话"的设计理念，将技术指标转化为普通用户可理解的状态指示灯。

## Goals

- 让用户实时看到代理当前在执行哪个步骤（精确到 FlowChart 节点）
- 通过状态指示灯让用户快速了解系统健康状况（网络、API、进展）
- 提供启动/停止代理的控制能力，支持"暂停→换环境→恢复"场景
- Stage 3 全页面中文化，面向非技术用户

## Dev Tasks

### DT-001: Stage 3 接入 useAgentStatus + 三栏布局重构
**Description:** 在 Stage 3 页面中接入已有的 `useAgentStatus` hook，获取实时代理状态数据。同时将现有两栏布局改为三栏布局（左 240px 任务列表 | 中 flex-1 流程图+tab | 右 260px 数据面板）。

**Acceptance Criteria:**
- [ ] Stage 3 页面通过 `useAgentStatus({ stream: true })` 获取实时数据
- [ ] 页面布局变为三栏，中间区域保持上下分割（流程图 + tab）
- [ ] 三栏在 >=1024px 屏幕上正常显示，不拥挤
- [ ] Typecheck passes
- [ ] 在浏览器中验证布局正确

### DT-002: 创建 AgentDataPanel 组件（迭代进度 + 任务完成率）
**Description:** 创建新组件 `src/components/AgentDataPanel/AgentDataPanel.tsx`，展示迭代进度条和任务完成率进度条。接收 `AgentStatus` 数据作为 props。

**Acceptance Criteria:**
- [ ] 组件接收 agentStatus props，展示迭代进度（如 5/10）和任务完成率（如 6/7）
- [ ] 进度条使用 Tailwind CSS，数值变化时有平滑过渡动画（transition）
- [ ] 显示当前任务 ID 和执行状态（如"DT-006 · 执行中 · 第1次尝试"）
- [ ] agent 未运行时显示 idle 状态
- [ ] Typecheck passes
- [ ] 在浏览器中验证

### DT-003: AgentDataPanel 状态指示灯（"说人话"版保护机制）
**Description:** 在 AgentDataPanel 中添加状态指示灯区域，将技术指标转化为绿/黄/红指示灯 + 一句话说明。

**状态映射规则：**
- 网络状态：`status=waiting_network` → 红灯"网络断开，等待恢复" | 其他 → 绿灯"网络正常"
- API 调用：`rateLimit.calls/maxCalls > 80%` → 黄灯"API 接近限额" | `apiRateLimit.waiting=true` → 红灯"API 限流中，等待 X 秒" | 其他 → 绿灯"API 调用正常"
- 连续进展：`circuitBreaker.noProgressCount >= 2` → 红灯"危险: 连续 N 次无进展" | `= 1` → 黄灯"注意: 1次无进展" | `= 0` → 绿灯"连续有进展"
- 重试状态：`retryCount > 0` → 黄灯"第 N 次重试中" | `= 0` → 不显示

**Acceptance Criteria:**
- [ ] 每个指示灯由彩色圆点 + 一句中文说明组成
- [ ] 颜色和文案根据上述映射规则正确切换
- [ ] 绿灯、黄灯、红灯视觉区分清晰
- [ ] Typecheck passes
- [ ] 在浏览器中验证

### DT-004: FlowChart 精确步骤高亮（接入 agent status）
**Description:** 改造 FlowChart 组件的 `getStepStatus` 函数，从粗略的 idle/running/done 三态改为根据 `agentStatus.status` 精确高亮到对应节点。

**状态映射：**
- `idle` → 所有节点 pending
- `running` → 高亮"启动 Claude 实例"和"Claude 执行任务"
- `waiting_network` → 高亮"检查 Rate Limit & 网络"
- `timeout` / `error` → 高亮"结果处理"（橙色闪烁表示重试）
- `iteration_complete` → 高亮"双条件退出验证"
- `complete` → 所有节点 completed

**Acceptance Criteria:**
- [ ] FlowChart 接收完整的 agentStatus 对象（不仅是 agentPhase）
- [ ] 节点高亮精确匹配上述映射规则
- [ ] 当前步骤有蓝色脉冲动画，已完成步骤显示绿色 ✓
- [ ] 错误/重试状态节点有橙色闪烁效果
- [ ] Typecheck passes
- [ ] 在浏览器中验证

### DT-005: FlowChart 连线虚线流动动画
**Description:** 当代理运行时，FlowChart 的连线（edges）添加 CSS 虚线流动动画，表示数据/流程在流动。代理停止时动画停止。

**Acceptance Criteria:**
- [ ] agent running 时，已通过的连线显示虚线流动动画（stroke-dashoffset animation）
- [ ] agent idle/complete 时，连线为静态实线
- [ ] 动画方向与流程方向一致（从源到目标）
- [ ] 性能良好，无卡顿（纯 CSS animation，不用 JS）
- [ ] Typecheck passes
- [ ] 在浏览器中验证

### DT-006: 左侧任务列表轻度改造
**Description:** 对现有任务列表做轻度改造：当前任务高亮（蓝色呼吸动画边框）、自动展开当前任务详情、状态标签中文化。

**Acceptance Criteria:**
- [ ] 当前执行的任务卡片有蓝色呼吸动画（CSS animation on border/shadow）
- [ ] 当 currentTaskId 变化时，自动展开对应任务的详情
- [ ] 状态标签中文化：Completed → 已完成, In Progress → 执行中, Pending → 等待中
- [ ] 底部统计文案中文化：如"6/7 完成 · 迭代 #5"
- [ ] Typecheck passes
- [ ] 在浏览器中验证

### DT-007: 启动/停止代理按钮 + Stage 3 全面中文化
**Description:** 在 Stage 3 页面顶部区域添加启动/停止代理按钮。同时将页面内所有英文标签改为中文。

**Acceptance Criteria:**
- [ ] 顶部有"启动代理"按钮（调用 POST /api/agent/start），running 状态时变为"停止代理"（调用 DELETE /api/agent/status）
- [ ] 启动时可设置最大迭代次数（默认 10）
- [ ] 按钮有 loading 状态和确认提示（停止时二次确认）
- [ ] Tab 标签中文化：Flowchart → 流程图, Progress Log → 进度日志, Changes → 文件变更, Commits → 提交记录
- [ ] 右侧面板标题、左侧面板标题等所有英文均中文化
- [ ] Typecheck passes
- [ ] 在浏览器中验证

## Functional Requirements

- FR-1: 页面通过 SSE 流实时接收 agent-status 更新（500ms 间隔）
- FR-2: FlowChart 节点根据 agent status 精确高亮当前步骤
- FR-3: 运行状态面板以绿/黄/红指示灯展示系统健康状况
- FR-4: 用户可通过页面按钮启动和停止代理
- FR-5: 所有状态变化有视觉过渡动画（transition/animation）
- FR-6: Stage 3 页面内所有文案为中文

## Risks & Mitigations

### MEDIUM
- **FlowChart 状态映射复杂度**: agent-status 有 8+ 种状态，映射到 10 个节点需要仔细设计 → **缓解措施**: DT-004 中明确列出完整映射表，逐一实现和验证
- **三栏布局空间不足**: 在 1024-1280px 屏幕上三栏可能拥挤 → **缓解措施**: 右侧面板设置 min-width，必要时可折叠

### LOW
- **CSS 动画性能**: 多个同时运行的 CSS animation → **缓解措施**: 仅使用 transform 和 opacity 属性，避免 layout 触发
- **SSE 连接稳定性**: 长时间运行可能断连 → **缓解措施**: useAgentStatus hook 已有自动重连机制

## Testing Strategy

### Unit Tests（单元测试）
- AgentDataPanel 状态指示灯映射逻辑（给定不同 agentStatus 输入，验证输出颜色和文案）
- FlowChart getStepStatus 映射函数（给定不同 status 值，验证节点状态）

### Integration Tests（集成测试）
- Stage 3 页面正确接入 useAgentStatus 并传递数据到子组件
- 启动/停止按钮正确调用 API

### E2E Tests（端到端测试）
- 打开 Stage 3 页面，验证三栏布局正确渲染
- 模拟不同 agent-status，验证 FlowChart 高亮和状态面板更新

## Non-Goals (Out of Scope)

- 深色主题 / 暗色背景
- 历史迭代回放功能
- 移动端/小屏幕适配
- 浏览器推送通知 / 声音提示
- 其他 Stage 页面的中文化
- 后端 API 修改
- 新增 npm 依赖

## Technical Considerations

- `useAgentStatus` hook 已存在于 `src/hooks/useAgentStatus.ts`，支持 SSE 流式更新
- Agent status API (`/api/agent/status?stream=true`) 已支持 SSE，500ms 轮询
- 启动 API (`POST /api/agent/start`) 和停止 API (`DELETE /api/agent/status`) 已存在
- FlowChart 使用 @xyflow/react，节点高亮通过 `status` prop 控制
- 所有动画使用纯 CSS（Tailwind + CSS animation），不引入 framer-motion

## Success Metrics

- 用户能在 Stage 3 页面实时看到代理执行到哪一步
- 状态指示灯能正确反映系统健康状况（无技术术语）
- 启动/停止按钮可正常控制代理

## Open Questions

- 无（需求已在对话中充分确认）
