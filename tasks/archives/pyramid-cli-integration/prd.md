# PRD: 金字塔问答 CLI Skill 集成

## Introduction

将金字塔问答流程从"前端控制 + API 生成问题"模式，改为"CLI Skill 控制 + 前端纯展示"模式。让 Claude 通过 Skill 完全控制问答流程，前端只负责渲染问题和显示进度。

## Goals

- Skill 控制整个金字塔问答流程（L1→L2→L3→L4）
- 前端只做展示，不控制问什么问题、问多少个
- 保持金字塔结构的可视化进度
- 基于 CLI + SSE，复用现有 `/api/cli/chat` 和 `useCliChat`

## 架构概述

```
前端 → /api/cli/chat → CLI → Skill (pyramidprd)
  ↑                              ↓
  │                        AskUserQuestion (tool_use)
  │                              ↓
  └─── /api/cli/respond ←── 用户回答
```

**核心改变：**
- Skill 从 `user-invocable: false` 改为 `true`
- Skill 使用 AskUserQuestion 工具提问
- 前端监听 tool_use 事件，渲染问题
- 前端从问题 metadata 中读取 level，更新进度条

---

## Dev Tasks

### DT-001: 改造 Skill 为可触发模式

**Description:** 修改 `~/.claude/skills/botoolagent-pyramidprd/SKILL.md`，改为 user-invocable，重写问答流程逻辑。

**Acceptance Criteria:**
- [ ] `user-invocable: true`
- [ ] Skill 定义完整的 L1-L4 问答流程
- [ ] 使用 AskUserQuestion 工具提问
- [ ] 每个问题带 metadata: `{ level, progress, dimension }`
- [ ] 根据答案动态调整后续问题
- [ ] L4 完成后生成 PRD 文档
- [ ] Skill 文件语法正确，可被 CLI 加载

---

### DT-002: 扩展 AskUserQuestion metadata 支持

**Description:** 确认 AskUserQuestion 工具的 metadata 字段可以传递 level 等信息，前端能正确接收。

**Acceptance Criteria:**
- [ ] 确认 AskUserQuestion 支持 metadata 字段
- [ ] 测试 CLI 发送带 metadata 的 tool_use
- [ ] 前端能从 SSE 事件中解析 metadata
- [ ] Typecheck passes

---

### DT-003: 创建 Stage 1 CLI 聊天模式页面

**Description:** 重写 `/stage1/page.tsx`，改为 CLI 聊天模式，监听 tool_use 事件渲染问题。

**Acceptance Criteria:**
- [ ] 使用 `useCliChat` hook 连接 CLI
- [ ] 初始发送 `/botoolagent-pyramidprd {description}` 触发 Skill
- [ ] 监听 tool_use 事件，识别 AskUserQuestion
- [ ] 渲染问题 UI（复用现有组件或新建）
- [ ] 从 metadata.level 更新金字塔进度条
- [ ] 用户回答后调用 `respondToTool` 发送答案
- [ ] 收到 PRD 文本后显示在预览区
- [ ] Typecheck passes
- [ ] 在浏览器中验证完整流程

---

### DT-004: 金字塔进度条组件适配

**Description:** 修改 `PyramidNavigation` 组件，支持从 CLI 事件更新进度。

**Acceptance Criteria:**
- [ ] 接收 currentLevel prop 从 CLI 事件更新
- [ ] 显示当前层级和已完成层级
- [ ] 不再控制层级切换（只读展示）
- [ ] Typecheck passes

---

### DT-005: 问题渲染组件适配

**Description:** 确保问题渲染组件能处理 AskUserQuestion 返回的问题格式。

**Acceptance Criteria:**
- [ ] 支持 single/multi/text 问题类型
- [ ] 支持 options 选项渲染
- [ ] 支持批量问题（questions 数组）
- [ ] 收集答案并返回给父组件
- [ ] Typecheck passes

---

### DT-006: 清理旧的 API 和逻辑

**Description:** 移除不再需要的旧代码。

**Acceptance Criteria:**
- [ ] 移除或标记废弃 `/api/pyramid/questions`
- [ ] 移除 `skill-parser.ts` 的调用（Skill 内部处理）
- [ ] 移除旧的 `generateQuestions` 函数
- [ ] 清理无用的 state 和 effects
- [ ] Typecheck passes

---

### DT-007: 全流程测试

**Description:** 测试完整的金字塔问答流程。

**Acceptance Criteria:**
- [ ] 输入需求描述，触发 Skill
- [ ] L1 问题正确显示，进度条显示 L1
- [ ] 回答 L1 后进入 L2，进度条更新
- [ ] L2-L4 流程正常
- [ ] L4 完成后 PRD 正确生成
- [ ] PRD 可以保存
- [ ] 在浏览器中验证

---

### DT-008: Playwright 自动化测试

**Description:** 运行 Playwright 测试验证 Stage 1。

**Acceptance Criteria:**
- [ ] Playwright 测试 Stage 1 页面通过

---

## Functional Requirements

- FR-1: 用户在 Stage 1 输入需求描述后，系统通过 CLI 触发 pyramidprd Skill
- FR-2: Skill 控制问答流程，按 L1→L2→L3→L4 顺序提问
- FR-3: 前端实时显示当前层级进度
- FR-4: Skill 根据用户回答动态调整后续问题
- FR-5: L4 完成后，Skill 生成完整 PRD
- FR-6: 前端显示 PRD 预览，支持保存

## Non-Goals (Out of Scope)

- 不支持用户手动跳转层级（Skill 控制）
- 不支持返回修改之前层级的答案（本版本）
- 不修改 PRD 输出格式
- 不修改 `/api/cli/chat` 核心逻辑

## Technical Considerations

- 复用 `useCliChat` hook 处理 CLI 通信
- 复用 `/api/cli/chat` 和 `/api/cli/respond` API
- AskUserQuestion metadata 需要 CLI 支持传递
- Skill 文件格式需符合 Claude Code 规范

## Success Metrics

- 完整 L1-L4 流程可以在 CLI 模式下完成
- 前端正确显示进度和问题
- PRD 质量与原 generateprd Skill 一致
- Playwright 测试通过

## Open Questions

- [ ] AskUserQuestion 的 metadata 字段是否已支持？需要测试确认
- [ ] 是否需要支持"返回上一层修改"功能？（建议 v2 实现）
