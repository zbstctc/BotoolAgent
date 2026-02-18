# PRD: Stage 2 规范检查功能改造

## Introduction

将 Stage 2 规范检查步骤从 mock 数据改为真实的规范选择和 CLI 适配流程。用户从 Dashboard 规范文档系统中选择规范，点击确认后，CLI 自动按规范适配 PRD，无需逐项确认。

## Goals

- 集成 Dashboard 规范文档系统，展示所有可选规范
- 用户可以通过分类浏览和勾选规范
- 点击确认后，CLI 自动按选中规范适配 PRD
- 使用 SSE 流式传输展示适配进度
- 适配完成后显示确认弹窗

## 架构概述

```
规范选择界面 → 用户勾选规范 → 点击确认
      ↓
/api/cli/chat → CLI → 规范适配 Prompt
      ↓
SSE 流式传输进度 → 适配完成弹窗 → 下一步
```

---

## Dev Tasks

### DT-001: 改造 RuleCheckStep 为规范选择界面

**Description:** 重写 RuleCheckStep 组件，从规范检查改为规范选择。加载 Dashboard 规范文档，按分类展示为可折叠卡片。

**Acceptance Criteria:**
- [ ] 调用 /api/rules GET 获取所有规范
- [ ] 按分类（frontend, backend, testing 等）分组展示
- [ ] 每个分类显示为可折叠的垂直卡片
- [ ] 支持全选/分类全选/单个勾选
- [ ] 显示已选规范数量统计
- [ ] Typecheck passes
- [ ] Verify in browser

---

### DT-002: 实现 CLI 规范适配逻辑

**Description:** 用户点击确认后，调用 CLI 按选中的规范适配 PRD。使用 SSE 流式传输显示适配进度。

**Acceptance Criteria:**
- [ ] 点击确认按钮后调用 /api/cli/chat
- [ ] 发送包含选中规范和 PRD 内容的 prompt
- [ ] 使用 SSE 流式传输接收适配进度
- [ ] 显示进度条（根据 SSE 事件更新）
- [ ] 适配过程中禁用确认按钮
- [ ] Typecheck passes

---

### DT-003: 实现适配完成确认弹窗

**Description:** CLI 适配完成后，显示确认弹窗，展示适配结果摘要。

**Acceptance Criteria:**
- [ ] 适配完成后弹出确认弹窗
- [ ] 显示已应用的规范列表
- [ ] 显示 PRD 修改摘要（如有）
- [ ] 点击确认进入下一步
- [ ] Typecheck passes
- [ ] Verify in browser

---

### DT-004: 改造 CodeExampleStep 为 CLI 集成

**Description:** 将 CodeExampleStep 从 mock 数据改为 CLI 集成，自动生成代码示例。

**Acceptance Criteria:**
- [ ] 调用 CLI 生成代码示例
- [ ] SSE 流式传输显示生成进度
- [ ] 展示生成的代码示例列表
- [ ] 支持用户编辑/采纳/跳过
- [ ] Typecheck passes
- [ ] Verify in browser

---

### DT-005: 改造 TestCaseStep 为 CLI 集成

**Description:** 将 TestCaseStep 从 mock 数据改为 CLI 集成，自动生成测试用例。

**Acceptance Criteria:**
- [ ] 调用 CLI 生成测试用例
- [ ] SSE 流式传输显示生成进度
- [ ] 分类展示单元测试和 E2E 测试
- [ ] 支持用户编辑/采纳/跳过
- [ ] Typecheck passes
- [ ] Verify in browser

---

### DT-006: 改造 JsonConvertStep 为 CLI 集成

**Description:** 将 JsonConvertStep 从 mock 数据改为 CLI 集成，自动转换 PRD 为 JSON。

**Acceptance Criteria:**
- [ ] 调用 CLI 将 PRD 转换为 prd.json 格式
- [ ] SSE 流式传输显示转换进度
- [ ] 展示 JSON 编辑器
- [ ] 支持保存到项目根目录
- [ ] Typecheck passes
- [ ] Verify in browser

---

### DT-007: 端到端测试

**Description:** 测试完整的 Stage 2 流程。

**Acceptance Criteria:**
- [ ] 规范选择正确加载和展示
- [ ] CLI 适配流程正常工作
- [ ] 代码示例生成正常
- [ ] 测试用例生成正常
- [ ] JSON 转换和保存正常
- [ ] Verify in browser

---

## Functional Requirements

- FR-1: 规范选择界面必须展示 Dashboard 中所有规范文档
- FR-2: 规范按 6 个分类（frontend, backend, testing, deployment, application, other）分组
- FR-3: 用户点击确认后，系统自动适配 PRD，无需逐项确认
- FR-4: CLI 适配过程使用 SSE 流式传输，实时展示进度
- FR-5: 适配完成后显示确认弹窗

## Non-Goals (Out of Scope)

- 不支持用户在此步骤编辑规范内容
- 不支持规范优先级排序
- 不支持规范冲突检测

## Technical Considerations

- 复用 /api/rules GET API 获取规范列表
- 复用 useCliChat hook 处理 CLI 通信
- 规范内容作为 context 传递给 CLI

## Success Metrics

- Stage 2 全流程可在 CLI 模式下完成
- 规范选择界面正确展示所有规范
- 适配进度实时显示
