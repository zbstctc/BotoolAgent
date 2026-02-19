# PRD: PRD 生成系统增强 — 代码库感知 + 确认门控 + 风险评估

## Introduction

借鉴 Everything Claude Code (ECC) 获奖项目的 `/plan` 命令设计，对 BotoolAgent 的两个 PRD 生成 Skill 进行增强：

**两个 Skill 的定位：**
- **pyramidprd** — 给 BotoolAgent Viewer 用户（非技术人员），通过 Viewer Web UI 交互
- **generateprd** — 给开发者自己在 CLI 中快速使用，纯 CLI 交互，无 Viewer 依赖

**三项增强：**

1. **代码库感知扫描** — 在已有项目场景下，自动分析项目代码库（技术栈+架构+业务逻辑），使后续问题更精准，避免与现有架构冲突
2. **确认门控** — PRD 生成前，展示需求摘要 + 风险评估 + 复杂度估计，用户确认后再生成 PRD
3. **PRD 模板增强** — 在 Dev Tasks 之后新增风险评估和测试策略章节

pyramidprd 改动保持 CLI 交互模式（Skill 驱动），Viewer 仅负责渲染。
generateprd 改动为纯 CLI 模式，去掉 Viewer 相关指令。

## Goals

- 让两个 PRD Skill 在已有项目上生成的 PRD 更贴合实际代码库，减少返工
- 在 PRD 生成前给用户一次完整确认机会，避免方向偏差
- PRD 文档中包含风险和测试策略，为后续开发提供更完整的指引
- 明确两个 Skill 的定位分离：pyramidprd 服务 Viewer 用户，generateprd 服务 CLI 开发者

## Dev Tasks

### DT-001: SKILL.md — 增加代码库感知扫描指令

**Description:** 在 pyramidprd SKILL.md 中，L1 完成后、L2 开始前，新增一个"代码库扫描"阶段。指导 Claude 使用 Glob、Grep、Read 工具扫描当前项目，识别技术栈、架构模式、现有组件、业务模型和 API 接口。扫描结果不直接展示给用户，而是内化为更精准的 L2/L3 问题。

**核心改动：**
- 在 SKILL.md 的 Phase 2（L1 完成后）和 Phase 3（L2 开始前）之间插入扫描指令
- 定义扫描范围：package.json / tsconfig / 目录结构 / 路由文件 / 数据模型 / API 端点
- 指导 Claude 将扫描发现转化为 L2 问题的上下文（如：检测到用 Supabase → L2 问题预设数据库选项）
- 当检测不到代码库（新项目）时，跳过扫描正常进入 L2
- 在 AskUserQuestion 的 metadata 中增加 `codebaseScanned: true/false` 标记

**Acceptance Criteria:**
- [ ] SKILL.md 中有明确的代码库扫描阶段指令
- [ ] 扫描指令覆盖：技术栈检测、目录结构分析、现有组件/路由/API 识别、数据模型分析
- [ ] 有「无代码库」场景的降级处理（跳过扫描）
- [ ] 扫描结果体现在 L2/L3 问题的选项中（如现有技术栈作为预设选项）
- [ ] metadata 中标记扫描状态
- [ ] Typecheck passes

### DT-002: SKILL.md — 增加确认门控流程

**Description:** 在 pyramidprd SKILL.md 中，L4 完成后、PRD 生成前，新增一个确认门控阶段。Claude 根据 L1-L4 收集的所有信息，通过 AskUserQuestion 输出一个结构化的确认摘要，包含：需求摘要、功能列表、风险评估、复杂度估计。用户可选择"确认并生成 PRD"或"返回修改"。

**核心改动：**
- 在 SKILL.md Phase 5（L4）和 Phase 6（生成 PRD）之间插入确认门控指令
- 定义确认摘要格式：通过 AskUserQuestion 的 questions 数组呈现（每个 question 代表一个摘要板块）
- metadata 中标记 `phase: 'confirmation'`，level 设为 5（作为虚拟层级）
- 提供"确认并生成"和"返回修改"选项
- 如果用户选择"返回修改"，允许 Claude 重新提问特定层级

**确认摘要内容：**
```
question 1: 需求摘要（将 L1-L4 关键答案总结为 3-5 句话）
question 2: 功能范围确认（列出核心功能 + 排除功能）
question 3: 风险评估（HIGH/MEDIUM/LOW 风险项）
question 4: 确认操作（确认生成 / 返回修改 / 重新开始）
```

**Acceptance Criteria:**
- [ ] SKILL.md 中 L4 之后有明确的确认门控指令
- [ ] 确认摘要通过 AskUserQuestion 输出，包含需求摘要、功能范围、风险评估
- [ ] metadata 包含 `phase: 'confirmation'` 和 `level: 5`
- [ ] 用户可选择"确认并生成"或"返回修改"
- [ ] "返回修改"时 Claude 能重新提问
- [ ] Typecheck passes

### DT-003: Viewer — 确认门控 UI 组件

**Description:** 修改 Stage 1 页面，识别 `phase: 'confirmation'` 的 metadata，渲染为摘要卡片 UI（区别于普通问答界面）。卡片展示需求摘要、功能列表、风险评估等信息，底部有"确认并生成 PRD"和"返回修改"两个按钮。

**核心改动：**
- 修改 `tool-types.ts`：PyramidMetadata 增加 `phase?: 'questioning' | 'confirmation'` 字段
- 修改 `stage1/page.tsx` 的 `handleToolUse`：识别 confirmation metadata
- 新增确认卡片渲染逻辑：当 phase === 'confirmation' 时，替换普通问答 UI
- 卡片布局：摘要信息分区展示，每个 question 渲染为一个信息卡
- "确认并生成"按钮发送确认 → Claude 生成 PRD
- "返回修改"按钮发送修改指令 → Claude 回到对应层级重新提问
- 左侧 PyramidNavigation 支持显示第 5 层"确认"状态

**Acceptance Criteria:**
- [ ] PyramidMetadata 类型增加 phase 字段
- [ ] Stage 1 页面识别 confirmation 阶段并渲染卡片 UI
- [ ] 卡片包含需求摘要、功能范围、风险评估等分区
- [ ] "确认并生成"和"返回修改"按钮功能正常
- [ ] 左侧导航显示确认层级状态
- [ ] 卡片背景为白色（遵循项目规范）
- [ ] Typecheck passes
- [ ] Verify in browser

### DT-004: SKILL.md — 更新 PRD 模板增加风险和测试章节

**Description:** 修改 pyramidprd SKILL.md 中的 PRD 输出模板，在 Dev Tasks 之后新增"风险评估"和"测试策略"两个章节。风险评估按 HIGH/MEDIUM/LOW 分级，测试策略包含单元测试、集成测试、E2E 测试的覆盖范围。

**核心改动：**
- 更新 SKILL.md Phase 6 的 PRD 模板
- 新增 `## Risks & Mitigations` 章节（在 Dev Tasks 之后）
- 新增 `## Testing Strategy` 章节（在风险评估之后）
- 指导 Claude 基于 L1-L4 答案自动生成风险评估和测试策略
- 同步更新 `botoolagent-generateprd` SKILL.md 中的 PRD 模板

**新增章节格式：**
```markdown
## Risks & Mitigations

- **HIGH**: [风险描述]
  - Mitigation: [缓解方案]
- **MEDIUM**: [风险描述]
  - Mitigation: [缓解方案]
- **LOW**: [风险描述]
  - Mitigation: [缓解方案]

## Testing Strategy

- **单元测试**: [需要测试的模块/函数]
- **集成测试**: [需要测试的 API/数据流]
- **E2E 测试**: [需要测试的用户流程]
- **预计覆盖率目标**: [百分比]
```

**Acceptance Criteria:**
- [ ] SKILL.md PRD 模板包含 Risks & Mitigations 章节
- [ ] SKILL.md PRD 模板包含 Testing Strategy 章节
- [ ] 章节位于 Dev Tasks 之后、Non-Goals 之前
- [ ] 风险分 HIGH/MEDIUM/LOW 三级
- [ ] 测试策略覆盖单元/集成/E2E 三种类型
- [ ] generateprd SKILL.md 模板同步更新
- [ ] Typecheck passes

### DT-005: 更新 tool-types.ts 和 PyramidNavigation 支持新状态

**Description:** 更新类型定义以支持新的代码库扫描标记和确认门控状态，同时修改 PyramidNavigation 组件支持显示第 5 层"确认"状态。

**核心改动：**
- `tool-types.ts`：PyramidMetadata 增加 `phase`、`codebaseScanned`、`codebaseSummary` 字段
- `PyramidNavigation` 组件：支持 5 层显示（L1-L4 + 确认）
- `stage1/page.tsx`：`levels` 数组从 4 层扩展到 5 层
- 当 `codebaseScanned: true` 时，L2 层显示"代码库已分析"提示

**Acceptance Criteria:**
- [ ] PyramidMetadata 类型定义完整
- [ ] PyramidNavigation 支持第 5 层"确认"显示
- [ ] 代码库扫描状态在 UI 中有体现
- [ ] 卡片/对话框背景为白色
- [ ] Typecheck passes
- [ ] Verify in browser

### DT-006: generateprd SKILL.md — 重构定位 + 增加代码库扫描

**Description:** 重构 generateprd SKILL.md，明确其为纯 CLI 开发者工具。去掉所有 Viewer 相关指令（Viewer Mode、"Do NOT use tools" 限制等），并在 Phase 1 增加结构化代码库扫描，充分利用 Glob/Grep/Read 工具分析项目。

**核心改动：**
- 删除 "Viewer Mode (Recommended)" 整个章节
- 删除 "IMPORTANT: You are running inside BotoolAgent Viewer" 整个章节
- 更新 description 和概述，明确为"CLI 开发者专用 PRD 生成器"
- Phase 1 "Understand the Idea" 增加结构化扫描指令：
  - 使用 Glob 扫描目录结构和关键文件
  - 使用 Read 读取 package.json、tsconfig、CLAUDE.md 等
  - 使用 Grep 搜索现有路由、API、组件模式
  - 分析结果：技术栈、架构模式、现有组件、数据模型、已有业务逻辑
  - 将分析结果作为后续问题的上下文（如预设技术栈选项）
- 新项目（无代码库）时自动跳过扫描

**Acceptance Criteria:**
- [ ] SKILL.md 中不包含任何 Viewer 相关指令
- [ ] Phase 1 有明确的代码库扫描步骤
- [ ] 扫描使用 Glob/Grep/Read 工具，覆盖技术栈+架构+业务逻辑
- [ ] 扫描结果体现在后续问题的选项和上下文中
- [ ] 无代码库场景有降级处理
- [ ] Typecheck passes

### DT-007: generateprd SKILL.md — 增加确认门控 + 更新 PRD 模板

**Description:** 在 generateprd SKILL.md 的 Phase 3（Present the Design）和 Phase 4（Generate PRD）之间增加确认门控步骤。同时更新 PRD 输出模板，增加风险评估和测试策略章节。

**核心改动：**
- 在 Phase 3 和 Phase 4 之间插入 "Phase 3.5: Final Confirmation"
  - 使用 AskUserQuestion 展示：需求摘要、核心功能列表、风险评估（HIGH/MEDIUM/LOW）、复杂度估计
  - 用户选择"确认生成"或"返回修改"
  - "返回修改"时回到 Phase 2 或 Phase 3 重新讨论
- 更新 PRD Output Format 模板：
  - Dev Tasks 之后增加 `## Risks & Mitigations` 章节
  - 增加 `## Testing Strategy` 章节
  - 顺序：Dev Tasks → Risks → Testing → Functional Requirements → Non-Goals → Technical
- 更新 Checklist：增加"确认门控已通过"和"包含风险/测试章节"检查项

**Acceptance Criteria:**
- [ ] Phase 3 和 Phase 4 之间有明确的确认门控步骤
- [ ] 确认摘要通过 AskUserQuestion 展示
- [ ] 用户可选择"确认生成"或"返回修改"
- [ ] PRD 模板包含 Risks & Mitigations 章节
- [ ] PRD 模板包含 Testing Strategy 章节
- [ ] Checklist 已更新
- [ ] Typecheck passes

## Risks & Mitigations

- **HIGH**: SKILL.md 改动后 Claude 行为不可控 — 扫描指令太复杂可能导致 Claude 偏离流程
  - Mitigation: 扫描指令用清晰的步骤格式，设置明确的"扫描完成后必须立即进入 L2"边界
- **MEDIUM**: 代码库扫描耗时过长 — 大型项目扫描可能导致用户等待
  - Mitigation: 限制扫描深度（只查关键文件如 package.json、目录结构），不做全量代码分析
- **MEDIUM**: 确认卡片 UI 与现有问答 UI 切换不流畅
  - Mitigation: 复用现有 AskUserQuestion 渲染结构，只在样式层做区分
- **LOW**: 新 metadata 字段导致旧版 Viewer 报错
  - Mitigation: 使用可选字段（`phase?`），旧 Viewer 自动忽略

## Testing Strategy

- **单元测试**: tool-types.ts 类型守卫函数、metadata 解析逻辑
- **集成测试**: Skill 执行完整 L1→扫描→L2→L3→L4→确认→PRD 流程（通过 CLI 手动验证）
- **E2E 测试**: 在 Viewer Stage 1 中走完整流程，验证确认卡片渲染和按钮功能
- **预计覆盖率目标**: CLI Skill 层面无自动化测试（Prompt 驱动），Viewer UI 组件 80%+

## Functional Requirements

- FR-1: 当 Pyramid/GeneratePRD 在有代码的项目中运行时，问题应反映项目实际技术栈
- FR-2: PRD 生成前必须展示确认摘要，用户未确认不生成 PRD（两个 Skill 都适用）
- FR-3: 用户在确认阶段选择"返回修改"时，能回到对应阶段重新回答
- FR-4: 生成的 PRD 文档包含风险评估和测试策略章节（两个 Skill 统一模板）
- FR-5: 无代码库场景下，扫描阶段自动跳过，不影响正常流程
- FR-6: 所有新增 UI 元素（卡片、对话框）背景为白色
- FR-7: generateprd 不包含任何 Viewer 相关指令，纯 CLI 模式运行
- FR-8: generateprd 可直接使用 Glob/Grep/Read 工具扫描代码库

## Non-Goals (Out of Scope)

- 不新建 API 端点 — 所有逻辑通过 Skill/CLI 实现
- 不修改 Stage 2+ 的流程
- 不做实时代码分析（只做启动时一次性扫描）
- 不做自动化风险评分算法 — 风险由 Claude 基于收集信息判断
- 不修改 PRD-to-JSON 转换逻辑（Stage 2 不受影响）
- 不给 generateprd 增加 Viewer 支持 — 它是纯 CLI 工具

## Technical Considerations

- pyramidprd SKILL.md 是纯 Prompt 文件，改动后需通过完整对话流程手动验证
- generateprd SKILL.md 同样是 Prompt 文件，改动后需在 CLI 中手动验证
- Viewer 使用 `useCliChat` hook 与 CLI 交互，新 metadata 字段需向后兼容
- PyramidNavigation 组件目前硬编码 4 层，需扩展为动态层数
- 代码库扫描使用 Claude 的标准工具（Glob/Grep/Read），无需额外依赖
- pyramidprd SKILL.md 部署在 `~/.claude/skills/botoolagent-pyramidprd/`
- generateprd SKILL.md 部署在 `~/.claude/skills/botoolagent-generateprd/`
- 两个 Skill 的 PRD 输出模板应保持一致格式

## Success Metrics

- 两个 Skill 在已有项目上运行时，问题至少包含 1 个基于代码库分析的选项
- 确认门控成功阻止未确认的 PRD 生成（两个 Skill 都适用）
- 生成的 PRD 100% 包含风险评估和测试策略章节
- pyramidprd 完整流程（L1→扫描→L2→L3→L4→确认→PRD）能在 Viewer 中端到端运行
- generateprd 完整流程能在 CLI 中端到端运行，无 Viewer 依赖
- generateprd SKILL.md 中不含任何 Viewer/Stage 1 相关代码

## Open Questions

- 代码库扫描的具体文件列表是否需要用户可配置？（当前设计为固定扫描范围）
- "返回修改"时是回到 L1 还是让用户选择回到哪一层？
- generateprd 的代码库扫描结果是否需要显式输出给用户看？（还是像 pyramid 一样内化到问题中）
