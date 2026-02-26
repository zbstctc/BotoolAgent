# DRAFT Combined v3: BotoolAgent PRD 管线全链路升级

> Stage 0 头脑风暴产出 | 日期: 2026-02-26
> 合并自: DRAFT.md (文档架构) + DRAFT_2.md (执行引擎) + DRAFT_3.md (问答加速) + 全链路三 Skill 分析 + 消费方审计

## 定位

**一句话**: 将 BotoolAgent 的 PRD 管线从"多方写入 + 脆弱跳读 + 单对话膨胀 + 逐题慢问"升级为"单一写入方 + 自给自足 + 持久化 + 方案卡快问"的双产物管线。

**四个维度**:
- **输出格式升级** — prd.md + fat dev.json 两件套，消除 skip-read 脆弱性
- **管线主权重构** — prd.md 写入权限分级（PyramidPRD 主写 + PRDReview 受控写），PRD2JSON 只读化
- **执行引擎升级** — Q&A Journal + Subagent 管线，消除上下文爆炸
- **问答加速** — 方案卡批量确认，交互次数从 23-44 次降至 ~9 次

**三大模式**（v1 四模式 → v2 三模式，删除快速修复）:
- 完整规划 — 全量 6 层问答 + 方案卡
- 功能开发 — 精简问答（L1+L4 方案卡）
- 导入模式（Transform） — 外部 PRD 转换

**自动化管线** — 用户确认 PRD 后全自动: PyramidPRD → A1 PRDReview(自动审查) → A2 PRD2JSON(自动转换)

---

## 1. 背景与动机

### 1.1 输出格式问题

botool-present-v16（8120 行 PRD）Transform 转换后暴露：

| # | 问题 | 根因 | 影响 |
|---|------|------|------|
| 1 | T7 假阳性 | T7 只检查 CREATE TABLE 数量和总行数 | 13 字段的表只生成 6 字段仍报 ✅ |
| 2 | UUID 漂移 | AI 擅自改 PK 类型 | 与源表 FK 链断裂 |
| 3 | 字段丢失 | T7 无字段级校验 | 两张表共缺 16 个字段 |
| 4 | 规则丢失 | 1165 行规则只生成 70 行 | 覆盖率 6% |
| 5 | skip-read 脆弱 | prdSection 行号在 prd.md 被编辑后漂移 | Lead Agent 跳读失败 |
| 6 | 职责重叠 | PyramidPRD 和 PRD2JSON 都写 prd.json | 前者白写，后者覆盖 |
| 7 | 两步手动操作 | PyramidPRD → 手动 /prd2json | 用户忘记跑第二步 |

### 1.2 管线主权问题

**当前有三个 Skill 可以修改 prd.md**，导致文件状态不可预测：

| 修改方 | 修改行为 | 后果 |
|--------|---------|------|
| **PyramidPRD** | 生成 prd.md（合法写入方）| — |
| **PRD2JSON** Step 3 | 注入 [規範] 条目到 prd.md §7 | 行号全变 → prdSection 必须重扫 |
| **PRDReview** Step 5c | 修复后通过 `/api/prd/review-save` 覆盖 prd.md | PRD2JSON 如果在 Review 之后运行，prd.md 已变 |

三方修改的连锁反应：
```
PyramidPRD 生成 prd.md (v1)
  ↓
PRDReview 修复 → prd.md (v2)  ← 行号变了
  ↓
PRD2JSON 注入 [規範] → prd.md (v3)  ← 行号又变了
  ↓
PRD2JSON 扫描行号生成 prdSection  ← 基于 v3，但如果用户再跑 Review...
```

**核心问题**：prd.md 没有唯一写入方，任何 Skill 都可以改它，文件状态不确定。

### 1.3 执行引擎问题

| # | 问题 | 数据 | 后果 |
|---|------|------|------|
| 1 | 上下文膨胀 | 完整规划 ~150KB，Transform ~200KB+ | compact 丢失问答历史 |
| 2 | 代码扫描消耗 | 10-50KB 文件内容留在上下文 | 挤压后续 PRD 生成空间 |
| 3 | 大文件手动拆分 | 8120 行 PRD 拆为 A~H | Schema 孤岛 + 交叉引用断裂 |
| 4 | Transform 模式 | 读源 PRD + 比对 + 生成 ≈ 150KB+ | 几乎必爆 context limit |

### 1.4 问答效率问题

| # | 问题 | 数据 | 后果 |
|---|------|------|------|
| 1 | 逐题问答 | 5 层 × 3-12 题 = 最多 23-44 次交互 | 完整规划 ~30-45 分钟 |
| 2 | 技术题问非技术用户 | "API 类型? 认证方式?" | 用户不懂，只能盲选 |
| 3 | 无 AI 推荐 | 用户想"你帮我选"但没这个选项 | 决策疲劳 |
| 4 | 修改路径太绕 | 用户选"有不同想法" → AI 追问 → 用户解释 | 多 2-3 轮交互 |

**核心洞察**：80% 的情况下用户直接接受 AI 推荐，20% 只需精准修改 1-2 项。逐题问答是不必要的负担。

---

## 2. v1 全链路现状（三 Skill + 消费方）

理解当前全貌后才能做出正确的架构决策。

### 2.1 Producer Chain（三个 Skill）

```
PyramidPRD (SKILL.md 1883 行)
  ├─ WRITE: prd.md (§1-§8)
  ├─ WRITE: prd.json (slim)        ← 与 PRD2JSON 冲突，白写被覆盖
  ├─ WRITE: registry.json          ← 与 PRD2JSON 冲突
  ├─ WRITE: PROJECT.md             ← 代码库扫描元数据
  └─ 告知用户: "请手动运行 /prd2json"

PRDReview (SKILL.md + Viewer API)
  ├─ READ: prd.md                  ← PRD 审查模式 (5 维度)
  ├─ READ: prd.json                ← Enrich 审查模式 (5 维度)
  ├─ 调用 Codex: exec --full-auto  ← 敌对审查引擎
  ├─ 敌对循环: max 3 轮 (修复/驳回) ← Mode A + Mode B
  ├─ WRITE: prd-review.json        ← 审查报告（零自动消费方）
  ├─ WRITE: prd-review-fixed.md    ← 修复建议文件
  └─ MODIFY: prd.md (可选)         ← 通过 review-save API 覆盖 ⚠️

PRD2JSON (SKILL.md 1006 行)
  ├─ 检测 Viewer → 可选启动 dev server
  ├─ MODIFY: prd.md §7             ← 注入 [規範] 条目 ⚠️
  ├─ 重新扫描行号                  ← 因为修改了 prd.md
  ├─ WRITE: prd.json (slim, 覆盖)  ← prdSection 行号指针
  ├─ WRITE: registry.json
  ├─ WRITE: progress.txt (重置)
  └─ WRITE: prd-completeness-report.md (Transform 模式)
```

### 2.2 Consumer Chain

```
Lead Agent (CLAUDE.lead.md 346 行)
  ├─ READ: prd.json
  │   ├─ Slim 模式: prdFile + prdSection → skip-read prd.md §7  ← 脆弱
  │   └─ Fat 模式: description + AC[] (backward compat)
  ├─ READ: prd.md (被 prdSection 跳读)
  ├─ WRITE: prd.json (passes: true)
  └─ WRITE: progress.txt (append)

Testing SKILL
  ├─ READ: prd.json (branchName, testCases, playwrightMcp)
  └─ WRITE: testing-report.json

Coding SKILL
  └─ READ: prd.json (branchName) → 启动 BotoolAgent.sh

Finalize SKILL
  ├─ READ: prd.json (branchName)
  ├─ READ: testing-report.json
  └─ WRITE: registry.json (status → "complete")

BotoolAgent.sh (6 处硬编码 prd.json)
  ├─ READ: prd.json (branchName)
  └─ WRITE: agent-status, progress.txt
```

### 2.3 v1 结构性缺陷汇总

| # | 缺陷 | 影响范围 |
|---|------|---------|
| 1 | **三方修改 prd.md** | PyramidPRD + PRDReview + PRD2JSON 都写 prd.md |
| 2 | **双方写 prd.json** | PyramidPRD + PRD2JSON 都写（前者被覆盖） |
| 3 | **prdSection 行号脆弱** | 任何 prd.md 修改都导致行号漂移 |
| 4 | **skip-read 依赖链** | Lead Agent 用行号跳读 → 定位错误 → 生成错误代码 |
| 5 | **write-only 僵尸字段** | constitutionFusedAt, knownGaps 写了没人读 |
| 6 | **手动两步操作** | 用户忘记 /prd2json |
| 7 | **上下文爆炸** | 单对话 150-200KB |
| 8 | **PRDReview Enrich 维度过时** | 5 维度针对 slim prd.json，缺 fat dev.json 校验 |
| 9 | **逐题慢问** | 23-44 次交互，~30 分钟完整规划 |

---

## 3. 架构决策记录 (ADR)

### ADR-1: 两件套 + §7 不剥离

```
决策: prd.md 保留完整 §1-§8（含 §7），dev.json 为胖格式自给自足
替代方案:
  A. 两件套 + §7 剥离 — 被否决（增加复杂度，零收益）
  B. 三件套 (prd.md + dev.md + dev.json) — 被否决（dev.md 零消费方）
  D. 一件套 (prd.md 含 JSON) — 被否决（机读困难）
```

**理由**:

Fat dev.json 解决了"职责混乱"的核心痛点（Lead Agent 不再 skip-read §7）。§7 在 prd.md 中变成**惰性内容** — 没有 Agent 主动依赖它，但保留提供：

| 保留 §7 的价值 | 说明 |
|---------------|------|
| **容灾** | dev.json 损坏 → 从 prd.md §7 重跑 /prd2json 恢复 |
| **人类可读** | 开发者直接看 prd.md §7 了解计划，无需解析 JSON |
| **审查基准** | PRDReview 审查 prd.md 时 §7 提供完整上下文 |
| **简化 Pipeline** | 不需要剥离逻辑，不需要处理 §8 重编号 |

### ADR-2: 不生成 dev.md

```
决策: 不生成 dev.md，§7 保留在 prd.md 中
替代方案: 生成 dev.md 作为人类可读开发计划 — 被否决
```

**理由**: dev.md **没有独立消费方**。

| 潜在消费方 | 实际情况 |
|-----------|---------|
| Lead Agent | 读 dev.json，不读 dev.md |
| Testing/Coding/Finalize | 读 dev.json |
| BotoolAgent.sh | 读 dev.json |
| PRDReview | 读 prd.md（含 §7）|
| 人类 | 读 prd.md §7（同内容，已存在）|

零独立消费方 → dev.md 是纯冗余。三件套还带来同步负担。

### ADR-3: PRDing Ralph 模型（Background Agent 编排器）

```
决策: PyramidPRD Tf 完成后启动 Background Agent 编排器执行 A1+A2
管线: PyramidPRD(主对话) → Tf → Task(run_in_background) → [A1 → A2]
机制: Task 工具 (run_in_background: true, subagent_type: general-purpose)
编排器内部:
  - A1: Skill("prdreview") projectId=<id>
  - A2: Skill("prd2json") mode=<mode> projectId=<id> prerequisites=<deps>
降级: 编排器失败 → 通知用户手动运行 /prdreview → /prd2json
已验证: Task subagent 可调用 Skill 工具（spike 测试通过，见 §13 #1a）
```

**理由**:
- **Context 隔离**: PyramidPRD 主对话 ~50KB 结束，A1+A2 在独立 context 中执行（~245KB budget）
  - 对比旧方案 Skill chain: 主对话需承担 ~295KB（50+125+120），几乎必爆
- **非阻塞**: 用户确认 PRD 后 PyramidPRD 立即返回，background 自动完成 A1+A2
- **Ralph 模式一致性**: 与 Coding（BotoolAgent.sh）、Testing（自主验证）同为"确认后自主执行"模式
- PRDReview 前置确保 dev.json 基于最优版本 prd.md 生成
- 消除 PyramidPRD 和 PRD2JSON 职责重叠（PyramidPRD 不再写 prd.json/registry）
- chain 失败有明确降级路径（通知用户 + 打印恢复指令）

**A1→A2 文件交接（Context 安全设计）**:
- A1 PRDReview 的全部产出写入文件: prd.md(reviewed) + prd-review.json + prd-review-fixed.md
- A1 完成后，系统自动压缩 A1 会话轮次（~125KB → ~10KB 摘要）
- A2 PRD2JSON 从文件读取输入: prd.md(reviewed) + qa-journal.md，不依赖 A1 的 in-context 输出
- 实际 A2 可用 context ≈ 235KB，绰绰有余
- **不需要手动 /compact**（系统自动压缩在接近 context limit 时触发）

**自动模式行为调整**:
- PRDReview Circuit Breaker: auto-chain 中默认 accept + advisory（不阻塞管线）
- PyramidPRD Tf 完整性比对: 在 PRD 生成后立即执行（PRD2JSON 不再做源文件比对）
- 编排器失败时打印明确恢复指令: `请运行 /prdreview 然后 /prd2json`

### ADR-4: prd.md 写入权限分级

```
决策:
  主写入方: PyramidPRD（生成 prd.md）
  受控写入方: PRDReview（审查修复后可覆盖 prd.md，保留 v1 UX）
  只读消费方: PRD2JSON（不再修改 prd.md）
```

**理由**（本 DRAFT 的核心新决策）:

v1 中 prd.md 有三个修改方，导致文件状态不可预测（见 §1.2）。v2 将写入权限从"三方随意写"收紧为"分级管控"：

**PRD2JSON 当前修改行为 → 改为只读**:
```
v1 (修改 prd.md):
  1. 读 prd.md §7
  2. 扫描 rules/ → 用户确认
  3. 注入 [规范] 条目到 prd.md §7  ← 副作用！
  4. 行号全变 → 必须重新扫描 prdSection  ← 脆弱！
  5. 从修改后的 prd.md 提取 → 生成 prd.json

v2 (只读 prd.md):
  1. 读 prd.md §7（只读）
  2. 扫描 rules/ → 用户确认
  3. 生成 dev.json，在生成过程中直接将 [规范] 注入 AC[]
     → prd.md 不被修改，零副作用
```

**PRDReview 保留覆盖能力（优先 UX）**:
```
v1 (可修改 prd.md):
  Codex 审查 → Claude 修复 → review-save API 覆盖 prd.md

v2 (保留覆盖，优先 UX):
  Codex 审查 → Claude 修复 → 用户确认采纳
  → 覆盖 prd.md（标记为 reviewed 版本）
  → 同时保留 prd-review-fixed.md（修复 diff 记录）
  → 如果 PRD2JSON 已运行，提示用户重跑 /prd2json 以同步 dev.json
```

**核心原则**:
- PRD2JSON 对 prd.md 零写入（消除 [规范] 注入副作用 + 行号漂移）
- PRDReview 保留覆盖能力以维持 UX 流畅度，但覆盖后需提示下游同步
- 相比 v1 三方随意写，v2 收紧到两方（PyramidPRD 主写 + PRDReview 受控写），PRD2JSON 完全只读

### ADR-5: Q&A Journal 持久化

```
决策: 每层问答结束后写入 qa-journal.md，下层从文件恢复上下文
路径: tasks/<projectId>/qa-journal.md
```

**理由**: 解决上下文膨胀。每层上下文从线性累积（~150KB）降到 journal 文件(~3KB) + 当前层(~5KB) ≈ 8KB。

**Compact 恢复**: /compact 发生在 L2 和 L3 之间 → L3 只需 Read qa-journal.md 恢复 L0-L2 全部上下文。

### ADR-6: Subagent 管线（重活委派）

```
决策: 代码扫描、PRD 生成、Transform 源文件分析委派给 subagent
主对话只做: 编排 + 用户交互 (AskUserQuestion)
```

**不能委派的（需用户交互）：**
- P0 模式选择、L0-L5 问答、R1 规范确认、L5 确认门控、Transform Tq 补充问答

**可委派的：**

| 阶段 | Subagent 类型 | 输入 → 输出 | 主对话节省 |
|------|-------------|-------------|-----------|
| S1 代码扫描（全模式共享） | `Explore` | 项目目录 → `codebase-scan.md` | 30-50KB |
| G1/W1 PRD 生成 | `general-purpose` | journal + scan → `prd.md` | 10-30KB |
| Transform Ti+Ta 源文件分析 | `Explore` | 源 PRD → `source-analysis.md` | 50-100KB |
| Transform Tf 比对 | `general-purpose` | 源 PRD + 生成 PRD → 比对报告 | 15-30KB |

### ADR-7: 大文件 Master Context + Phase Bundle

```
决策:
  < 2000 行 → 当前 Transform 流程（Journal + Subagent 优化后够用）
  2000-5000 行 → 单源多遍抽取（C2，4 个 Explore subagent 按维度提取）
  > 5000 行 → Master Context + Phase Bundle（C1，自包含分包 + 并行处理）
```

### ADR-8: PRDReview 覆盖保留 + Enrich 升级

```
决策: PRDReview 保留 review-save API 覆盖 prd.md 的能力（优先 UX）
修复内容同时写入 prd-review-fixed.md（修复 diff 记录）
覆盖后提示用户: 如 PRD2JSON 已运行，需重跑 /prd2json 同步 dev.json
Enrich 审查目标从 prd.json → dev.json，新增 3 个审查维度
PRDReview 内部审查逻辑（Codex 敌对循环、降级模式、Circuit Breaker）保持不变
```

**理由**:

1. **优先 UX**: 用户发现审查问题后应能一键修复，而非手动 copy-paste
2. **v1 行为保留**: 不引入 UX 退化，降低用户迁移成本
3. **下游同步提示**: 覆盖 prd.md 后如果 dev.json 已存在，提示重跑 /prd2json
4. **Enrich 模式现有 5 维度不足**: 缺少 dev.json 新字段的完整性检查

**Enrich 审查维度更新**:

| 维度 | v1 (prd.json) | v2 (dev.json) | 变化 |
|------|-------------|-------------|------|
| syntax | 代码示例语法 | 不变 | — |
| dependency | dependsOn 无环 | 不变 | — |
| filepath | filesToModify 路径 | `files[]` 字段 | 字段改名 |
| eval | shell 命令有效 | 不变 | — |
| session | ≤ 8 DT/session | 不变 | — |
| **field-completeness** | — | 🆕 每个 DT 有 description(≥2句), AC[](≥3条), designRefs[](≥1条) | 新增 |
| **designRef-validity** | — | 🆕 designRefs "§X.Y 名称" 在 prd.md 中实际存在 | 新增 |
| **prd-dev-consistency** | — | 🆕 prd.md §7 DT 数量/Phase 结构与 dev.json 一致 | 新增（第 8 维度） |

**PRDReview 内部保留不变的功能**:
- Codex `exec --full-auto` 敌对审查引擎
- 3 轮敌对循环（Mode A 修复 + Mode B 驳回论证）
- Circuit Breaker（3 轮上限 + 用户决策：手动处理/记录advisory/停止）
- Codex 不可用时的 Claude-only 降级模式
- fail-closed 原则（输出无法解析 ≠ 无问题）
- PRD 审查 5 维度（完整性/一致性/可实现性/安全性/UX）
- 临时文件清理

### ADR-9: 方案卡批量确认（问答加速）

```
决策: L1-L4 每层的多个 AskUserQuestion 合并为 1 个方案卡
每个问题强制含 AI 推荐，用户可全部接受或精准修改
L0 方向探索和 L5 确认门控保持不变（战略决策/最终确认不适合批量化）
逃生口: 每张方案卡含"方向不对，重新生成"选项，用户可推翻整体方向
回显确认: 修改指令解析后必须先回显再执行，避免误解析
适用模式: 完整规划(L1-L4)、功能开发(L1+L4)、Transform(Tq 补充方案卡)
```

### ADR-10: R1 规范确认前置（从 PRD2JSON 移至 PyramidPRD，全模式共享）

```
决策: 将规范（rules/）扫描和用户确认环节从 PRD2JSON 移至 PyramidPRD
位置: 代码扫描(S1) 之后的 R1 阶段（全模式共享）
  完整规划 / 功能开发: S1 → R1 → L1 方案卡
  Transform: Ti → S1 → R1 → Ta 结构发现
确认结果写入 qa-journal.md，PRD2JSON 直接读取（零交互）
目的: 让 PRD2JSON 成为完全自动化的 A2 阶段（用户确认 PRD 后全自动）
```

**理由**:
- 用户在 PRD 生成前确认规范 → 规范可融入 PRD §6/§7 内容
- **三种模式统一**: 不管是原创还是导入，PRD 都需要遵守项目规范
- PRD2JSON 不再需要任何用户交互 → 支持全自动管线
- 规范选择写入 journal → compact 安全 + 下游可读

v1 逐题问答模式要求 23-44 次交互，耗时 30-45 分钟。核心洞察：

| 场景 | 概率 | 交互方式 |
|------|------|---------|
| 全部接受 AI 推荐 | ~80% | 1 次点击 |
| 精准修改 1-2 项 | ~15% | 输入 "Q3 换 B" |
| 完全重新选择 | ~5% | 自由文本说明 |

**交互次数对比**:

| 层级 | v1(逐题) | v2(方案卡) |
|------|---------|-----------|
| Phase 0 模式选择 | 1 次 | 1 次 |
| L0 方向探索 | 2-3 次 | 2 次 |
| L1 核心识别 | 4-7 次 | **1 次** |
| 代码扫描 | 0 次 | 0 次 |
| L2 领域分支 | 5-12 次 | **1 次** |
| L3 细节深入 | 5-12 次 | **1 次** |
| L4 边界确认 | 4-7 次 | **1 次** |
| L5 确认门控 | 2 次 | 2 次 |
| **总计** | **23-44 次** | **~9 次** |

**时间估算**:
- v1 完整规划: ~30-45 分钟
- v2 方案卡: ~8-12 分钟
- v2 功能开发: ~5-8 分钟

---

## 4. 核心方案详细设计

### 4A. 文档架构 — dev.json 胖格式

#### 4A.1 dev.json Schema

```json
{
  "project": "string (必填)",
  "branchName": "string (必填)",
  "description": "string (必填)",
  "prdFile": "tasks/<id>/prd.md (必填)",
  "prerequisites": [],
  "sessions": [],
  "constitution": {
    "rules": [
      {
        "id": "rule-001",
        "name": "string",
        "category": "string",
        "file": "rules/xxx.md",
        "checklist": ["string"]
      }
    ],
    "ruleAuditSummary": ""
  },
  "devTasks": [
    {
      "id": "DT-001",
      "title": "string (必填)",
      "priority": 1,
      "passes": false,
      "dependsOn": [],
      "description": "string (必填, ≥2 句话完整描述)",
      "acceptanceCriteria": [
        "关键字段 xxx 存在于 CREATE TABLE",
        "[规范] 所有请求带 apikey header",
        "Typecheck passes"
      ],
      "designRefs": ["§4.2 数据模型概览", "§3.3 状态机"],
      "files": ["sql/04_versions.sql (可选)"],
      "evals": [{ "type": "code-based", "command": "npx tsc --noEmit", "expect": "exit-0" }],
      "testCases": [
        { "type": "typecheck", "desc": "TypeScript 编译通过" },
        { "type": "e2e", "desc": "...", "playwrightMcp": { "url": "/admin", "steps": [...] } }
      ],
      "steps": [{ "action": "create", "file": "...", "description": "..." }]
    }
  ]
}
```

#### 4A.2 与当前 prd.json 的关键变化

| 字段 | 当前 prd.json | 新 dev.json | 变化说明 |
|------|--------------|-------------|---------|
| `DT.prdSection` | ✅ 行号指针 | ⛔ **删除** | 被 designRefs 替代 |
| `DT.description` | 可选 | 🔼 **必填** | Lead Agent 直接读，无需跳读 |
| `DT.acceptanceCriteria[]` | 可选 | 🔼 **必填** | 字段级 + [规范] 条目 |
| `DT.designRefs[]` | ❌ | 🆕 **必填** | 标题关键词格式 "§X.Y 名称"，抗行号漂移 |
| `DT.files[]` | ❌ | 🆕 可选 | 预期产出文件 |
| `constitutionFusedAt` | ✅ | ⛔ 删除 | write-only，零消费方 |
| `knownGaps[]` | ✅ | ⛔ 删除 | 改写入 prd-completeness-report.md |

#### 4A.3 规范融合流程（PRD2JSON 内部，全自动，只读 prd.md）

```
Step A: 从 qa-journal.md 读取 R1 规范确认结果
  → journal 中有 "## R1 规范确认" 段落，含已确认的规范列表
  → 无 journal / 无 R1 段落 → 扫描 rules/ 目录，自动保留全部（零交互）

Step B: 读取规范 + 生成 constitution
  每条规范: Read → 提取 3-8 条 checklist → 写入 constitution.rules

Step C: 生成 dev.json 时融合规范
  对每个 DT:
    根据关键词匹配适用规范 (API→API_Rules, DB→DB_Rules, etc.)
    在 acceptanceCriteria[] 中追加 "[规范] 具体条目"
  → prd.md 不被修改（只读消费方）
  → 全程零用户交互（规范已在 R1 确认）
```

#### 4A.4 双写策略 + 17 项 Checklist

**双写目标**:
```
主文件: tasks/<id>/dev.json
兼容副本: ./dev.json (根目录, BotoolAgent.sh / Lead Agent 读取)
```

**Checklist Before Saving（17 项，任一失败 → 拒绝保存）:**

1. Previous run archived（旧 prd.json/dev.json 且 branchName 不同 → archive/）
2. prdFile 指向正确 PRD 路径
3. **每个 DT 有 description（≥ 2 句话）**
4. **每个 DT 有 acceptanceCriteria[]（≥ 3 条）**
5. **每个 DT 有 designRefs[]（≥ 1 条）**
6. Each task completable in one iteration
7. Tasks ordered by dependency
8. Every task has at least one eval（typecheck）
9. Sessions max 8 tasks
10. **规范融合完成**: 有 rules/ 时每个匹配 DT 有 [规范] AC
11. Constitution 使用 file+checklist（3-8 条）
12. Steps 颗粒度（3-6 步）
13. **testCases 非空**: 每个 DT 至少 typecheck；UI/API DT 至少 e2e
14. **playwrightMcp 已注入**: e2e 必须 playwrightMcp；steps 3-8；url 相对路径
15. registry.json 已更新（devJson 字段）
16. **field-completeness**: 每个 DT 的 description(≥2句), AC[](≥3条), designRefs[](≥1条) 均达标
17. **designRef-validity**: 每个 designRefs "§X.Y 名称" 在 prd.md 中实际存在

#### 4A.5 testCases + playwrightMcp 规则（保留不变）

| 任务类型 | 触发条件 | 必须包含 |
|---------|---------|---------|
| typecheck | 所有 DT | `{ type: "typecheck", desc: "..." }` |
| e2e | 涉及 UI/API 的 DT | `{ type: "e2e", playwrightMcp: { url, steps[] } }` |
| unit | 涉及纯逻辑的 DT | `{ type: "unit", desc: "...", tdd: true }` |

playwrightMcp 8 种 action: navigate / snapshot / click / fill / wait_for / assert_visible / assert_not_visible / screenshot

**关键约束（保留不变）**:
- testCases 生成必须先读取 PRD 内容（prdSection/designRefs），再推导具体 testCases
- testCases.desc 必须具体描述该 DT 的实际行为，禁止泛泛"功能正常"
- 空 testCases → 拒绝保存 dev.json

#### 4A.6 完整性比对（已移至 PyramidPRD Tf）

- **执行位置**: PyramidPRD Tf 阶段（G1/W1 PRD 生成后、A1 PRDReview 前）
- **职责归属**: PyramidPRD 负责 prd.md 质量，PRD2JSON 不再做源文件比对
- 触发条件: Transform 模式有 SOURCE_PRD.ref 时自动执行；原创模式（完整规划/功能开发）有 DRAFT.md 时自动执行
- 对比维度: 数据表（字段级）、功能点、API 端点、业务规则、Phase 完整性
- 报告输出: `prd-completeness-report.md`（由 PyramidPRD 写入）
- FAIL → 自动补充 prd.md（Tf 有写入权限）→ 重新校验（最多 2 轮）
- **设计理由**: Tf 位于 PyramidPRD 内部，可直接修改 prd.md；若放在 PRD2JSON 则违反只读原则（ADR-4）

---

### 4B. 管线主权重构 — 每个 Skill 的读写边界

**核心原则**: 每个文件有明确的写入方，消除无序多方写入。

#### 4B.1 文件主权矩阵（v2）

| 文件 | 写入方 | 只读消费方 | v1 对比 |
|------|-------|-----------|---------|
| `prd.md` | PyramidPRD(主), PRDReview(受控覆盖) | PRD2JSON, Lead(designRefs), 人类 | v1: 三方可写 → v2: 两方分级写(PRD2JSON 只读化) |
| `dev.json` | PRD2JSON | Lead, Testing, Coding, Finalize, BotoolAgent.sh, PRDReview(Enrich审查) | v1: prd.json 两方写 → v2: 一方写 |
| `registry.json` | PRD2JSON(初始化), Finalize(status更新) | Coding, BotoolAgent.sh, Viewer | v1: 两方写 → v2: 两方分字段写(不重叠) |
| `prd-review.json` | PRDReview | 人类, Viewer UI | 不变 |
| `prd-review-fixed.md` | PRDReview | 人类 | 修复 diff 记录（覆盖 prd.md 时同步产出） |
| `prd-completeness-report.md` | PyramidPRD(Tf) | 人类 | v2: 写入方从 PRD2JSON 移至 PyramidPRD Tf |
| `progress.txt` | PRD2JSON(重置), Lead Agent(append), BotoolAgent.sh(append) | Viewer | v2: PRD2JSON 项目初始化重置，Lead Agent+BotoolAgent.sh 开发期追加 |
| `agent-status` | BotoolAgent.sh | Finalize, Viewer | 不变 |
| `PROJECT.md` | PyramidPRD (代码扫描) | 人类 | 不变 |

#### 4B.2 三个 Skill 改后的读写行为

**PyramidPRD（改后）**:
```
READ:  项目代码库（Glob/Grep/Read）
       rules/*.md (R1 规范确认)
       源 PRD（Transform 模式）
WRITE: prd.md (唯一写入方)
       qa-journal.md (中间产物，含 R1 规范确认结果)
       codebase-scan.md (Subagent 产出)
       PROJECT.md (代码库元数据)
       SOURCE_PRD.ref, prd_original.md (Transform)
       prd-completeness-report.md (Tf 完整性比对报告)
⛔ 不写: prd.json, registry.json (移交 PRD2JSON)
AUTO-CHAIN → Task(run_in_background) → 编排器 Agent [A1 PRDReview → A2 PRD2JSON]
  PyramidPRD 主对话在 Tf 后立即返回，A1+A2 在独立 context 中执行
```

**PRDReview（改后 — A1 自动审查）**:
```
READ:  prd.md (PRD 审查模式)
       dev.json (Enrich 审查模式, 只读) ← 仅独立运行时
       rules/*.md (规范审查)
WRITE: prd-review.json (审查报告)
       prd-review-fixed.md (修复 diff 记录)
       prd.md (受控覆盖: 审查修复后覆盖，标记为 reviewed 版本)
⛔ 不写: dev.json (审查不修改, 只报告)
AUTO-CHAIN 模式: Circuit Breaker 默认 accept + advisory（不阻塞管线）
独立运行模式: 保留完整用户交互 + Codex 敌对循环
保留: Codex 敌对循环、降级模式、Circuit Breaker、fail-closed 原则
```

**PRD2JSON（改后 — A2 自动转换）**:
```
READ:  prd.md §7 (只读, 零副作用)
       qa-journal.md → R1 规范确认结果（零用户交互）
       rules/*.md
WRITE: dev.json (双写: tasks/<id>/ + 根目录)
       registry.json
       progress.txt (重置)
       archive/ (旧文件归档)
⛔ 不写: prd.md (v2 核心变化)
⛔ 不写: prd-completeness-report.md (v2 移至 PyramidPRD Tf)
⛔ 不读: SOURCE_PRD.ref (完整性比对已移至 PyramidPRD Tf)
⛔ 不问: 零用户交互（规范已在 R1 确认）
保留: Viewer 模式检测 + dev server 启动能力（提示文字更新）
```

#### 4B.3 Pipeline 顺序明确化

**CLI 链路（v2 推荐顺序 — Ralph 自动管线）**:
```
┌─────────────────────────────────────────────────┐
│         用户交互区（Human-in-the-loop）              │
│                                                 │
│  PyramidPRD 主对话 (~50KB)                       │
│    P0 模式选择 → L0 方向 → S1 代码扫描           │
│    → R1 规范确认 → L1-L4 方案卡 → L5 确认门控    │
│    → G1/W1 PRD 生成 → Tf 完整性门控              │
│                                                 │
│  ✅ PyramidPRD 返回，用户可继续其他工作            │
│                                                 │
├─────────────────────────────────────────────────┤
│    PRDing Ralph（Background Agent 编排器）     │
│    独立 context (~245KB budget)                  │
│                                                 │
│  A1: PRDReview (自动审查)                         │
│    → Codex 敌对审查 → 修复 → 覆盖 prd.md (reviewed) │
│    → Circuit Breaker: 默认 accept + advisory     │
│                                                 │
│  A2: PRD2JSON (自动转换)                          │
│    → 读 prd.md(reviewed) + journal(R1规范)       │
│    → 生成 dev.json (fat) + registry.json          │
│    → 17 项 Checklist 校验（含 designRef-validity）│
│                                                 │
│  完成 → 通知用户 "PRD 审查+转换完成"               │
│  失败 → 通知用户 + 打印恢复指令                     │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Ralph 模型设计要点**:
- PyramidPRD 在 Tf 后启动 `Task(run_in_background: true)` 编排器，主对话立即返回
- 编排器在独立 context 中顺序执行 A1 → A2（零用户交互）
- Context 隔离: 主对话 ~50KB，编排器 ~245KB，互不干扰
- PRDReview 先修复 prd.md → PRD2JSON 转换最优版本
- 与 Coding Ralph（BotoolAgent.sh）、Testing Ralph 模式一致："确认后自主执行"
- 失败降级: 编排器打印 `请运行 /prdreview 然后 /prd2json` 恢复指令

**独立运行 PRDReview（auto-chain 外）**:
```
用户手动 /prdreview → 完整用户交互 + Codex 敌对循环
  ├─ PRD 审查: 检查 prd.md 质量（可覆盖 prd.md）
  ├─ Enrich 审查: 检查 dev.json 完整性（8 维度）
  └─ 覆盖 prd.md 后提示: 重跑 /prd2json 同步 dev.json
```

**Viewer 链路（Stage 2，本 PRD 范围外）**:
```
PRD 编写 → PRDReview(PRD审查) → PRD2JSON(转换) → PRDReview(Enrich审查)
```
Viewer 保持两段审查模式，PRDReview 保留覆盖 prd.md 能力。

---

### 4C. 执行引擎升级 — PyramidPRD 鲁棒性

#### 4C.1 Q&A Journal 持久化

**路径**: `tasks/<projectId>/qa-journal.md`

**格式**:
```markdown
# Q&A Journal — [项目名]
> 模式: 功能开发 | 复杂度: 中等

## L0 方向探索
- 选定方向: 方向 A — [一句话]
- 实现思路: [技术方案]
- 范围: ✅ [要做] / ❌ [不做]
- 技术栈: Next.js + TypeScript + Prisma

## S1 代码扫描摘要
> 来源: codebase-scan.md (Subagent 产出)
- 技术栈: [框架 + 语言 + 数据库]
- 关键模块: [组件列表]
- 已有 API: [端点列表]

## R1 规范确认
- 已确认规范:
  - rules/backend/api-rules.md ✅
  - rules/frontend/ui-rules.md ✅
  - rules/testing/e2e-rules.md ✅
- 排除: 无
- 确认方式: 全部保留(推荐)

## L1 方案卡
- Q1 问题域: A — [选定答案]
- Q2 目标用户: A — [选定答案]
- Q3 核心价值: A — [选定答案]
- Q4 规模预期: A — MVP
- 修改: 无 / "Q3 换 B"

## L2 方案卡
- Q1 页面结构: B — 管理面板
- Q2 API 设计: A — RESTful
...
```

**流程变化**:
```
v1（无持久化）:
  L0(上下文) → L1(上下文) → L2(上下文) → ... → 线性膨胀 ~150KB

v2（Journal 持久化 + 三步自动管线）:
  L0 → Write journal  →  每层上下文 ≈ 8KB
  S1: Explore Subagent → codebase-scan.md
  R1: 扫描 rules/ → 用户确认 → Write journal（规范选择）
  L1: Read journal → 方案卡确认 → Write journal
  L2: Read journal → 方案卡确认 → Write journal
  ...
  G1/W1: Read journal + scan → Subagent 生成 prd.md
  A1: Skill("prdreview") → 自动审查 → prd.md(reviewed)
  A2: Skill("prd2json") → 读 journal(R1) → dev.json
```

#### 4C.2 Subagent 管线架构

**完整规划 / 功能开发：**
```
主对话（精简编排器, 上下文控制在 ~50KB）
  │
  ├─ P0: 模式选择 ──────── 主对话 (AskUserQuestion)
  ├─ L0 方向探索 ────────── 主对话 (AskUserQuestion → Write journal)
  ├─ S1 代码扫描 ─────────── Explore Subagent ⚡ → codebase-scan.md
  ├─ R1 规范确认 ─────────── 主对话 (扫描 rules/ → AskUserQuestion → Write journal)
  ├─ L1-L4 方案卡确认 ──── 主对话 (每层 Read journal → 方案卡 → Write journal)
  ├─ Phase 5.5 外部依赖 ── 主对话 (prerequisites → Write journal)
  ├─ L5 确认门控 ─────────── 主对话 (Read journal + scan → ASCII → Ask)
  ├─ G1/W1 PRD 生成 ─────── general-purpose Subagent ⚡ → prd.md
  ├─ Tf 完整性门控 ────────── general-purpose Subagent ⚡ → 比对+自动补充+report
  │                          （有 DRAFT.md 时执行，否则跳过）
  │
  └─ Task(run_in_background) → PRDing Ralph 编排器 ⚡⚡
       │  独立 context (~245KB budget)
       ├─ A1 自动审查 ─── Skill("prdreview") → prd.md(reviewed)
       └─ A2 自动转换 ─── Skill("prd2json") → dev.json
```

**Transform（导入模式）：**
```
主对话（精简编排器, 上下文控制在 ~60KB）
  │
  ├─ P0: 模式选择 ──────── 主对话 (AskUserQuestion)
  ├─ Ti 源文件获取 ────────── 主对话 (验证源 PRD + 预扫描基准)
  ├─ S1 代码扫描 ─────────── Explore Subagent ⚡ → codebase-scan.md ← 🆕 统一
  ├─ R1 规范确认 ─────────── 主对话 (扫描 rules/ → AskUserQuestion → Write journal) ← 🆕 统一
  ├─ Ta 结构发现 ─────────── Explore Subagent ⚡ → source-analysis.md
  ├─ Tv 完整性校验 ────────── 主对话 (大文件必执行)
  ├─ Tq 覆盖度+补充问答 ── 主对话 (方案卡, 仅 PARTIAL/SPARSE 维度)
  ├─ Tg DT 分解 ──────────── 主对话 (Phase→DT 拆解, 参考 S1 结果)
  ├─ Phase 5.5 外部依赖 ── 主对话 (prerequisites → Write journal) ← 🆕 统一
  ├─ L5 确认门控 ─────────── 主对话 (Read journal + scan → ASCII → Ask)
  ├─ G1/W1 PRD 生成 ─────── general-purpose Subagent ⚡ → prd.md
  ├─ Tf 完整性门控 ────────── general-purpose Subagent ⚡ → 比对+自动补充+report
  │
  └─ Task(run_in_background) → PRDing Ralph 编排器 ⚡⚡
       │  独立 context (~245KB budget)
       ├─ A1 自动审查 ─── Skill("prdreview") → prd.md(reviewed)
       └─ A2 自动转换 ─── Skill("prd2json") → dev.json
```

**三模式共享阶段一览：**
```
P0 → S1 → R1 → [模式特定] → Phase 5.5 → L5 → G1/W1 → Tf → [Ralph: A1 → A2]
                                                              └─ background
```

**预估效果：**
- 完整规划模式: ~150KB → ~40-50KB（主对话），A1+A2 独立 ~245KB
- Transform 模式: ~200KB+ → ~50-60KB

---

### 4D. 大文件 Transform 架构

#### 4D.0 按大小分档处理

| 源 PRD 大小 | 处理策略 | 说明 |
|------------|---------|------|
| < 2000 行 | 当前 Transform 流程 | Journal + Subagent 优化后够用 |
| 2000-5000 行 | C2 单源多遍抽取 | 4 个 Explore subagent 按维度提取 |
| > 5000 行 | C1 Master Context + Phase Bundle | 自包含分包 + 并行处理 |

#### 4D.1 C1: Master Context + Phase Bundle（> 5000 行）

```
第一遍: Explore Subagent → master-context.md (~500 行)
  - 项目概述（压缩为摘要）
  - 全部 CREATE TABLE（完整保留，不压缩）
  - 架构设计（状态机、角色权限矩阵 — 完整）
  - 全局业务规则（跨 Phase 约束 — 完整）
  - 技术栈声明

第二遍: 按 Phase 创建自包含分包
  对源 PRD 每个 Phase（或 2-3 个相关 Phase 合并）:
    phase-bundle-N.md = master-context.md (完整嵌入)
      + Phase N 原文 (完整)
      + Phase N 引用的表定义 (精选)
      + Phase N 引用的业务规则 (精选)
      + Phase N 引用的 UI 设计 (精选)
    每个分包 ~800-1300 行

第三遍: 并行 Subagent 处理
  主对话并行启动 N 个 general-purpose Subagent:
    Subagent-1: phase-bundle-1.md → prd-phase-1.md
    Subagent-2: phase-bundle-2.md → prd-phase-2.md
    ...

第四遍: 合并校验
  合并所有 prd-phase-N.md → 最终 prd.md:
    - §1: 取 Phase-1 版本
    - §4: 去重合并所有 CREATE TABLE
    - §6: 合并所有规则（去重）
    - §7: 按 Phase 顺序拼接所有 DT
    - 冲突检测 + CREATE TABLE 完整性 + 行数校验
```

#### 4D.2 C2: 单源多遍抽取（2000-5000 行）

```
Explore Subagent A: 提取 §4 数据设计 → data-extraction.md
Explore Subagent B: 提取 §3+§6 架构+规则 → arch-rules-extraction.md
Explore Subagent C: 提取 §5+§8 UI+附录 → ui-appendix-extraction.md
Explore Subagent D: 提取 §7/§9 开发计划 → plan-extraction.md

主对话: Read 4 个提取文件 → L5 确认 → Subagent 生成 PRD
```

---

### 4E. 问答加速 — 方案卡批量确认

#### 4E.1 方案卡核心设计

**每层问答从 N 个 AskUserQuestion 合并为 1 个方案卡。** 方案卡在 question 文本中列出所有问题、所有选项和 AI 推荐，用户只需选择「全部接受」或输入修改指令。

**方案卡模板（以 L2 为例）**:

```
【L2: 领域分支 — AI 方案卡】

基于: [L0方向] + [L1核心] + [代码扫描结果]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 Q1. 页面结构
   A) 单页应用 — 全部功能在一个页面内
   B) 管理面板 — 左侧导航 + 右侧内容区  ← 匹配现有 viewer
   C) 多标签页 — 顶部 Tab 切换不同功能区
   → AI 选择: B

 Q2. API 设计模式
   A) RESTful 路由 (GET/POST/PUT/DELETE)  ← 匹配现有 /api/
   B) Server Actions (Next.js 14 内置)
   C) tRPC 端到端类型安全
   → AI 选择: A

 Q3. 认证方式
   A) JWT + httpOnly cookies  ← 匹配现有项目 auth
   B) Session 认证
   C) OAuth 第三方登录
   D) 无需认证
   → AI 选择: A

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
要修改请在下方 Type something 中输入如 "Q3 换 B"
```

#### 4E.2 AskUserQuestion UI 适配

Claude Code 的 AskUserQuestion 有固定 UI 元素（Type something / Chat about this），因此方案卡的 options **放 3 个选项**（含逃生口）：

```
UI 显示效果:
  1. 全部接受 (推荐)                  ← 80% 用户直接选
  2. 方向不对，重新生成                ← 逃生口，AI 重出方案卡
  3. ↓ 请在下方 Type something 输入修改  ← 引导到 Other
  4. Type something.                   ← 用户输入 "Q3 换 B"
  5. Chat about this                   ← 内置，忽略
```

**AskUserQuestion 结构**:
```json
{
  "questions": [{
    "question": "【方案卡内容（含全部 Q、ABCD 选项、AI 推荐标记）】\n\n━━━━━━\n要修改请在下方 Type something 中输入如 \"Q3 换 B\"",
    "header": "L2 领域分支",
    "options": [
      { "label": "全部接受 (推荐)", "description": "按 AI 推荐方案继续" },
      { "label": "方向不对，重新生成", "description": "补充说明后 AI 重新出方案卡" },
      { "label": "↓ 请在下方 Type something 输入修改", "description": "如 'Q3 换 B' 或 'Q4 换 C, Q6 换 B'" }
    ],
    "multiSelect": false
  }],
  "metadata": {
    "source": "pyramidprd",
    "level": 2,
    "levelName": "L2: 领域分支",
    "mode": "batch-confirm"
  }
}
```

**逃生口处理流程**:
```
用户选 "方向不对，重新生成"
  → AI: "请补充说明哪里不对，或您希望的方向是什么？"
  → 用户输入补充说明
  → AI 根据补充重新生成方案卡（同一层级，重新出题+推荐）
  → 最多重试 2 次，仍不满意 → 切换为逐题模式
```
```

#### 4E.3 AI 推荐选择规则

**强制规则：每个 Q 必须有且仅有一个 AI 推荐，无例外。**

| 优先级 | 依据来源 | 示例 |
|--------|---------|------|
| 1 | 代码库扫描 | 项目用 Prisma → 推荐 PostgreSQL + Prisma |
| 2 | L0 方向 + 前序层级回答 | 用户选"管理面板" → 推荐 DataTable |
| 3 | 行业最佳实践 | 无代码库 → 推荐当前主流方案 |
| 4 | 最安全/最简单 | 无法判断时 → 推荐最稳妥选项 |

**推荐标记格式**:
- 选项后标注 `← [推荐理由]`（简短）
- `→ AI 选择: X` 放在每题末尾

#### 4E.4 修改指令解析规则

| 用户输入 | 解析结果 |
|---------|---------|
| `Q3 换 B` | 第 3 题改为选项 B |
| `Q2 换 C, Q5 换 B` | 第 2 题改为 C，第 5 题改为 B |
| `第 3 个问题换成 B` | 同 Q3 换 B |
| `认证方式换成 Session` | 按关键词匹配到 Q3，选项匹配到 B |
| `Q4 我想用 MongoDB` | Q4 改为含 MongoDB 的选项 |
| `Q3 换 D, 补充: 需微信登录` | Q3 改为 D + 自由文本补充 |

**解析优先级**:
1. 精确格式 `QN 换 X` → 直接替换
2. 关键词匹配 → 找到对应 Q 和选项
3. 无法匹配 → 追问一次确认

**回显确认规则（强制）**:

修改指令解析后，AI **必须先回显解析结果，等用户确认后再执行**：
```
用户: "认证换 Session, 数据库用 Mongo"
AI: "收到修改：Q3 → B(Session认证), Q4 → C(MongoDB)，其余保持 AI 推荐。确认？"
  选项: [确认] / [重新输入]
用户: 确认
→ 写入 journal，进入下一层
```

虽然多一轮交互，但避免了误解析导致的连锁错误（错误的 L2 选择会污染 L3/L4 的推荐方向）。

#### 4E.5 问题分类：业务题 vs 技术题

| 分类 | 特征 | 方案卡表现 |
|------|------|-----------|
| **业务题** | 目标用户、核心价值、范围、业务规则 | 选项用业务语言，推荐基于用户需求 |
| **技术题** | API 类型、数据库、框架、认证 | 选项含技术名词，推荐理由用白话 `← 匹配你现有项目` |

**关键原则**：技术题不需要用户理解技术细节。方案卡让用户可以完全信任 AI 推荐，只在业务层面有意见时才修改。

#### 4E.6 各层方案卡适用范围

**完整规划 / 功能开发：**

| 层级 | v2 处理方式 | 说明 |
|------|-----------|------|
| P0 模式选择 | AskUserQuestion | 3 模式选择 |
| **L0 方向探索** | **markdown 预览** | 战略决策需架构预览 |
| S1 代码扫描 | 自动 (Explore Subagent) | 零交互 |
| **R1 规范确认** | **AskUserQuestion** | 扫描 rules/ → 用户确认 → 写入 journal |
| **L1 核心识别** | **方案卡** | 4-7 题合并为 1 卡 |
| **L2 领域分支** | **方案卡** | 5-12 题合并为 1 卡（完整规划 only） |
| **L3 细节深入** | **方案卡** | 5-12 题合并为 1 卡（完整规划 only） |
| **L4 边界确认** | **方案卡** | 4-7 题合并为 1 卡 |
| Phase 5.5 外部依赖 | 自动 | prerequisites → journal |
| **L5 确认门控** | **ASCII Tab** | 最终确认需可视化 |
| G1/W1 PRD 生成 | 自动 (Subagent) | 零交互 |
| A1 自动审查 | 自动 (Skill("prdreview")) | Circuit Breaker 默认 accept |
| A2 自动转换 | 自动 (Skill("prd2json")) | 零交互，Checklist FAIL → 拒绝保存 + 通知用户 |

**Transform（导入模式）：**

| 层级 | v2 处理方式 | 说明 |
|------|-----------|------|
| P0 模式选择 | AskUserQuestion | 3 模式选择 |
| Ti 源文件获取 | 主对话 | 验证源 PRD + 预扫描基准 |
| S1 代码扫描 | 自动 (Explore Subagent) | **统一** — 扫描目标项目代码库 |
| **R1 规范确认** | **AskUserQuestion** | **统一** — 扫描 rules/ → 用户确认 → journal |
| Ta 结构发现 | Explore Subagent | 源章节映射到 §1-§8 |
| Tv 完整性校验 | 主对话 | 大文件必执行 |
| **Tq 补充问答** | **方案卡** | 仅 PARTIAL/SPARSE 维度 |
| Tg DT 分解 | 主对话 | Phase→DT，参考 S1 代码扫描结果 |
| Phase 5.5 外部依赖 | 自动 | **统一** — prerequisites → journal |
| **L5 确认门控** | **ASCII Tab** | **统一** — T6 收敛 |
| G1/W1 PRD 生成 | 自动 (Subagent) | 充分摘录原则 |
| **Tf 完整性门控** | **Subagent** | **Transform 特有，大文件必执行；最终质控关卡（完整性比对+自动补充），A1/A2 前唯一修 prd.md 的机会** |
| A1 自动审查 | 自动 (Skill("prdreview")) | **统一** |
| A2 自动转换 | 自动 (Skill("prd2json")) | **统一** |

#### 4E.7 特殊模式方案卡

**Transform Tq 补充方案卡**（覆盖不足维度）:

```
【Transform Tq — AI 补充方案卡】

覆盖不足维度: §5 UI (PARTIAL), §6 规则 (SPARSE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
§5 补充:
  Q1. 页面数: A) 2个 ← 推断  B) 3个  C) 我来列
  → AI 选择: A

§6 补充:
  Q2. 删除策略: A) 软删除 ← 安全  B) 硬删除+确认
  → AI 选择: A
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 5. v2 全链路新管线

### 5.1 总览

```
┌──────────────────────────────────────────────────────┐
│  PyramidPRD 主对话 (~50KB)                              │
│                                                      │
│  P0 模式选择 (3 模式: 完整规划 / 功能开发 / Transform)    │
│  L0 方向探索 (markdown 预览)                            │
│  S1 代码扫描 → Explore Subagent → codebase-scan.md    │
│  R1 规范确认 → 扫描 rules/ → 用户确认 → 写入 journal    │
│  L1-L4 方案卡确认 (Read journal → 方案卡 → Write)       │
│  L5 确认门控 (ASCII Tab)                                │
│  G1/W1 PRD 生成 → Subagent → prd.md (§1-§8)           │
│  Tf 完整性门控 → Subagent → 比对+自动补充+report        │
│  ⛔ 不写 prd.json / registry                           │
│                                                      │
│  ✅ 主对话返回，用户可继续其他工作                         │
│                                                      │
├──────────────────────────────────────────────────────┤
│  PRDing Ralph 编排器 (Background Agent, ~245KB)     │
│                                                      │
│  A1: PRDReview (自动审查)                               │
│    READ: prd.md — PRD 审查 (5 维度)                     │
│    Codex 敌对循环 (max 3 轮)                            │
│    WRITE: prd-review.json + prd-review-fixed.md        │
│    WRITE: prd.md (覆盖为 reviewed 版本)                  │
│    Circuit Breaker: 默认 accept + advisory              │
│                                                      │
│  A2: PRD2JSON (自动转换, 零交互)                         │
│    READ: prd.md(reviewed) — 只读, 零副作用               │
│    READ: qa-journal.md → R1 规范确认结果                  │
│    GENERATE: dev.json (fat, 含 [规范] AC)                │
│    WRITE: dev.json (双写: tasks/<id>/ + 根目录)           │
│    WRITE: registry.json (devJson 字段)                   │
│    17 项 Checklist 校验（含 designRef-validity）          │
│    ⛔ 不做源文件比对（已由 Tf 完成）                        │
│                                                      │
│  完成 → 通知用户 "PRD 审查+转换完成"                      │
│  失败 → 通知 + 打印: 请运行 /prdreview 然后 /prd2json    │
│                                                      │
└──────────────────────────────────────────────────────┘

Lead Agent
  └─ READ: dev.json (自给自足)
     └─ 可选: designRefs → 标题关键词定位 prd.md 章节

其余消费方
  ├─ Testing:     READ dev.json (testCases, playwrightMcp)
  ├─ Coding:      READ dev.json (branchName)
  ├─ Finalize:    READ dev.json (branchName)
  └─ BotoolAgent.sh: READ dev.json (branchName, passes 统计)
```

**独立运行 PRDReview（auto-chain 外）**:
```
用户手动 /prdreview
  ├─ CHECK: pipeline.lock 存在? → 拒绝执行 + 提示"后台管线运行中"
  ├─ READ: prd.md — PRD 审查 (5 维度)
  ├─ READ: dev.json (只读) — Enrich 审查 (8 维度)
  ├─ Codex 敌对循环 (max 3 轮, 完整用户交互)
  ├─ WRITE: prd-review.json + prd-review-fixed.md
  └─ WRITE: prd.md (受控覆盖 → 提示重跑 /prd2json)
```

### 5.2 关键变化汇总

| # | 变化 | 效果 |
|---|------|------|
| 1 | prd.md 写入权限分级（PyramidPRD 主写 + PRDReview 受控写） | 从三方随意写收紧为两方分级写 |
| 2 | PRD2JSON 只读消费 prd.md | 消除 [規範] 注入副作用 |
| 3 | PRDReview 前置于 PRD2JSON（A1 → A2） | dev.json 基于最优 prd.md 生成，无需重跑 |
| 4 | dev.json 替代 prd.json (fat) | 消除 skip-read 脆弱性 |
| 5 | designRefs 替代 prdSection | 抗行号漂移 |
| 6 | 三步自动管线 | PyramidPRD → A1 PRDReview → A2 PRD2JSON，用户确认 PRD 后全自动 |
| 7 | Q&A Journal + Subagent | 上下文 ~150KB → ~50KB |
| 8 | 方案卡批量确认 | 交互 23-44 次 → ~9 次 |
| 9 | R1 规范确认前置 | 从 PRD2JSON 移到 PyramidPRD，PRD2JSON 零交互 |
| 10 | 模式精简 4→3 | 删除快速修复模式（完整规划 / 功能开发 / Transform） |
| 11 | PRDReview Enrich 新增 3 维度 | field-completeness + designRef-validity + prd-dev-consistency |
| 12 | 17 项 Checklist | 原 15 项 + field-completeness + designRef-validity |
| 13 | 三模式统一共享阶段 | S1+R1+Phase 5.5+L5+A1+A2 全模式共享，Transform 补齐 GAP |
| 14 | 完整性比对移至 PyramidPRD Tf | PRD2JSON 不再做源文件比对；Tf 在 PRD 生成后立即执行，FAIL → 自动补充 prd.md；职责清晰：PyramidPRD 管质量，PRD2JSON 管转换 |
| 15 | PRDing Ralph 模型 | A1+A2 由 Background Agent 编排器执行，PyramidPRD 主对话 Tf 后立即返回；context 隔离（~50KB vs ~245KB）；与 Coding/Testing Ralph 一致 |

---

## 6. 产物清单

### 6.1 永久产物

| 文件 | 唯一写入方 | 消费方 | 说明 |
|------|-----------|-------|------|
| `tasks/<id>/prd.md` | PyramidPRD(主), PRDReview(受控覆盖) | PRD2JSON(只读), Lead(designRefs), 人类 | §1-§8 完整设计+计划 |
| `tasks/<id>/dev.json` | PRD2JSON | Lead, Testing, Coding, Finalize, BotoolAgent.sh, PRDReview(Enrich只读) | 胖格式机读 DT |
| `./dev.json` | PRD2JSON | BotoolAgent.sh, Lead | 根目录兼容副本 |
| `tasks/registry.json` | PRD2JSON | Coding, BotoolAgent.sh, Viewer, Finalize | 项目注册表 |
| `tasks/<id>/prd-completeness-report.md` | PyramidPRD(Tf) | 人类 | Transform 完整性比对（v2 移至 Tf） |
| `tasks/<id>/prd-review.json` | PRDReview | 人类, Viewer UI | 审查报告 |
| `tasks/<id>/prd-review-fixed.md` | PRDReview | 人类 | 修复 diff 记录（覆盖 prd.md 时同步产出） |
| `PROJECT.md` | PyramidPRD | 人类 | 代码库元数据 |

### 6.2 中间产物（Pipeline 内部）

| 文件 | 生产方 | 消费方 | 生命周期 |
|------|-------|-------|---------|
| `tasks/<id>/qa-journal.md` | PyramidPRD 主对话 | PyramidPRD 各层 + PRD Subagent | 问答完成后保留（调试用）|
| `tasks/<id>/codebase-scan.md` | Explore Subagent | PRD Subagent + L5 确认 | 生成后保留 |
| `tasks/<id>/master-context.md` | Explore Subagent | Phase Bundle Subagent | 大文件模式，生成后可删 |
| `tasks/<id>/phase-bundle-N.md` | 主对话 | Transform Subagent | 大文件模式，合并后删除 |
| `tasks/<id>/source-analysis.md` | Explore Subagent | Transform L5 + PRD Subagent | Transform 模式 |
| `tasks/<id>/prd_original.md` | PyramidPRD Ti(导入) | Tf(字段校验) | Transform 模式备份 |
| `tasks/<id>/SOURCE_PRD.ref` | PyramidPRD Ti(导入) | PyramidPRD Tf(完整性比对) | 源路径引用 |

### 6.3 已废弃/不产生

| 文件/字段 | 原因 |
|----------|------|
| `prd.json` | 被 `dev.json` 取代 |
| `dev.md` | ADR-2: 零消费方，不生成 |
| `progress-*.txt` (旧命名) | 统一为 `progress.txt` |
| `constitutionFusedAt` 字段 | write-only，零消费方 |
| `knownGaps[]` 字段 | 改写入 prd-completeness-report.md |

---

## 7. 消费方影响分析

### CLI 层（本 PRD 范围）

| 消费方 | 当前读取 | 新读取 | 改动要点 |
|--------|---------|--------|---------|
| CLAUDE.lead.md | prd.json (slim+fat 双模式) | dev.json (fat-only) | 删 slim 模式 + prdSection；新增 designRefs 读取 |
| Testing SKILL | `tasks/<id>/prd.json` | `tasks/<id>/dev.json` | 路径替换；testCases/playwrightMcp 字段不变 |
| Coding SKILL | prd.json 路径 + branchName | dev.json | 路径替换 |
| Finalize SKILL | prd.json branchName | dev.json | 路径替换 |
| BotoolAgent.sh | prd.json (6 处硬编码) | dev.json | 全局替换 basename + PRD_FILE 变量 |
| PRDReview (PRD审查) | prd.md + 可覆盖 | prd.md (保留覆盖) | 覆盖后新增下游同步提示(重跑 /prd2json) |
| PRDReview (Enrich审查) | prd.json (5 维度) | dev.json (8 维度) | 路径替换 + 新增 3 维度 |

### Viewer 层（不在本 PRD 范围，单独 PRD）

18 个文件（11 API routes + 6 UI 组件 + project-root.ts）留 CLI 层完成后处理。

---

## 8. 开发计划

### 8.0 Phase 依赖图

```
Stream 1: 输出格式 + 管线主权             Stream 2: 执行引擎 + 问答加速
───────────────────────────              ─────────────────────────────
Phase 1 ──▶ Phase 2 ──▶ Phase 3         Phase 4 ──────────▶ Phase 5
PyramidPRD   PRD2JSON    消费方适配       Q&A Journal         大文件
auto-chain   fat dev.json (含PRDReview)  + Subagent          Transform
+ R1 规范前置  零交互化    + A1/A2 行为   + 方案卡 (P1)       (P2)
(P0)         (P0)        (P0)
                               \          /
                                ▼        ▼
                               Phase 6
                               端到端验证
                               (P1)

Stream 1 和 Stream 2 可并行推进（不互相依赖）
Phase 6 依赖 Stream 1 Phase 1-3 + Stream 2 Phase 4（至少 Journal）
```

### Phase 1: PyramidPRD auto-chain + R1 规范前置（P0, 4 DT）

> 改动文件: `skills/BotoolAgent/PyramidPRD/SKILL.md`
> 前置: 无
> 产出: 三步自动管线 + R1 规范确认 + 删除快速修复模式 + Transform T7 字段级校验

| DT | 标题 | 核心改动 |
|----|------|---------|
| DT-001 | Tf 后添加 PRDing Ralph 指令 | Tf 完成后 Task(run_in_background) → 编排器 [Skill("prdreview") → Skill("prd2json")]；**删除**直接写 prd.json (~L1002)；**删除**直接更新 registry (~L1003) |
| DT-002 | R1 规范确认 + S1/Phase 5.5 全模式统一 + 删除快速修复 | S1 后新增 R1（全模式共享，含 Transform）；Transform 新增 S1 代码扫描 + Phase 5.5 外部依赖；P0 从 4→3 模式；删除 Quick Fix 全部逻辑 |
| DT-003 | Transform Ti 备份 + Tf 字段级校验 | Ti cp → prd_original.md；Tf DT↔prd.md 交叉检查 + SQL 字段完整性 |
| DT-004 | Transform Tv 字段数校验 | 每读完 CREATE TABLE 记录字段数，Tv 对比字段数差异 |

### Phase 2: PRD2JSON 重构（P0, 6 DT）— 主工作

> 改动文件: `skills/BotoolAgent/PRD2JSON/SKILL.md`
> 前置: Phase 1
> 产出: PRD2JSON 变为 fat dev.json 生成器（prd.md 只读 + 零用户交互）

| DT | 标题 | 核心改动 |
|----|------|---------|
| DT-005 | 输出从 slim prd.json → fat dev.json | Schema 变更：移除 prdSection → 新增 description(必填), AC[](必填), designRefs[](必填), files[](可选)；删除 constitutionFusedAt/knownGaps |
| DT-006 | 规范融合全自动化 | 从 qa-journal.md 读取 R1 规范确认结果（无 journal → 自动保留全部）；[规范] 条目直接生成到 dev.json AC[]；**删除** Step 3 修改 prd.md 的全部逻辑；**删除**用户确认 AskUserQuestion |
| DT-007 | testCases/evals/steps/playwrightMcp/sessions 保留 | 验证现有逻辑在 dev.json 格式下正常工作；testCases 生成仍须先读 PRD 内容（通过 designRefs 替代 prdSection） |
| DT-008 | 双写 + Archiving + Checklist | prd.json → dev.json 双写；Archiving 检查旧 prd.json 和 dev.json；17 项 Checklist（完整性比对已移至 PyramidPRD DT-003 Tf） |
| DT-009 | registry.json 字段更新 | 新增 devJson，移除 prdJson，保留 prdMd |
| DT-010 | Viewer Mode 文字更新 | 提示文字 prd.json → dev.json；Viewer 模式检测 + dev server 启动逻辑保留 |

### Phase 3: 消费方适配（P0, 7 DT）

> 改动文件: Lead, Testing, Coding, Finalize, BotoolAgent.sh, PRDReview
> 前置: Phase 2
> 产出: 完整 CLI 链路读取 dev.json + PRDReview A1 自动模式 + Enrich 升级

| DT | 标题 | 核心改动 |
|----|------|---------|
| DT-011 | CLAUDE.lead.md — fat-only 模式 | 删 slim 模式 + prdSection；dev.json 为唯一路径；新增 designRefs 读取 |
| DT-012 | Testing SKILL — dev.json 路径 | PRD_PATH → dev.json，删 prd.json fallback |
| DT-013 | Coding SKILL — dev.json 路径 | 全局替换 prd.json → dev.json |
| DT-014 | Finalize SKILL — dev.json 路径 | 全局替换 |
| DT-015 | BotoolAgent.sh — 路径更新 | basename "prd.json" → "dev.json"；PRD_FILE 指向 dev.json（6 处） |
| DT-016 | PRDReview — A1 自动模式 + 独立运行模式 | auto-chain 中: Circuit Breaker 默认 accept + advisory；独立运行时: 保留完整用户交互 + 覆盖 prd.md + 下游同步提示；两种模式共用: Codex 敌对循环 / 降级模式 / fail-closed |
| DT-017 | PRDReview — Enrich 审查升级 | enrich 目标从 prd.json → dev.json；新增 field-completeness 维度（description≥2句/AC≥3条/designRefs≥1条）；新增 designRef-validity 维度（校验 §X.Y 在 prd.md 中存在）；新增 prd-dev-consistency 维度（prd.md §7 vs dev.json DT/Phase 一致性） |

### Phase 4: 执行引擎 + 问答加速（P1, 5 DT）

> 改动文件: `skills/BotoolAgent/PyramidPRD/SKILL.md`
> 前置: 无（可与 Stream 1 并行）
> 产出: PyramidPRD 上下文可控 + compact 安全 + 交互次数大幅降低

| DT | 标题 | 核心改动 |
|----|------|---------|
| DT-018 | Q&A Journal 持久化 | 每层结束 Write journal → 下层开始 Read journal；格式定义（含 R1 规范确认记录 + 方案卡选择记录） |
| DT-019 | 代码扫描 → Explore Subagent（全模式共享） | S1 改为 Task(Explore) 调用（三模式统一，含 Transform）；输出 codebase-scan.md；Transform 中 Tg DT 分解参考 S1 结果 |
| DT-020 | PRD 生成 → general-purpose Subagent | G1/W1 改为 Task(general-purpose) 调用；输入 journal + scan |
| DT-021 | L1-L4 方案卡批量确认 | L1/L2/L3/L4 每层逐题 AskUserQuestion → 1 个方案卡；强制 AI 推荐；修改指令解析（"QN 换 X"） |
| DT-022 | Transform Tq 补充方案卡 | Tq 针对性问答改为方案卡格式 |

### Phase 5: 大文件 Transform 架构（P2, 4 DT）

> 改动文件: `skills/BotoolAgent/PyramidPRD/SKILL.md`
> 前置: Phase 4（Q&A Journal + Subagent 基础）
> 产出: > 5000 行 PRD 可靠处理

| DT | 标题 | 核心改动 |
|----|------|---------|
| DT-023 | 大文件检测 + 阈值路由 | 源 PRD 行数检测；< 2000 / 2000-5000 / > 5000 分流 |
| DT-024 | C2 单源多遍抽取 | 4 个 Explore subagent 按维度提取；主对话合并 |
| DT-025 | C1 Master Context 提取 | Explore subagent → master-context.md |
| DT-026 | C1 Phase Bundle 分包 + 并行处理 + 合并 | 按 Phase 创建分包；并行 subagent 处理；合并校验 |

### Phase 6: 端到端验证（P1, 1 DT）

> 前置: Phase 1-3 + Phase 4（至少 Journal + 方案卡）
> 产出: botool-present-v16 验证通过

| DT | 标题 | 核心改动 |
|----|------|---------|
| DT-027 | 重新转换 botool-present-v16 | 验证: CREATE TABLE 字段 ≥ 95%，规则覆盖 ≥ 40%，dev.json fat 完整，T7 无假阳性，BotoolAgent.sh 启动正确，PRDReview Enrich 8 维度通过，方案卡交互 ≤ 10 次，Ralph 自动管线端到端通过 |

### DT 统计

| Phase | DT 数 | 优先级 | Stream |
|-------|-------|--------|--------|
| Phase 1: PyramidPRD auto-chain + R1 | 4 | P0 | 输出格式 |
| Phase 2: PRD2JSON 重构 | 6 | P0 | 输出格式 |
| Phase 3: 消费方适配 | 7 | P0 | 输出格式 + 管线主权 |
| Phase 4: 执行引擎 + 问答加速 | **5** | P1 | 执行引擎 |
| Phase 5: 大文件 Transform | 4 | P2 | 执行引擎 |
| Phase 6: 端到端验证 | 1 | P1 | 验证 |
| **合计** | **27** | | |

---

## 9. 业务规则

| ID | 规则 | 说明 | 影响 DT |
|----|------|------|---------|
| BR-001 | prd.md 保留完整 §1-§8 含 §7 | §7 不剥离，作为人类可读计划和容灾备份 | ALL |
| BR-002 | **prd.md 写入权限分级** | PyramidPRD 主写 + PRDReview 受控覆盖；PRD2JSON 只读 | DT-006, DT-016 |
| BR-003 | dev.json 每个 DT 必有 description + AC[] | ≥ 2 句话描述 + ≥ 3 条 AC | DT-005 |
| BR-004 | designRefs 替代 prdSection | "§X.Y 标题关键词" 抗漂移 | DT-005 |
| BR-005 | 旧项目不做兼容 | 旧 prd.json 归档 | DT-008 |
| BR-006 | ~~Quick Fix 也走 auto-chain~~ **已删除** | 快速修复模式已删除 | — |
| BR-007 | T7 字段级 + SQL 校验 | DT↔prd.md 交叉检查 | DT-003 |
| BR-008 | Transform T1 创建 prd_original.md | 只读备份，T7 基准 | DT-003 |
| BR-009 | registry.json 新增 devJson | 保留 prdMd，去掉 prdJson | DT-009 |
| BR-010 | 规范融合目标为 dev.json AC | 直接生成到 AC[]，不修改 prd.md | DT-006 |
| BR-011 | testCases 拦截门 | 空 testCases → 拒绝保存 | DT-007 |
| BR-012 | e2e 必含 playwrightMcp | steps 3-8，url 相对路径 | DT-007 |
| BR-013 | 双写策略 | tasks/<id>/ + 根目录 | DT-008 |
| BR-014 | 旧特征归档 | branchName 不同 → archive/ | DT-008 |
| BR-015 | 17 项 Checklist 全通过 | 任一失败 → 拒绝保存（原 15 + field-completeness + designRef-validity） | DT-008 |
| BR-016 | 完整性比对（Tf 执行） | Transform: SOURCE_PRD.ref；DRAFT: DRAFT.md；PRD 生成后立即执行，FAIL → 自动补充 prd.md | DT-003 |
| BR-017 | PRDReview 保留覆盖 + 下游同步 | 覆盖 prd.md 后检测 dev.json → 提示重跑 /prd2json；同步产出 prd-review-fixed.md | DT-016 |
| BR-018 | PRDReview Enrich 审查 8 维度 | 原 5 + field-completeness + designRef-validity + prd-dev-consistency | DT-017 |
| BR-019 | Journal 每层必写 | 每个 L 层结束写入 qa-journal.md（含方案卡选择记录） | DT-018 |
| BR-020 | 大文件阈值 | > 5000 行 C1，2000-5000 C2，< 2000 当前流程 | DT-023 |
| BR-021 | **方案卡每题必有 AI 推荐** | 推荐优先级: 代码扫描 > 前序答案 > 最佳实践 > 最安全 | DT-021 |
| BR-022 | **方案卡修改指令解析** | 支持 "QN 换 X" / 关键词匹配 / 自由文本 | DT-021 |
| BR-023 | **L0/L5 不用方案卡** | L0 需 markdown 架构预览，L5 需 ASCII Tab | DT-021 |
| BR-024 | **方案卡含逃生口** | "方向不对，重新生成" 选项，最多重试 2 次后切逐题模式 | DT-021 |
| BR-025 | **修改指令回显确认** | 解析后必须回显结果等用户确认，避免误解析连锁错误 | DT-021 |
| BR-026 | **PRDing Ralph 模型** | Tf 后启动 Background Agent 编排器执行 A1+A2；独立 context ~245KB；失败打印恢复指令 | DT-001, DT-016 |
| BR-027 | **R1 规范确认前置（全模式共享）** | 规范扫描+确认从 PRD2JSON 移至 PyramidPRD R1 阶段（三模式统一，含 Transform），写入 journal | DT-002, DT-006 |
| BR-028 | **PRD2JSON 零交互** | R1 结果从 journal 读取；不做源文件比对（已由 Tf 完成） | DT-006, DT-008 |
| BR-029 | **PRDReview auto-chain 默认行为** | Circuit Breaker 默认 accept + advisory（不阻塞管线） | DT-016 |
| BR-030 | **模式精简 4→3** | 删除快速修复模式，保留: 完整规划/功能开发/Transform | DT-002 |
| BR-031 | **17 项 Checklist** | 原 15 项 + field-completeness + designRef-validity | DT-008 |
| BR-032 | **S1 代码扫描全模式共享** | Transform 也执行 S1，Tg DT 分解参考目标项目代码库 | DT-002, DT-019 |
| BR-033 | **Phase 5.5 外部依赖全模式共享** | Transform 也执行 Phase 5.5 prerequisites 检测 | DT-002 |
| BR-034 | **PRDReview Enrich 第 8 维度** | prd.md §7 vs dev.json 一致性审查（DT 数量/Phase 结构匹配） | DT-017 |
| BR-035 | **Journal 纯 Markdown 格式** | 固定标题锚点（`## R1 规范确认`、`## L1 方案卡`）；Grep+Read 定位；不用 YAML | DT-018 |
| BR-036 | **大文件并行 Subagent ≤ 4** | > 4 个 Phase Bundle 时分批执行（先 4 个完成后再下一批） | DT-023 |
| BR-037 | **方案卡 2-4 选项 + 逃生口** | 每题 2-4 个预设选项 + "其他（自行输入）"；> 4 选项 → 拆分问题 | DT-021 |
| BR-038 | **eval 命令安全约束** | `evals[].command` 限制为已知安全模板（`npx tsc --noEmit`、`npm test`、`npm run lint` 等）；拒绝管道符(`\|`)、链式执行(`&&`/`\|\|`/`;`)、重定向(`>`)等 shell 元字符；Checklist 项 8 校验时强制验证 | DT-008 |
| BR-039 | **Transform 源路径安全校验** | SOURCE_PRD.ref 存储的路径必须经 realpath 归一化，校验在项目根目录或用户指定允许根内；拒绝含 `..` 或符号链接逃逸的路径；Ti 阶段写入前校验 | DT-003 |
| BR-040 | **Codex auto-chain 沙箱边界** | PRDReview A1 的 Codex `exec --full-auto` 运行在 Codex 内置沙箱（workspace-write 权限，限项目目录 + /tmp）；auto-chain 中 prd.md 覆盖仅限 `tasks/<id>/prd.md`，不写项目根外文件 | DT-016 |
| BR-041 | **管线并发保护** | PRDing Ralph 后台执行期间，手动 `/prdreview` 或 `/prd2json` 应检查 `tasks/<id>/pipeline.lock`（编排器启动时创建，完成/失败时删除）；锁存在时拒绝手动执行并提示"后台管线运行中，请等待完成或先取消"；Stale lock 清理: PID 不存在或 TTL > 30min 时自动清除 | DT-001, DT-016 |

---

## 10. 范围边界

### 要做的

**PyramidPRD SKILL.md:**
- PRDing Ralph 指令（Tf 完成后: Task(run_in_background) → 编排器 [Skill("prdreview") → Skill("prd2json")]）
- 删除直接写 prd.json / registry 的逻辑
- S1 代码扫描、R1 规范确认、Phase 5.5 外部依赖 — **全模式共享**（含 Transform）
- 删除快速修复模式（P0 选择从 4→3，删除全部 Quick Fix 逻辑）
- Transform Ti 备份 + Tf 字段级校验 + Tv 字段数校验
- Transform 新增: S1 代码扫描（Tg DT 分解参考目标项目代码库）+ R1 + Phase 5.5
- Q&A Journal 写入/读取指令（含 R1 规范选择记录）
- 代码扫描、PRD 生成改为 Subagent 调用
- L1-L4 方案卡批量确认
- Transform Tq 补充方案卡
- 大文件预处理（阈值检测 + C1/C2 路由）

**PRD2JSON SKILL.md:**
- 输出从 slim prd.json → fat dev.json
- 规范融合全自动化（从 journal 读取 R1 结果，删除用户确认 AskUserQuestion）
- PRD2JSON 变为 prd.md 只读 + 零用户交互
- 双写 + Archiving + 17 项 Checklist + registry 更新
- ~~完整性比对~~ → 已移至 PyramidPRD Tf（PRD2JSON 不再做源文件比对）
- Viewer 模式检测和 dev server 启动保留（文字更新）

**PRDReview SKILL.md + Viewer API:**
- A1 自动模式: auto-chain 中 Circuit Breaker 默认 accept + advisory
- 独立运行模式: 保留完整用户交互 + 覆盖 prd.md + 下游同步提示
- Enrich 审查模式: 目标从 prd.json → dev.json，新增 3 个审查维度（含 prd-dev-consistency）
- 覆盖 prd.md 时同步产出 prd-review-fixed.md（修复 diff 记录）

**消费方:**
- CLAUDE.lead.md: fat-only 模式，删 slim + prdSection
- Testing/Coding/Finalize: 路径替换 prd.json → dev.json
- BotoolAgent.sh: 6 处 prd.json → dev.json

### 不做的（YAGNI）

- **不剥离 §7** — fat dev.json 已解决跳读问题，§7 保留为安全网
- **不生成 dev.md** — 零独立消费方
- **不修改 prd.md 格式** — PyramidPRD Phase 7 输出完全不变
- **Viewer 适配** — 18 个文件留 CLI 层完成后单独 PRD
- **不拆分 prd.md 为多文件** — 单文件保持简单
- **不修改旧 prd.json** — archive 后不回头
- **不修改 L0 方向探索** — markdown 预览保持不变
- **不修改 L5 确认门控 ASCII 格式**
- **不修改 pack.sh**
- **不修改 PRDReview 内部审查逻辑** — Codex 敌对循环/降级模式/Circuit Breaker 保持不变
- **不删除 PRDReview 覆盖能力** — review-save 保留，优先 UX

---

## 11. 成功标准

### 输出格式 + 管线主权

- [ ] 重新转换 botool-present-v16 → CREATE TABLE 字段完整率 ≥ 95%
- [ ] 重新转换 botool-present-v16 → 业务规则覆盖率 ≥ 40%
- [ ] Lead Agent 执行 DT 时不再 skip-read prd.md §7（dev.json 自给自足）
- [ ] prd.md §7 保留完整（PRD2JSON 不修改）
- [ ] dev.json 损坏后，重跑 /prd2json 可从 prd.md §7 恢复
- [ ] Ralph 自动管线: 用户确认 PRD 后 → Tf 完整性门控 → Background Agent [A1 → A2] 全自动完成
- [ ] PyramidPRD 主对话在 Tf 后立即返回（非阻塞），编排器 background 执行
- [ ] 编排器失败时打印明确恢复指令（/prdreview → /prd2json）
- [ ] PRD2JSON 对 prd.md 零写入（Grep 验证无 Write/Edit prd.md 指令）
- [ ] PRD2JSON 零用户交互（无 AskUserQuestion 调用，规范从 journal 读取）
- [ ] PRDReview auto-chain 模式 Circuit Breaker 默认 accept + advisory
- [ ] PRDReview 独立运行时覆盖 prd.md 后正确提示用户重跑 /prd2json
- [ ] PRDReview Enrich 审查通过 8 维度（原 5 + field-completeness + designRef-validity + prd-dev-consistency）
- [ ] R1 规范确认结果正确写入 journal 并被 PRD2JSON 读取
- [ ] pipeline.lock: 编排器启动时创建，完成/失败时删除；手动 /prdreview /prd2json 检查锁后拒绝并发执行
- [ ] pipeline.lock stale 清理: 锁文件存在但对应后台进程已不存在时自动清除（基于 PID 或 TTL ≤ 30min）

### 三模式统一

- [ ] Transform 模式执行 S1 代码扫描（codebase-scan.md 产出）
- [ ] Transform 模式执行 R1 规范确认（journal 有 R1 段落）
- [ ] Transform 模式执行 Phase 5.5 外部依赖扫描
- [ ] Transform Tg DT 分解正确参考 S1 代码扫描结果（文件路径匹配）
- [ ] 三模式共享阶段: P0 → S1 → R1 → [模式特定] → Phase 5.5 → L5 → G1/W1 → Tf → [Ralph: A1 → A2]

### 执行引擎

- [ ] 完整规划模式主对话上下文 ≤ 50KB（当前 ~150KB）
- [ ] Transform 模式处理 8120 行 PRD 不触发 context limit
- [ ] /compact 后 Read qa-journal.md 恢复问答，不丢失之前回答
- [ ] 大文件 Phase Bundle CREATE TABLE 数量 = Phase 引用表数量

### 问答加速

- [ ] 完整规划模式交互次数 ≤ 10 次（当前 23-44 次）
- [ ] 每个方案卡每个 Q 都有 AI 推荐标记
- [ ] 用户输入 "Q3 换 B" 能被正确解析并更新方案
- [ ] "全部接受" 是最常用路径

---

## 12. 功能保留清单（审计安全网）

确认以下现有功能在 v2 中**不被删除或破坏**，仅做必要的路径/格式调整：

### PyramidPRD 保留不变

| 功能 | 确认 |
|------|------|
| Phase 0 模式选择（3 模式，删除快速修复） | ✅ 4→3 模式 |
| L0 markdown 架构预览 | ✅ 不变 |
| L0 范围确认（YAGNI） | ✅ 不变 |
| L1-L4 问题内容和维度激活逻辑 | ✅ 问题内容不变，交互方式改为方案卡 |
| Phase 2.5 代码库 8 步扫描 | ✅ 执行逻辑不变，改为 Subagent 执行 |
| PROJECT.md 生成 | ✅ 不变 |
| Phase 5.5 外部依赖扫描 → prerequisites | ✅ 不变 |
| L5 确认门控（2 轮 4Tab ASCII） | ✅ 不变 |
| Phase 7 PRD 生成模板（§1-§8） | ✅ 不变，改为 Subagent 执行 |
| Phase 7.5 安全检查自动注入 | ✅ 不变 |
| 复杂度评估 + 动态问题数 | ✅ 不变 |
| Transform Ti-Tp 完整流程（原 T1-T7） | ✅ Tf 增强字段级校验；**新增 S1+R1+Phase5.5 统一阶段** |
| Transform Tv 完整性校验（原 T2.5，含源章节覆盖） | ✅ 增强字段数校验 |
| Transform Tg DT 分解 | ✅ 不变 + **新增参考 S1 代码扫描结果** |
| ~~快速修复模式~~ | ⛔ **已删除**（模式精简 4→3） |

### PRD2JSON 保留不变

| 功能 | 确认 |
|------|------|
| Viewer 模式检测 + dev server 启动 | ✅ 不变（文字更新 prd.json→dev.json） |
| CLI/Viewer 双模式 | ✅ 不变 |
| 规则扫描（rules/ 目录递归） | ✅ 不变 |
| ~~规则选择确认 AskUserQuestion~~ | ⛔ **移至 PyramidPRD R1**（PRD2JSON 零交互） |
| constitution file+checklist 格式 | ✅ 不变 |
| testCases 必须先读 PRD 内容再生成 | ✅ 不变（通过 designRefs 替代 prdSection） |
| playwrightMcp 8 种 action | ✅ 不变 |
| 会话分组（max 8 DT） | ✅ 不变 |
| 旧文件归档（archive/） | ✅ 不变 |
| ~~完整性比对（Step 6）~~ | ⛔ **移至 PyramidPRD Tf**（PRD2JSON 只做 Checklist 校验，不再读 SOURCE_PRD.ref） |
| 规范融合幂等性 | ✅ v2 中不再修改 prd.md，融合直接生成到 AC[]，幂等性自然满足 |

### PRDReview 保留不变

| 功能 | 确认 |
|------|------|
| Codex `exec --full-auto` 敌对审查引擎 | ✅ 不变 |
| 3 轮敌对循环（Mode A 修复 + Mode B 驳回论证） | ✅ 不变 |
| Circuit Breaker（3 轮上限 + 用户决策） | ✅ 不变 |
| Codex 不可用降级（Claude-only） | ✅ 不变 |
| fail-closed 原则 | ✅ 不变 |
| PRD 审查 5 维度（完整性/一致性/可实现性/安全性/UX） | ✅ 不变 |
| **review-save 覆盖 prd.md** | ✅ **保留**（auto-chain 中自动覆盖；独立运行时用户确认后覆盖 + 下游同步提示） |
| 临时文件清理 | ✅ 不变 |
| prd-review.json 报告格式（含 findings/轮次/状态） | ✅ 不变 |
| 多项目选择（AskUserQuestion） | ✅ 不变 |

---

## 13. 开放问题

### 已决策 ✅

| # | 问题 | 决策 | 依据 |
|---|------|------|------|
| 1a | auto-chain 机制 | **PRDing Ralph（Background Agent 编排器）** | Tf 后 Task(run_in_background) → A1+A2；spike 已验证 subagent 可调 Skill |
| 1b | Subagent 在 Skill 中的调用 | **安全可用** | spike 测试: 主对话保留所有工具(含 Task/Skill)；Task subagent 有 Skill 但无嵌套 Task |
| 4 | Phase 4-5 是否拆为独立 PRD | **不拆，27 DT 保持一个 PRD** | 统一管理，避免两份文档同步负担 |
| 7 | PRDReview 修复采纳流程 | **保留覆盖能力** | auto-chain 中自动覆盖；独立运行时用户确认覆盖 |
| 9 | 功能开发模式方案卡 | **YES，L1+L4 仍用方案卡** | 即使只有 2 卡也比逐题快 |
| — | L1 是否用方案卡 | **YES，L1 也用方案卡** | 统一体验 + 逃生口缓解风险 |
| 10 | PRDReview 位置 | **A1: PRD2JSON 之前** | 先修复 prd.md → PRD2JSON 转换最优版本 |
| 11 | 规范确认位置 | **R1: 从 PRD2JSON 移至 PyramidPRD** | PRD2JSON 零交互，支持全自动管线 |
| 12 | 快速修复模式 | **删除** | 模式精简 4→3 |
| 13 | Transform 缺 S1/R1/Phase 5.5 | **统一加上** | 三模式共享 S1+R1+Phase 5.5 |
| 14 | 完整性比对位置 | **移至 PyramidPRD Tf** | PRD2JSON 只读原则（ADR-4）；Tf 有写 prd.md 权限，可自动补充 |
| 2 | Q&A Journal 格式 | **纯 Markdown** | 用固定标题锚点（`## R1 规范确认`、`## L1 方案卡`）；Grep+Read 即可定位；YAML frontmatter 增加写入复杂度但收益不大 |
| 3 | 大文件并行 Subagent 上限 | **≤ 4 并行** | > 4 时分批：先 4 个完成后再 4 个；减少 API 配额压力；实现细节不影响架构 |
| 5 | PRDReview Enrich 第 8 维度 | **YES，新增 prd.md§7 vs dev.json 一致性审查（必选）** | 捕捉 PRDReview 覆盖后 dev.json 脱节；DT-017 必选维度 |
| 6 | auto-chain 失败后的状态 | **Ralph 模型 + 明确恢复指令** | Background Agent 编排器执行 A1+A2；失败打印 `请运行 /prdreview 然后 /prd2json`；与 Coding/Testing Ralph 一致 |
| 8 | 方案卡选项数量 | **2-4 个 + "其他" 逃生口** | 超过 4 个选项说明问题应拆分；"其他（自行输入）"覆盖所有情况 |
| 15 | PRDing Ralph 执行模型 | **Background Agent 编排器** | PyramidPRD Tf 后启动 background agent 执行 A1+A2；context 隔离（主对话 ~50KB，编排器 ~245KB）；A1→A2 文件交接+自动压缩；非阻塞 |

### 待确认 🔲

（全部已决策 ✅）

---

> 下一步: /botoolagent-pyramidprd 生成正式 PRD
