# PRD: 对抗式双模型审查管道 (Adversarial Review Pipeline)

## 1. 项目概述

### 1.1 背景与动机

BotoolAgent 当前的 Testing 和 Finalize 流水线存在以下问题：

1. **Testing Layer 4 的 Code Review 是 Claude 自审自** — 实现者 = 审查者，存在确认偏差
2. **Finalize 职责过重** — 既要做 review、又要 push、又要创建 PR、又要 merge，审查发现的问题只能展示不能修复
3. **单模型盲区** — Claude 对某些 API 用法、安全模式、边界情况有认知盲区，缺乏第二视角
4. **职责划分不清** — 审查修复逻辑分散在 Testing L4 和 Finalize Step 3 两个地方

```
旧模型:  Testing(检查) → Finalize(审查+修复+PR+merge) ← 用户要来回跑
新模型:  Testing(检查+审查+修复+PR+守门) → Finalize(一键merge) ← 用户只点一下
```

### 1.2 核心目标

- Testing 承担全部质量保障（6 层自动质检 + PR 创建）
- Codex 红队对抗消除单模型盲区
- Finalize 简化为一键 merge

### 1.3 成功指标

1. 对抗循环可运行：L5 Codex 红队审查正常收敛（≤ 3 轮）
2. PR 自动创建：Testing L6 自动 push + 创建 PR，无需用户操作
3. PR-Agent 守门：PR 创建后自动收到审查评论，HIGH 自动修复
4. Finalize 一键：只展示摘要 + 确认 merge + 清理
5. Codex MCP 可用：Lead Agent 可通过 `mcp__codex__*` 调用 Codex
6. Viewer 可视化：Stage 4 展示 Codex 审查结果、对抗轮次、修复记录
7. AGENTS.md 生效：Claude 和 Codex 读取同一份规范
8. 打包可分发：pack.sh 包含 AGENTS.md，setup.sh 提示 codex CLI 状态

## 2. 当前状态

### 2.1 已有能力

| 模块 | 状态 | 说明 |
|------|------|------|
| Testing L1-L4 | ✅ 已实现 | TypeCheck + Lint + Unit + E2E + Claude Self-Review，含 Ralph 自动修复 |
| Testing Signal Clarity | ✅ 已实现 | 错误信号分类（clear/fuzzy）+ 3 阶段根因分析 |
| Testing Circuit Breaker | ✅ 已实现 | 2 轮零进展后转人工 |
| Finalize PR 创建 | ✅ 已实现 | gh pr create + auto-generated title/body |
| Finalize Review Summary | ✅ 已实现 | Claude 分析 git diff，生成结构化审查报告 |
| Finalize Merge | ✅ 已实现 | gh pr merge --merge + worktree 清理 |
| Viewer Stage 4 | ✅ 已实现 | 终端日志输出 + Start/Stop 按钮 |
| Viewer Stage 5 | ✅ 已实现 | ChangeSummary + ReviewSummary + CompletionSummary |
| AGENTS.md | ✅ 已存在 | 包含基本项目指引（需增强） |

### 2.2 缺口分析

| 缺口 | 现状 | 目标 |
|------|------|------|
| 多模型审查 | Claude 自审自 | Codex 独立红队审查 |
| 对抗循环 | 无 | Codex 提问→Claude 修复/论证→Codex 验收 |
| PR 创建时机 | Finalize 阶段 | Testing L6 阶段 |
| PR-Agent 集成 | 无 | SaaS 自动 /review + /improve |
| Finalize 简化 | 7 步复杂流程 | 5 步一键流程 |
| Viewer Codex 面板 | 无 | Tab 化展示审查结果 |
| Codex MCP | 无 | codex-mcp-server 集成 |

## 3. 架构设计

### 3.1 核心工作流

```
Stage 4: /botoolagent-testing (全自动质检车间)
  ├─ L1: TypeCheck + Lint           ← Ralph 自动修复
  ├─ L2: Unit Tests                 ← Ralph 自动修复
  ├─ L3: E2E Tests                  ← Ralph 自动修复
  ├─ L4: Claude Self-Review         ← Ralph 自动修复 HIGH/MEDIUM
  ├─ L5: Codex 红队对抗审查          ← 对抗循环 ≤ 3 轮
  │   ├─ codex exec → 结构化 JSON
  │   ├─ Claude 修复或论证拒绝
  │   └─ Codex 增量复审验收
  ├─ L6: PR 创建 + PR-Agent 守门    ← PR-Agent 修复循环 ≤ 2 轮
  │   ├─ git push + gh pr create
  │   ├─ PR-Agent SaaS /review + /improve
  │   ├─ 解析 HIGH 问题 → 自动修复
  │   └─ 重新 push → PR-Agent 重审
  └─ 输出: 6 层质检报告 + PR ready to merge

Stage 5: /botoolagent-finalize (一键 merge)
  ├─ 展示质检摘要
  ├─ 用户确认 merge ← 唯一决策点
  ├─ gh pr merge --merge
  └─ 清理 (分支 + worktree)
```

### 3.2 组件交互

```
┌─────────────────────────────────────────────────────┐
│                   Testing Skill                     │
│  ┌─────────┐  ┌─────────┐  ┌──────────────────┐   │
│  │ L1-L4   │→│ L5      │→│ L6               │   │
│  │ 现有层  │  │ Codex   │  │ PR + PR-Agent    │   │
│  └─────────┘  │ 红队    │  └──────────────────┘   │
│               └────┬────┘                           │
│                    │                                 │
│               ┌────▼────┐                           │
│               │ 对抗循环 │ ≤ 3 轮                   │
│               │ Codex ⇌ │                           │
│               │ Claude  │                           │
│               └─────────┘                           │
└─────────────────────────────────────────────────────┘
         │ testing-report.json
         ▼
┌─────────────────────────────────────────────────────┐
│                  Finalize Skill                      │
│  展示摘要 → 用户确认 → merge → 清理                  │
└─────────────────────────────────────────────────────┘
```

### 3.3 对抗循环状态机

```
┌──────────┐   codex exec    ┌──────────────┐
│ L4 通过  │───────────────▶│ Codex 审查中  │
└──────────┘                 └──────┬───────┘
                                    │ 输出 findings
                              ┌─────▼──────┐
                              │ 有 HIGH/MED?│
                              └─────┬───────┘
                         是 ┌───────┘└───────┐ 否
                      ┌─────▼─────┐    ┌─────▼─────┐
                      │ Claude    │    │ 通过      │
                      │ 修复/论证  │    │ 进入 L6   │
                      └─────┬─────┘    └───────────┘
                            │
                      ┌─────▼─────┐
                      │ Codex     │
                      │ 增量复审   │
                      └─────┬─────┘
                     ┌──────┘└──────┐
               全部解决│             │仍有未解决
                 ┌────▼────┐  ┌────▼────┐
                 │ 通过    │  │ < 3轮?  │
                 │ 进入 L6 │  └────┬────┘
                 └─────────┘  是 │    │ 否
                           ┌────▼┐ ┌─▼──────────┐
                           │下一轮│ │Circuit Break│
                           └─────┘ │转人工       │
                                   └─────────────┘
```

## 4. 数据设计

### 4.1 数据结构概览

| 数据结构 | 用途 | 存储位置 | 状态 |
|---------|------|---------|------|
| codex-review.json | Codex 审查输出 | tasks/{projectId}/ | 新建 |
| adversarial-state.json | 对抗循环状态 | tasks/{projectId}/ | 新建 |
| testing-report.json | 6层质检报告 | tasks/{projectId}/ | 新建 |
| agent-status | 增强状态字段 | tasks/{projectId}/ | 修改 |

### 4.2 Schema 定义

```typescript
// 1. Codex 审查输出 (类 ESLint 格式)
interface CodexReviewOutput {
  findings: CodexFinding[];
}

interface CodexFinding {
  severity: "HIGH" | "MEDIUM" | "LOW";
  category: "security" | "logic" | "error-handling" | "test-coverage" | "style";
  rule: string;                    // e.g. "owasp-injection"
  file: string;                    // e.g. "src/api/users/route.ts"
  line: number;                    // e.g. 42
  message: string;                 // 问题描述
  suggestion: string;              // 修复建议
}

// 2. 对抗循环状态
interface AdversarialState {
  round: number;                   // 当前轮次
  maxRounds: number;               // 最大轮次 (3)
  status: "in_progress" | "converged" | "circuit_breaker";
  rounds: AdversarialRound[];
}

interface AdversarialRound {
  round: number;
  codexFindings: number;           // 本轮发现数
  fixed: number;                   // 修复数
  rejected: number;                // 拒绝修复数
  rejectionReasons: RejectionRecord[];
  remaining: number;               // 剩余未解决
}

interface RejectionRecord {
  finding: string;                 // 原始问题摘要
  reason: string;                  // Claude 的论证理由
  codexAccepted: boolean;          // Codex 是否接受论证
}

// 3. 6层质检报告
interface TestingReport {
  layers: LayerResult[];
  verdict: "all_pass" | "has_failures" | "circuit_breaker";
  prReady: boolean;
  prUrl?: string;
  timestamp: string;
}

interface LayerResult {
  id: string;                      // "L1" - "L6"
  name: string;                    // 层名称
  status: "pass" | "fail" | "skipped";
  fixCount?: number;               // 修复次数
  rounds?: number;                 // Ralph 轮次
  // L5 特有
  adversarialRounds?: number;
  findingsTotal?: number;
  fixed?: number;
  rejected?: number;
  // L6 特有
  prUrl?: string;
  agentComments?: number;
  fixRounds?: number;
}
```

## 5. UI 设计

### 5.1 页面清单

| 页面 | 路由 | 说明 | 状态 |
|------|------|------|------|
| Stage 4 | `/stage4` | 自动质检（Tab 化重构） | 修改 |
| Stage 5 | `/stage5` | 合并发布（简化） | 修改 |

### 5.2 组件清单

| 组件 | Props 接口 | 复用位置 | 状态 |
|------|-----------|---------|------|
| CodexReviewPanel | `{ findings, adversarialState }` | Stage 4 | 新建 |
| LayerProgressBar | `{ layers: LayerResult[] }` | Stage 4 | 新建 |
| TestingReportSummary | `{ report: TestingReport }` | Stage 4, Stage 5 | 新建 |
| TestResults | `{ ... }` | Stage 4 | 已有 |
| ReviewSummary | `{ ... }` | Stage 5 | 已有（简化） |

### 5.3 Stage 4 页面布局

```
┌─────────────────────────────────────────┐
│ Stage 4: 自动质检               [Stop]  │
│ ───────────────────────────────────── │
│ [██████████████░░░░] L5/6 进行中...  │
│ L1✓ L2✓ L3✓ L4✓ L5● L6○            │
│ ───────────────────────────────────── │
│ [测试日志] [Codex审查] [PR-Agent] [报告] │
│ ───────────────────────────────────── │
│                                         │
│  (Tab 内容区域)                          │
│                                         │
└─────────────────────────────────────────┘
```

Tab 内容：
- **测试日志**: 现有终端日志输出（L1-L4）
- **Codex 审查**: CodexReviewPanel 组件（对抗轮次 + findings 列表）
- **PR-Agent**: PR-Agent 评论内容展示
- **报告**: TestingReportSummary 组件（6 层汇总）

### 5.4 Codex 审查 Tab 内容

```
┌─────────────────────────────────┐
│ 对抗轮次: 2/3                     │
│ 发现问题: 8  已修复: 7  拒绝: 1  │
├─────────────────────────────────┤
│ 🔴 HIGH  sql-injection  api/x:42│
│    → 已修复 (Round 1)            │
│ 🟡 MED   missing-auth  api/y:15│
│    → 已修复 (Round 2)            │
│ 🟢 LOW   naming-conv   lib/z:8 │
│    → Advisory (跳过)             │
└─────────────────────────────────┘
```

### 5.5 Stage 5 页面布局（简化版）

```
┌─────────────────────────────────────────┐
│ Stage 5: 合并发布                        │
│ ───────────────────────────────────── │
│  ✓ 质检报告: 6层全部通过                │
│  ✓ PR: #42 (ready to merge)            │
│  ✓ PR-Agent: 审查通过                   │
│  ───────────────────────────────────── │
│           [确认 Merge]                  │
└─────────────────────────────────────────┘
```

## 6. 业务规则

### 6.1 自动修复规则

| ID | 规则 | 说明 | 影响任务 |
|----|------|------|---------|
| BR1 | HIGH + MEDIUM 自动修复 | L5 对抗循环和 L6 PR-Agent 发现的 HIGH/MEDIUM 均触发自动修复 | DT-003, DT-004, DT-006 |
| BR1b | LOW 仅记录 | LOW 问题记录到 PR body 作为 advisory，不触发修复 | DT-005 |

### 6.2 对抗循环规则

| ID | 规则 | 说明 | 影响任务 |
|----|------|------|---------|
| BR2 | 最多 3 轮对抗 | 防止无限循环，未收敛则 Circuit Breaker 转人工 | DT-004 |
| BR3 | Claude 论证拒绝模式 | Claude 可拒绝修复但须提供书面论证理由，Codex 判断是否接受。接受则记录日志；不接受则计入未解决 | DT-004 |
| BR4 | PR-Agent 最多 2 轮 | PR-Agent 发现的 HIGH 问题自动修复后重新 push，最多 2 轮 | DT-006 |
| BR5 | Codex 增量审查 | 对抗循环中 Codex 只复审变更的文件，非全量重审 | DT-003, DT-004 |

### 6.3 阶段流转规则

| ID | 规则 | 说明 | 影响任务 |
|----|------|------|---------|
| BR6 | testing_complete 前置 | agent-status 必须为 `testing_complete` 才能进入 Finalize | DT-005, DT-007 |

### 6.4 对抗循环决策树

```
Codex 发现问题
├── severity = HIGH/MEDIUM?
│   ├── 是 → Claude 必须回应
│   │   ├── 修复了 → Codex 复审变更文件
│   │   └── 拒绝修复 → 提供书面论证
│   │       ├── Codex 接受 → 记录到日志
│   │       └── Codex 不接受 → 计入未解决
│   └── 否 (LOW) → 记录到 PR body
└── 检查轮次
    ├── < 3 轮且有未解决 → 下一轮
    ├── 全部解决 → 通过，进入 L6
    └── = 3 轮且仍未解决 → Circuit Breaker
```

## 7. 开发计划

### 7.0 Phase 依赖图

```
Phase 1 ──▶ Phase 2 + Phase 3 (可并行) ──▶ Phase 4 ──▶ Phase 5
基础设施     Testing改造 + Finalize简化      Viewer UI   打包分发
(P0, 2 DT)  (P0, 5 DT)                     (P1, 3 DT)  (P2, 2 DT)
```

### 7.1 Phase 1: 基础设施 (P0)

> **前置**: 无
> **产出**: AGENTS.md 统一规范 + Codex MCP 可用
> **对应设计**: Section 3.1, 4.2

- [ ] DT-001: 增强 AGENTS.md 统一 Claude + Codex 审查规范 (`文件: AGENTS.md`)
  - 在现有 AGENTS.md 基础上增加 Codex 审查规范章节
  - 包含：构建命令、架构约定、代码风格、安全红线
  - 在 CLAUDE.md 中添加 `See @AGENTS.md` 引用
  - Codex 自动发现 AGENTS.md（无需额外配置）
  - 验收标准:
    - [ ] AGENTS.md 包含审查规范章节
    - [ ] CLAUDE.md 引用 AGENTS.md
    - [ ] Typecheck passes

- [ ] DT-002: 安装配置 codex-mcp-server + 更新 CLAUDE.lead.md (`文件: CLAUDE.lead.md, setup.sh`)
  - 编写 codex-mcp-server 安装指引（npm install）
  - 在 `~/.claude.json` 注册 MCP server 配置
  - 更新 CLAUDE.lead.md 添加 `mcp__codex__*` 工具使用说明（可选能力）
  - setup.sh 添加 codex CLI 检测逻辑（提示但不阻塞）
  - 验收标准:
    - [ ] codex-mcp-server 可通过 `mcp__codex__*` 调用
    - [ ] CLAUDE.lead.md 包含 Codex MCP 使用说明
    - [ ] setup.sh 检测并提示 codex CLI 状态
    - [ ] Typecheck passes

### 7.2 Phase 2: Testing Skill 改造 (P0)

> **前置**: Phase 1
> **产出**: Testing Skill 支持 6 层质检 + 对抗循环 + PR 创建
> **对应设计**: Section 3.1, 3.3, 4.2, 6.1-6.4

- [ ] DT-003: Testing Layer 5 — Codex 红队审查 (`文件: skills/BotoolAgent/Testing/SKILL.md`)
  - 在 L4 之后新增 Layer 5 章节
  - 调用 `codex exec -a never --full-auto -o <output>` 对 `git diff main...HEAD` 审查
  - 审查 prompt 包含：安全漏洞(OWASP Top 10)、逻辑 bug、缺失错误处理、测试覆盖缺口
  - 要求 Codex 输出类 ESLint 格式的结构化 JSON（severity + category + rule + file:line + message + suggestion）
  - 解析输出 JSON，按 severity 分类处理
  - 大 diff 缓解策略：分文件审查模式（当 diff 超过 5000 行时自动拆分）
  - 验收标准:
    - [ ] codex exec 调用正确执行
    - [ ] JSON 输出被正确解析为 findings 数组
    - [ ] HIGH/MEDIUM 触发下一步对抗循环
    - [ ] LOW 记录到待写入 PR body 的列表
    - [ ] Typecheck passes

- [ ] DT-004: 对抗修复循环 (Adversarial Loop) 实现 (`文件: skills/BotoolAgent/Testing/SKILL.md`)
  - 实现 Codex→Claude→Codex 对抗循环逻辑
  - Claude 修复模式：直接修复代码并 commit
  - Claude 论证拒绝模式：提供书面论证理由，调用 `codex exec` 让 Codex 判断是否接受
  - Codex 增量复审：只审查变更的文件（`git diff HEAD~1 -- <files>`）
  - 轮次控制：最多 3 轮，未收敛走 Circuit Breaker（AskUserQuestion 转人工）
  - 对抗状态写入 adversarial-state.json
  - 每轮结束 commit 修复：`git commit -m "fix(testing): adversarial round N fixes"`
  - 验收标准:
    - [ ] 对抗循环在 ≤ 3 轮内收敛
    - [ ] Claude 可以论证拒绝修复，Codex 可以接受或拒绝论证
    - [ ] 增量审查只覆盖变更文件
    - [ ] Circuit Breaker 在 3 轮未收敛时触发
    - [ ] adversarial-state.json 正确记录每轮状态
    - [ ] Typecheck passes

- [ ] DT-005: Testing Layer 6 — PR 创建 + Push (`文件: skills/BotoolAgent/Testing/SKILL.md`)
  - 对抗循环通过后，新增 Layer 6
  - 从现有 Finalize SKILL.md Step 1-2 搬移 PR 创建逻辑
  - 自动 `git push origin <branchName>`
  - 使用 `gh pr create` 创建 PR（auto-generated title from prd.json + body from progress.txt）
  - LOW 问题写入 PR body 的 "Advisory" 章节
  - 更新 agent-status 为 `testing_complete`（含 prUrl）
  - 写入 testing-report.json（6 层完整报告）
  - 验收标准:
    - [ ] L5 通过后自动 push + 创建 PR
    - [ ] PR title 和 body 自动生成
    - [ ] LOW 问题出现在 PR body
    - [ ] agent-status 更新为 testing_complete
    - [ ] testing-report.json 包含所有 6 层结果
    - [ ] Typecheck passes

- [ ] DT-006: Testing Layer 6 — PR-Agent 守门 + 修复循环 (`文件: skills/BotoolAgent/Testing/SKILL.md`)
  - PR 创建后，等待 PR-Agent SaaS 自动评论（polling `gh api` 读取 PR comments）
  - 过滤 PR-Agent bot 评论，解析 HIGH 问题（正则匹配 + fallback）
  - HIGH 问题触发自动修复 → 重新 push → 等待 PR-Agent 重审
  - 最多 2 轮 PR-Agent 修复循环
  - 等待超时：60 秒无 PR-Agent 评论则跳过（PR-Agent 为可选层）
  - 验收标准:
    - [ ] 正确解析 PR-Agent bot 评论
    - [ ] HIGH 问题自动修复后重新 push
    - [ ] 修复循环 ≤ 2 轮
    - [ ] 超时跳过机制正常工作
    - [ ] Typecheck passes

### 7.3 Phase 3: Finalize Skill 简化 (P0)

> **前置**: Phase 1（与 Phase 2 可并行）
> **产出**: Finalize Skill 简化为 5 步一键 merge
> **对应设计**: Section 3.1

- [ ] DT-007: Finalize Skill 大幅简化为一键 merge (`文件: skills/BotoolAgent/Finalize/SKILL.md`)
  - 重写 Finalize SKILL.md，简化为 5 步：
    - Step 1: 项目选择（保留多 PRD 模式）
    - Step 2: 读取 testing-report.json，展示质检摘要
    - Step 3: 用户确认 merge（唯一决策点）
    - Step 4: 执行 merge（`gh pr merge --merge`）+ worktree 清理 + PID 清理
    - Step 5: 完成摘要（PR URL + merge 状态 + 清理结果）
  - 前置检查：agent-status 必须为 `testing_complete`，否则提示先运行 `/botoolagent-testing`
  - 删除原有的 Step 3 Code Review 和自动修复逻辑（已移至 Testing）
  - 删除原有的 push 逻辑（已移至 Testing L6）
  - 验收标准:
    - [ ] Finalize 只有 5 步，无审查/修复逻辑
    - [ ] 前置检查 testing_complete 状态
    - [ ] merge + 清理正确执行
    - [ ] Typecheck passes

### 7.4 Phase 4: Viewer UI (P1)

> **前置**: Phase 2（需要 API 和数据格式）
> **产出**: Stage 4 Tab 化 + Codex 审查面板 + Stage 5 简化
> **对应设计**: Section 5.1-5.5

- [ ] DT-008: Stage 4 页面 Tab 化重构 + LayerProgressBar (`文件: viewer/src/app/stage4/page.tsx`, `组件: viewer/src/components/LayerProgressBar.tsx`)
  - 重构 Stage 4 页面为 Tab 布局（使用 shadcn Tabs 组件）
  - 4 个 Tab：测试日志 | Codex 审查 | PR-Agent | 报告
  - 新建 LayerProgressBar 组件：横向进度条显示 L1-L6 状态（✓/●/○）
  - 实时更新：通过 SSE 或 polling agent-status 文件
  - 验收标准:
    - [ ] Tab 切换正常工作
    - [ ] LayerProgressBar 实时反映当前层
    - [ ] 现有测试日志功能不受影响
    - [ ] Verify in browser
    - [ ] Typecheck passes

- [ ] DT-009: CodexReviewPanel 组件 + /api/codex-review API (`组件: viewer/src/components/CodexReviewPanel.tsx`, `API: viewer/src/app/api/codex-review/route.ts`)
  - 新建 `/api/codex-review` GET 端点，读取 codex-review.json + adversarial-state.json
  - 新建 CodexReviewPanel 组件：
    - 顶部统计：对抗轮次、发现问题数、已修复、拒绝
    - 列表：每个 finding 显示 severity badge + rule + file:line + 状态（已修复/拒绝/跳过）
    - 使用 shadcn Badge 组件（success/warning/error 变体）
  - Dialog 背景必须为白色（遵循 CLAUDE.md 规范）
  - 验收标准:
    - [ ] API 正确返回审查数据
    - [ ] 组件正确展示 findings 列表
    - [ ] severity badge 颜色正确（HIGH=红, MED=黄, LOW=灰）
    - [ ] Verify in browser
    - [ ] Typecheck passes

- [ ] DT-010: Stage 5 页面简化 + TestingReportSummary 组件 (`文件: viewer/src/app/stage5/page.tsx`, `组件: viewer/src/components/TestingReportSummary.tsx`)
  - 简化 Stage 5 页面，移除 ChangeSummary 和详细 ReviewSummary
  - 新建 TestingReportSummary 组件：读取 testing-report.json，展示 6 层通过状态 + PR 信息
  - 页面只展示：质检摘要 + PR 链接 + [确认 Merge] 按钮
  - 前置检查：testing-report.json 必须存在且 verdict = "all_pass"
  - 验收标准:
    - [ ] Stage 5 页面简化为摘要 + merge 按钮
    - [ ] TestingReportSummary 正确展示 6 层状态
    - [ ] 前置检查正确拦截未通过状态
    - [ ] Verify in browser
    - [ ] Typecheck passes

### 7.5 Phase 5: 打包分发 (P2)

> **前置**: Phase 4
> **产出**: 更新打包脚本 + PR-Agent 配置文档
> **对应设计**: Section 3.1

- [ ] DT-011: pack.sh + setup.sh + manifest 更新 (`文件: scripts/pack.sh, .botoolagent-manifest.json`)
  - pack.sh：确保 AGENTS.md 被包含在 core 文件列表
  - setup.sh：添加 codex CLI 检测（`which codex`），提示安装但不阻塞
  - setup.sh：添加 codex-mcp-server 可选安装提示
  - manifest.json：core 数组添加 AGENTS.md
  - 验收标准:
    - [ ] `bash scripts/pack.sh` 生成的 tar.gz 包含 AGENTS.md
    - [ ] setup.sh 检测 codex CLI 并输出状态提示
    - [ ] manifest.json 包含 AGENTS.md
    - [ ] Typecheck passes

- [ ] DT-012: PR-Agent SaaS 配置指南 (`文件: docs/pr-agent-setup.md`)
  - 编写 PR-Agent SaaS 授权配置指南
  - 包含：注册步骤、GitHub App 授权、仓库启用
  - 说明 BotoolAgent 如何自动等待和解析 PR-Agent 评论
  - 验收标准:
    - [ ] 文档包含完整的配置步骤
    - [ ] 截图或链接到 PR-Agent 官网

## 8. 附录

### A. 代码文件索引

| 文件路径 | 状态 | Phase | 任务 |
|---------|------|-------|------|
| `AGENTS.md` | 修改 | Phase 1 | DT-001 |
| `CLAUDE.md` | 修改 | Phase 1 | DT-001 |
| `CLAUDE.lead.md` | 修改 | Phase 1 | DT-002 |
| `skills/BotoolAgent/Testing/SKILL.md` | 修改 | Phase 2 | DT-003~006 |
| `skills/BotoolAgent/Finalize/SKILL.md` | 修改 | Phase 3 | DT-007 |
| `viewer/src/app/stage4/page.tsx` | 修改 | Phase 4 | DT-008 |
| `viewer/src/app/stage5/page.tsx` | 修改 | Phase 4 | DT-010 |
| `viewer/src/app/api/codex-review/route.ts` | 新建 | Phase 4 | DT-009 |
| `viewer/src/components/CodexReviewPanel.tsx` | 新建 | Phase 4 | DT-009 |
| `viewer/src/components/LayerProgressBar.tsx` | 新建 | Phase 4 | DT-008 |
| `viewer/src/components/TestingReportSummary.tsx` | 新建 | Phase 4 | DT-010 |
| `scripts/pack.sh` | 修改 | Phase 5 | DT-011 |
| `.botoolagent-manifest.json` | 修改 | Phase 5 | DT-011 |
| `docs/pr-agent-setup.md` | 新建 | Phase 5 | DT-012 |

### B. 风险与缓解措施

#### HIGH
- **Codex CLI 大 diff 的 token 限制**: 当 diff 超过 5000 行时可能超出 Codex 上下文窗口 → **缓解**: 分文件审查模式，每个文件独立调用 codex exec，最后合并结果

#### MEDIUM
- **PR-Agent 评论格式变化**: SaaS 版本更新可能改变评论格式 → **缓解**: 正则匹配 + fallback（无法解析时跳过 PR-Agent 层）
- **对抗循环不收敛**: Claude 和 Codex 对同一问题反复争论 → **缓解**: 3 轮硬上限 + Circuit Breaker

#### LOW
- **codex-mcp-server 兼容性**: MCP server 可能与特定 Claude Code 版本不兼容 → **缓解**: MCP 为可选功能，不影响核心流程

### C. 测试策略

#### 手动测试
- 在一个项目上运行 `/botoolagent-testing`，确认 L5 Codex 审查正常触发
- 人为引入安全漏洞代码，验证 Codex 能发现并触发对抗循环
- 运行 `/botoolagent-finalize`，确认只展示摘要 + 一键 merge

#### 集成测试
- 验证 codex-review.json 写入和读取
- 验证 adversarial-state.json 多轮更新
- 验证 testing-report.json 6 层完整性

### D. 非目标 (Out of Scope)

- 不做 Codex 实时开发模式（只用于审查，不让 Codex 写代码）
- 不做自托管 PR-Agent（用 SaaS）
- 不做 multi_mcp 集成（Codex MCP 已足够）
- 不改 Stage 3 开发流程（MCP 只作为可选工具，不强制）
- 不做 GitHub Action CI 层的 codex 审查（本地已足够）
