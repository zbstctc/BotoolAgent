# Draft: 对抗式双模型审查管道 (Adversarial Review Pipeline)

> Stage 0 头脑风暴产出 | 日期: 2026-02-19

## 定位

重新划分 BotoolAgent 的 Testing 和 Finalize 职责：**Testing 承担全部质量保障**（4 层测试 + Codex 红队对抗 + 自动修复 + PR 创建 + PR-Agent 审查 + 修复反馈），**Finalize 简化为一键 merge**。用户只需 `/botoolagent-testing` 全自动跑完质检，再 `/botoolagent-finalize` 一键合并发布。

## 背景与动机

**现状痛点：**

1. **Testing Layer 4 的 Code Review 是 Claude 自审自** — 实现者 = 审查者，存在确认偏差，容易漏过自己的盲区
2. **Finalize 职责过重** — 既要做 review、又要展示结果、又要 push、又要创建 PR、又要 merge，审查结果发现问题只能展示不能修复，需要手动回去改
3. **单模型盲区无法覆盖** — Claude 对某些 API 用法、安全模式、边界情况有认知盲区，缺乏第二视角
4. **职责划分不清** — Testing 做完检查就结束，审查修复逻辑分散在 Testing L4 和 Finalize Step 3 两个地方

**核心思路：**

```
旧模型:  Testing(检查) → Finalize(审查+修复+PR+merge) ← 用户要来回跑
新模型:  Testing(检查+审查+修复+PR+守门) → Finalize(一键merge) ← 用户只点一下
```

## 核心功能

### Testing 阶段（全自动质检车间）

1. **Layer 1-4 — 现有 4 层测试**（保持不变）
   - L1: TypeCheck + Lint（Ralph 自动修复）
   - L2: Unit Tests（Ralph 自动修复）
   - L3: E2E Tests（Ralph 自动修复）
   - L4: Claude Self-Review（Ralph 自动修复 HIGH/MEDIUM）

2. **Layer 5 — Codex 红队审查（新增）**
   - L1-L4 全部通过后，调用 `codex exec` 对 `git diff main...HEAD` 做独立审查
   - 审查维度：安全漏洞(OWASP Top 10)、逻辑 bug、缺失错误处理、测试覆盖缺口
   - 输出结构化 JSON（severity + category + file:line + suggestion）
   - HIGH/MEDIUM 触发对抗循环

3. **对抗修复循环（Adversarial Loop）**
   - Codex 提出问题 → Claude 修复或论证拒绝 → Codex 复审验收
   - 每轮修复后 Codex 只重新审查变更的文件（增量审查）
   - 最多 3 轮对抗（防止无限循环），未收敛则 Circuit Breaker 转人工
   - Claude 拒绝修复时须提供论证理由，Codex 判断是否接受

4. **Layer 6 — PR 创建 + PR-Agent 守门（新增）**
   - 对抗循环通过后，自动 push + 创建 PR（复用现有 Finalize 的 PR 创建逻辑）
   - PR-Agent SaaS 自动触发 `/review` + `/improve`
   - 等待 PR-Agent 评论返回，解析 HIGH 问题
   - HIGH 问题 → 自动修复 → 重新 push → 等待 PR-Agent 重新审查
   - 最多 2 轮 PR-Agent 修复循环

5. **最终状态输出**
   - 全部通过后，更新 agent-status 为 `testing_complete`
   - 输出完整的 6 层质检报告（每层 pass/fail + 修复记录 + 对抗轮次）
   - PR 已创建、所有审查已通过，随时可 merge

### Finalize 阶段（一键 merge）

6. **简化的 Finalize 流程**
   - Step 1: 展示质检摘要（从 Testing 输出读取）
   - Step 2: 用户确认 merge（唯一的用户决策点）
   - Step 3: 执行 merge（`gh pr merge --merge`）
   - Step 4: 清理（删除远程分支、切回 main、清理 worktree）
   - Step 5: 完成摘要

### 基础设施

7. **Codex MCP Server 集成**
   - 安装 codex-mcp-server，让 Lead Agent 在 tmux session 内直接调用 Codex
   - Stage 3 开发期间可用于即时交叉检查关键决策（可选能力）

8. **AGENTS.md 统一规范**
   - 创建/增强 AGENTS.md，作为 Claude + Codex 共同读取的项目规范
   - 包含：构建命令、架构约定、代码风格、安全红线
   - 确保两个模型的审查标准一致

9. **Viewer 可视化面板**
   - Stage 4 页面增加 Codex 审查结果展示区域
   - 展示：对抗轮次、修复记录、PR-Agent 反馈、最终审查状态
   - 新增 `/api/codex-review` 端点返回审查结果

10. **打包分发更新**
    - `pack.sh` 打包 AGENTS.md
    - `setup.sh` 检查 codex CLI 安装状态（提示但不阻塞）

## 技术方向

- **Codex CLI 调用**: `codex exec -a never --full-auto -o <output>` 非交互模式，解析 JSON/Markdown 输出
- **Codex MCP**: 安装 `codex-mcp-server` (npm)，注册到 `~/.claude.json`，提供 `mcp__codex__*` 工具
- **对抗循环实现**: Testing Skill 内的 bash 脚本循环（codex exec → 解析 → Claude 修复 → codex exec 复查）
- **PR-Agent**: SaaS 模式，只需在 GitHub 授权 App，无需本地部署
- **PR-Agent 结果解析**: `gh api` 读取 PR comments，过滤 PR-Agent bot 的评论，解析建议
- **Viewer 面板**: 复用现有 Stage 4 API (`/api/test/run`)，新增 `/api/codex-review` 端点
- **AGENTS.md**: 放在项目根目录，`CLAUDE.md` 引用它，Codex 自动发现

### 关键架构决策

- **方案选择**: 对抗验证式 — Codex 红队挑战 → Claude 回应修复 → Codex 验收
- **自动修复边界**: HIGH + MEDIUM 自动修复，LOW 仅作为 advisory 记录到 PR body
- **对抗轮次上限**: L5 对抗 3 轮 + L6 PR-Agent 2 轮
- **PR-Agent 部署**: SaaS 托管（零维护）
- **职责重划分**: Testing = 全部质量保障 + PR 创建，Finalize = 一键 merge

### 改造后的完整流水线

```
Stage 3: /botoolagent-coding (自动开发)
  └─ Claude Agent Teams 实现代码

Stage 4: /botoolagent-testing (全自动质检车间)
  ├─ L1: TypeCheck + Lint           ← Ralph 自动修复
  ├─ L2: Unit Tests                 ← Ralph 自动修复
  ├─ L3: E2E Tests                  ← Ralph 自动修复
  ├─ L4: Claude Self-Review         ← Ralph 自动修复 HIGH/MEDIUM
  ├─ L5: Codex 红队对抗审查          ← 对抗循环 ≤ 3 轮
  │   ├─ Codex 提出问题
  │   ├─ Claude 修复或论证拒绝
  │   └─ Codex 复审验收
  ├─ L6: PR 创建 + PR-Agent 守门    ← PR-Agent 修复循环 ≤ 2 轮
  │   ├─ Push + 创建 PR
  │   ├─ PR-Agent 自动 /review + /improve
  │   ├─ 解析 HIGH 问题 → 自动修复
  │   └─ 重新 push → PR-Agent 重审
  └─ 输出: 6 层质检报告 + PR ready to merge

Stage 5: /botoolagent-finalize (一键 merge)
  ├─ 展示质检摘要
  ├─ 用户确认 merge ← 唯一决策点
  ├─ gh pr merge --merge
  └─ 清理 (分支 + worktree)
```

## 目标用户

- **主要用户**: BotoolAgent 使用者（开发者 + 非技术用户通过 Viewer）
- **使用场景**: `/botoolagent-testing` 全自动跑完 → `/botoolagent-finalize` 一键合并

## 范围边界

### 要做的
- Testing Skill 新增 Layer 5（Codex 红队审查 + 对抗循环）
- Testing Skill 新增 Layer 6（PR 创建 + PR-Agent 守门 + 修复循环）
- Testing Skill 搬入现有 Finalize 的 PR 创建/push 逻辑
- Finalize Skill 大幅简化为：展示摘要 → 确认 → merge → 清理
- 安装配置 codex-mcp-server，更新 CLAUDE.lead.md 引用
- 创建/增强 AGENTS.md（统一 Claude + Codex 规范）
- PR-Agent SaaS 授权配置指南（文档）
- Viewer Stage 4 新增 Codex 审查结果展示组件 + API
- `pack.sh` 更新：打包 AGENTS.md，setup.sh 检查 codex CLI

### 不做的（YAGNI）
- 不做 Codex 实时开发模式（只用于审查，不让 Codex 写代码）— 避免两个模型同时写代码产生冲突
- 不做自托管 PR-Agent（用 SaaS）— 不增加服务器维护负担
- 不做 multi_mcp 集成（Codex MCP 已足够）— 避免过度工程化
- 不改 Stage 3 开发流程（MCP 只作为可选工具，不强制）— 保持现有开发流程稳定
- 不做 GitHub Action CI 层的 codex 审查（本地已足够）— 避免重复审查

## 成功标准

1. **对抗循环可运行**: `/botoolagent-testing` 执行完 L1-L4 后自动进入 L5 Codex 红队审查，对抗循环正常收敛（≤ 3 轮）
2. **PR 自动创建**: Testing L6 自动 push + 创建 PR，无需用户操作
3. **PR-Agent 守门**: PR 创建后自动收到 PR-Agent 的 review 评论，HIGH 问题自动修复
4. **Finalize 一键**: `/botoolagent-finalize` 只展示摘要 + 确认 merge + 清理，无需审查/修复
5. **Codex MCP 可用**: Lead Agent 在 tmux session 内可通过 `mcp__codex__*` 调用 Codex
6. **Viewer 可视化**: Stage 4 页面可看到 Codex 审查结果、对抗轮次、修复记录、PR-Agent 反馈
7. **AGENTS.md 生效**: Codex 和 Claude 读取同一份规范，审查标准一致
8. **打包可分发**: `pack.sh` 生成的包含 AGENTS.md，setup.sh 提示 codex CLI 状态

## 开放问题

- Codex CLI 的 `--full-auto` 模式在大型 diff 上的 token 限制和耗时需要实测
- PR-Agent SaaS 的免费额度是否满足项目使用量
- 对抗循环中 Codex 和 Claude 对同一问题的修复建议冲突时的仲裁策略（Claude 论证拒绝 vs Codex 坚持）
- codex-mcp-server 的稳定性和 Claude Code 兼容性需要验证
- PR-Agent 评论解析的可靠性（bot 评论格式是否稳定）
- Testing 阶段耗时可能显著增加（6 层 + 对抗循环），需要评估用户等待体验

---

> 下一步: 使用 `/botoolagent-pyramidprd` 导入此 Draft，生成完整 PRD
