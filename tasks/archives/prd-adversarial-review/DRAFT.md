# Draft: PRD 对抗性审查 (PRD Adversarial Review)

> Stage 0 头脑风暴产出 | 日期: 2026-02-19

## 定位

PRD 对抗性审查是 BotoolAgent Stage 2 的质量门控系统，在两个关键节点用 Codex CLI 以"红队"视角进行交叉验证：**Step 1 审查 PRD 文档**，**Step 4 审查 Enrich 产出**。通过 Codex↔Claude 全自动对抗循环（最多 3 轮）收敛，确保进入自动开发的输入质量。同时支持 Viewer UI 和 CLI Skill 两种使用方式。

## 背景与动机

- **问题 1 — PRD 盲点**: Stage 1 用 Claude 生成 PRD，但 Claude 可能有盲点（遗漏需求、描述模糊、逻辑矛盾）。目前 PRD 生成后直接进入任务规划，没有质量门控
- **问题 2 — Enrich 无审查**: Auto Enrich 生成的代码示例、测试用例、依赖关系、evals 等全部直接合并进 prd.json，没有任何校验。已发现的具体缺陷：
  - `codeExamples` 全局挂载到每个任务（未按 taskId 过滤）
  - 依赖关系无环检测（可能生成循环依赖 A→B→C→A）
  - `filesToModify` 可能引用不存在的文件路径
  - `blocking: true` 的 eval 命令有 typo 会卡死整个 session
  - Session 分组大小无代码层面强制校验
  - JSON 解析失败时静默返回空数组，用户无感知
- **GIGO 风险**: 有问题的 PRD 或 Enrich 产出直接进入自动开发，会导致生成的代码偏离预期，修复成本远高于在 Stage 2 阶段拦截
- **多模型交叉验证**: 用 Codex（OpenAI）审查 Claude 生成的内容，利用模型差异发现盲点，比单一模型自审更可靠

## 核心功能

### A. PRD 审查（Step 1 — Enrich 之前）

1. **Codex PRD 审查** — 调用 `codex exec` 将 PRD 内容作为 prompt，从 5 个维度（完整性、一致性、可实现性、安全性、用户体验）输出结构化 findings（severity/category/message/suggestion/section）
2. **全自动对抗循环** — 最多 3 轮，每轮：Codex 审查 → Claude 自动修正 PRD → Codex 再审。收敛条件：HIGH=0 且 MEDIUM=0。3 轮后未收敛则自动放行，剩余 findings 标记为 acknowledged
3. **持久化** — 审查结果保存到 `tasks/{projectId}/prd-review.json`，修正后的 PRD 覆盖原 `prd.md`

### B. Enrich 审查（Step 4 — Enrich 之后）

4. **Codex Enrich 审查** — 调用 `codex exec` 审查 Auto Enrich 的产出，重点检查：
   - 代码示例是否语法正确、是否正确关联到对应任务
   - 测试用例是否覆盖关键场景、步骤是否可执行
   - 依赖关系是否有环（DAG 校验）
   - `filesToModify` 中的路径是否存在于项目中
   - eval 命令是否语法正确、可执行
   - session 分组是否合理（≤8 任务/session、依赖放同组）
5. **全自动对抗循环** — 同 PRD 审查逻辑：最多 3 轮，Codex 发现问题 → Claude 自动修正 Enrich 结果 → Codex 再审。收敛条件同上
6. **持久化** — 审查结果保存到 `tasks/{projectId}/enrich-review.json`，修正后的 Enrich 结果覆盖合并入 prd.json

### C. 通用能力

7. **进度展示** — Viewer 中实时显示当前轮次、findings 数量变化、修正状态（动画进度条），全程无需用户交互
8. **CLI Skill 支持** — 提供 `botoolagent-prdreview` CLI skill，终端用户也能对任意 PRD 和 Enrich 结果运行对抗审查

## 技术方向

- **技术栈**: Next.js (Viewer) + Bash/child_process (Codex 调用) + Claude API (修正) + TypeScript
- **架构思路**:
  - **Codex 调用**: `codex exec -a never --full-auto -o review-roundN.json`，通过 Bash/child_process 执行
  - **Claude 修正**: Viewer 通过新建 `/api/prd/fix` 端点调用 Claude API，将内容 + findings 作为 prompt，输出修正版
  - **Viewer 组件**: 新建 `AdversarialReviewStep` 组件，复用于 Step 1（PRD 审查）和 Step 4（Enrich 审查），通过 `reviewTarget` prop 区分模式
  - **API 路由**:
    - `/api/prd/review` — 触发 Codex 审查（PRD 或 Enrich 结果）
    - `/api/prd/fix` — Claude 修正（PRD 或 Enrich 结果）
    - 两个端点均用 SSE 流式返回进度
  - **CLI Skill**: 新建 `skills/BotoolAgent/PRDReview/SKILL.md`，注册为 `botoolagent-prdreview`
  - **Enrich Bug 修复**: 同步修复 `codeExamples` 全局分配 bug，改为按 taskId 过滤
- **关键决策**:
  - 选择 `codex exec` CLI 方式而非 SDK/MCP，因为最简单、零额外依赖、已登录可直接用
  - findings 采用 ESLint-like JSON 结构，便于解析和展示
  - `AdversarialReviewStep` 组件复用：同一组件处理 PRD 和 Enrich 两种审查，减少代码重复
  - Stage 2 步骤重新编号：Step 1 = PRD 审查，Step 2 = 规则选择，Step 3 = Auto Enrich，Step 4 = Enrich 审查，Step 5 = 汇总

## 目标用户

- **主要用户**: 使用 BotoolAgent Viewer 的非技术用户（业务员、项目经理）
- **次要用户**: 使用 CLI Skill 的开发者
- **使用场景**: Stage 2 全自动运行两次 Codex 审查，用户无需任何操作，等待审查完成后自动进入下一步

## 范围边界

### 要做的
- Codex 审查 PRD 文档本身（5 维度结构化 findings）— Step 1
- Codex 审查 Enrich 产出（代码示例、依赖、evals 校验）— Step 4
- 两个节点均使用 Codex↔Claude 全自动对抗循环（最多 3 轮）
- `AdversarialReviewStep` 复用组件 + 进度动画
- `/api/prd/review` + `/api/prd/fix` API 路由（支持 PRD 和 Enrich 两种模式）
- `botoolagent-prdreview` CLI Skill
- `prd-review.json` + `enrich-review.json` 持久化
- 修复 Enrich 的 `codeExamples` 全局分配 bug

### 不做的（YAGNI）
- 不审查代码 — 代码审查已有 Stage 4 的 adversarial-review 项目负责
- 不做用户交互式 findings 管理 — 全自动，不需用户逐条处理
- 不做 Codex SDK 集成 — 用 CLI exec 即可
- 不做 MCP Server 集成 — 保持简单
- 不做历史审查记录浏览 — 只保存最新一次

## 成功标准

1. **功能完整**: Stage 2 打开后自动触发 PRD 审查（Step 1），Enrich 完成后自动触发 Enrich 审查（Step 4），全程无需用户操作
2. **PRD 审查质量**: Codex 能发现至少 3 类有意义的 PRD findings（用测试 PRD 验证）
3. **Enrich 审查质量**: Codex 能检测到依赖环、无效文件路径、错误的 eval 命令等结构性问题
4. **修正有效**: Claude 修正后的内容在下一轮审查中 HIGH/MEDIUM findings 显著减少
5. **性能**: 单轮审查 < 60s，完整 3 轮循环 < 3min（PRD 和 Enrich 各自独立计时）
6. **Viewer UI**: 进度动画流畅，轮次状态清晰，无需用户操作
7. **CLI Skill**: `/botoolagent-prdreview` 可独立运行，支持审查 PRD 和 Enrich 两种模式
8. **Bug 修复**: `codeExamples` 按 taskId 正确分配到对应任务

## 开放问题

- Codex exec 的 prompt 模板需要调优，PRD 审查和 Enrich 审查需要不同的 prompt
- 单轮审查 60s 的性能目标是否现实，取决于 Codex 模型响应速度
- Claude 修正 PRD 时是否需要保留原始 PRD 的完整结构（还是允许重构段落）
- Enrich 审查时 Codex 是否需要访问项目源码来验证 `filesToModify` 路径

---

> 下一步: 使用 `/botoolagent-pyramidprd` 导入此 Draft，生成完整 PRD
