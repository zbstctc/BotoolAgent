# PRD: Skill-Pipeline 架构对齐

## Introduction

BotoolAgent 的 5 阶段流水线存在架构断裂：enrichment 逻辑写死在 React 组件中，Stage 4/5 没有对应 Skill，CLI 和 Viewer 产出不一致。本次重构将所有阶段对齐为 **Skill 驱动架构**：Skill 是全部逻辑层，Viewer 是纯 UI 层，CLI 和 Viewer 共享同一底层。

## Goals

- CLI 跑 `/botoolagent-prd2json` 和 Viewer Stage 2 产出完全一致的 enriched prd.json
- 5 个 Stage 各有对应 Skill，CLI 用户可以完整走完全流程
- Viewer 组件不含业务逻辑，只做展示和交互
- Testing 和 Finalize 流程标准化，两条路径共享

## 目标架构

```
Stage    Skill (核心逻辑)                    Viewer (纯 UI)            脚本
─────    ──────────────                      ──────────────            ─────
  1      botoolagent-pyramidprd (不改)       /stage1                   -
  2      botoolagent-prd2json (重构)         /stage2 → /api/prd/*      -
  3      botoolagent-coding (更新)           /stage3 → /api/agent/*    BotoolAgentTeams.sh
  4      botoolagent-testing (新建)          /stage4 → /api/test/*     -
  5      botoolagent-finalize (新建)         /stage5 → /api/git/*      -
```

## 现有代码状态（重叠分析）

在制定任务前，确认以下已有实现：

| 组件 | 状态 | 说明 |
|------|------|------|
| `stage3/page.tsx` | 已完成 | 硬编码 `teams` 模式 |
| `api/agent/start/route.ts` | 已完成 | 支持 `mode: 'teams'` 参数 |
| `api/test/run/route.ts` | 已完成 | SSE stream，支持 typecheck/lint/unit/e2e |
| `stage4/page.tsx` | 已完成 | 分层测试 UI |
| `api/git/{diff,changes,commits,pr,merge}` | 已完成 | 完整 git/PR API |
| `stage5/page.tsx` | 已完成 | PR 创建 + 合并 UI |
| Coding SKILL.md Step 3-4 | 需移除 | 包含 typecheck/lint 和 PR 创建，与 Testing/Finalize Skill 重叠 |
| `stage5/page.tsx` 合并方式 | 需修复 | 当前用 squash merge，应改为普通 merge |

## Dev Tasks

### DT-001: Stage 2 — enrichment 逻辑从 React 下沉到 API

**Description:** 将 AutoEnrichStep.tsx 和 EnrichmentSummary.tsx 中的业务逻辑（enrichment prompt、deriveTestCases、generateDefaultSessions、enrichPrdJson）迁移到 `/api/prd/enrich` API 路由。React 组件变为纯展示层，只调用 API 并渲染结果。

**Acceptance Criteria:**
- [ ] 新建 `viewer/src/app/api/prd/enrich/route.ts`，封装全部 enrichment 逻辑
- [ ] API 接受 `{ prdContent, tasks, rules? }` 输入，返回 SSE stream
- [ ] SSE 事件包含：progress（进度）、complete（EnrichResult 含 codeExamples/testCases/evals/dependencies/sessions）
- [ ] `deriveTestCases()` 逻辑从 EnrichmentSummary.tsx 移到 API 层
- [ ] `generateDefaultSessions()` 逻辑从 EnrichmentSummary.tsx 移到 API 层
- [ ] `enrichPrdJson()` 合并逻辑从 EnrichmentSummary.tsx 移到 API 层
- [ ] AutoEnrichStep.tsx 改为调用 `/api/prd/enrich`，移除内联 prompt
- [ ] EnrichmentSummary.tsx 不再包含 deriveTestCases/generateDefaultSessions/enrichPrdJson
- [ ] 保留 `/api/prd/convert`（基础 PRD→JSON 转换）不变
- [ ] Viewer Stage 2 端到端功能不变（规则选择 → 自动 enrichment → 确认保存）
- [ ] Typecheck passes

### DT-002: Stage 2 — CLI fallback 走完整 enrichment

**Description:** 更新 prd2json Skill，使 CLI fallback 路径也能生成完整的 enriched prd.json。CLI 流程：扫描 rules/ 目录 → 默认全选规范 + 用户确认排除 → 内联 enrichment prompt 一步生成完整 prd.json。

**Acceptance Criteria:**
- [ ] 修改 `skills/BotoolAgent/PRD2JSON/SKILL.md`
- [ ] CLI fallback 流程：列出 rules/ 下的规范文件 → 默认全选 → AskUserQuestion 确认是否排除某些
- [ ] Skill prompt 内联 enrichment 要求（sessions、dependsOn、evals、testCases、codeExamples）
- [ ] Claude 一步生成完整 enriched prd.json（不分两步）
- [ ] 输出的 prd.json 包含 sessions、dependsOn、evals、testCases 字段
- [ ] 输出 schema 与 Viewer 路径一致（EnrichedPrdJson 类型）
- [ ] 无 Viewer 环境下纯终端可正常使用
- [ ] Typecheck passes

### DT-003: Stage 3 — coding skill 更新为 Teams 模式（精简版）

**Description:** 更新 Coding SKILL.md：默认调用 BotoolAgentTeams.sh，添加 tmux 检查，移除 Step 3-5（质量检查和 PR 创建将由独立的 Testing/Finalize Skill 负责）。Viewer 侧已完成（stage3 硬编码 teams，api/agent/start 支持 mode 参数），无需修改。

**Acceptance Criteria:**
- [ ] 修改 `skills/BotoolAgent/Coding/SKILL.md`
- [ ] Step 2 默认运行 `BotoolAgentTeams.sh`
- [ ] 支持 `/botoolagent-coding --single` 回退到 `BotoolAgent.sh`
- [ ] 前置检查中添加 tmux 可用性检查（Teams 依赖 tmux）
- [ ] tmux 不可用时自动降级到单 agent 模式
- [ ] 移除 Step 3（自动质量检查）— 由 DT-004 Testing Skill 负责
- [ ] 移除 Step 4（自动创建 PR）— 由 DT-005 Finalize Skill 负责
- [ ] Step 5 改为：输出完成信息 + 提示运行 `/botoolagent-testing`
- [ ] 不修改 Viewer 代码（stage3 + api/agent/start 已完成）

### DT-004: Stage 4 — 新建 botoolagent-testing Skill（精简版）

**Description:** 新建 Testing SKILL.md，封装 CLI 端的 5 层分层测试逻辑。Viewer 侧已有完整实现（`/api/test/run/route.ts` + `stage4/page.tsx`），无需修改。

**Acceptance Criteria:**
- [ ] 新建 `skills/BotoolAgent/Testing/SKILL.md`
- [ ] Layer 1 — Regression: `npx tsc --noEmit` + `npm run lint`
- [ ] Layer 2 — Unit Tests: `npm test`（约定式命令）
- [ ] Layer 3 — E2E Tests: `npx playwright test`（约定式命令）
- [ ] Layer 4 — Code Review: `git diff main...HEAD` 送 Claude 审查
- [ ] Layer 5 — Manual Checklist: 列出 prd.json 中 `type: "manual"` 的 testCases 给用户确认
- [ ] 全部 5 层 blocking：任一层失败则停止并报告
- [ ] CLI 跑 `/botoolagent-testing` 执行完整 5 层测试
- [ ] 不修改 Viewer 代码（stage4 + api/test/run 已完成）

### DT-005: Stage 5 — 新建 botoolagent-finalize Skill（精简版）

**Description:** 新建 Finalize SKILL.md，封装 CLI 端的 PR 创建、Code Review 摘要、合并、清理流程。Viewer 侧已有完整实现（`/api/git/*` + `stage5/page.tsx`），仅需修复合并方式（squash → 普通 merge）。

**Acceptance Criteria:**
- [ ] 新建 `skills/BotoolAgent/Finalize/SKILL.md`
- [ ] Step 1: `git push origin <branchName>` 推送代码
- [ ] Step 2: 检查是否已有 PR（`gh pr list --head <branchName>`），没有则创建
- [ ] Step 3: Claude 审查 `git diff main...HEAD`，生成 review 摘要
- [ ] Step 4: 展示 review 摘要 + 确认合并
- [ ] Step 5: `gh pr merge <pr-number>`（普通 merge，不 squash）
- [ ] Step 6: 删远程分支 + `git checkout main` + `git pull`
- [ ] CLI 跑 `/botoolagent-finalize` 完成完整流程
- [ ] 修复 `stage5/page.tsx` 合并方式：`{ method: 'squash' }` → `{ method: 'merge' }`
- [ ] 不修改其他 Viewer 代码（stage5 + api/git/* 已完成）

## Functional Requirements

- FR-1: 所有 5 个 Stage 的核心逻辑必须在 Skill/API 层，React 组件只做展示
- FR-2: CLI 和 Viewer 两条路径产出的 prd.json 必须 schema 完全一致
- FR-3: enrichment API 使用 SSE stream 响应，支持前端进度展示
- FR-4: CLI 的规范确认步骤使用 AskUserQuestion 交互
- FR-5: Testing Skill 的 unit/e2e 命令使用约定式（npm test / npx playwright test）
- FR-6: Finalize Skill 使用普通 merge，合并后删远程分支 + 切回 main

## Risks & Mitigations

### HIGH
- **Stage 2 多组件逻辑迁移**: enrichment 逻辑分散在 AutoEnrichStep 和 EnrichmentSummary 两个组件中，迁移时可能遗漏 → **缓解**: 逐函数迁移，每迁移一个函数立即跑 typecheck 验证

### MEDIUM
- **测试命令约定不匹配**: 约定式命令（npm test / npx playwright test）可能与某些项目的实际命令不同 → **缓解**: 在 prd.json 中预留 command 字段扩展点，当前用约定值
- **Coding Skill 裁剪 Step 3-4**: 移除质量检查和 PR 创建步骤后，需确保用户知道下一步运行 Testing/Finalize → **缓解**: Step 5 明确提示

### LOW
- **Finalize 需要 gh CLI 权限**: merge 操作依赖 `gh` CLI 已认证 → **缓解**: Skill 前置检查 `gh auth status`

## Testing Strategy

### Unit Tests
- enrichment API 的 deriveTestCases 函数输出验证
- generateDefaultSessions 分组逻辑验证
- enrichPrdJson 合并逻辑验证

### Integration Tests
- `/api/prd/enrich` SSE stream 完整性测试

### E2E Tests
- Viewer Stage 2 完整流程：选规则 → enrichment → 确认保存
- CLI `/botoolagent-testing` 5 层测试逐层执行
- CLI `/botoolagent-finalize` 完整 PR 流程

## Non-Goals (Out of Scope)

- 不改 Stage 1（pyramidprd skill 已正确）
- 不删 BotoolAgent.sh（保留作为 fallback）
- 不拆分 BotoolAgent.sh 为模块化脚本（留给未来）
- 不要求向后兼容旧格式 prd.json
- 不实现 testCases 的自定义 command 字段（当前用约定式）
- 不修改 Viewer Stage 3/4/5 页面（已完成，仅 Stage 5 修复 merge 方式）
- 不新建 API 路由（Stage 4/5 API 已完成）

## Technical Considerations

- enrichment API 内部调用 Claude CLI（通过 CLIManager），需要确保 CLI 可用
- BotoolAgentTeams.sh 依赖 tmux，Coding Skill 需要在 tmux 不可用时自动降级
- Finalize Skill 依赖 gh CLI，需要前置检查认证状态
- DT-001 是最重的任务（逻辑迁移），DT-003/004/005 主要是写 SKILL.md（轻量）

## Success Metrics

- CLI 和 Viewer 产出的 prd.json 100% schema 一致
- 5 个 Stage 全部有对应 Skill，CLI 可独立完整走完 Stage 1→5
- Viewer 组件中零业务逻辑（只有 UI 状态管理）
