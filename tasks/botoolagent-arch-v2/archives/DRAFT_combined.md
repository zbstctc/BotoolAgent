# DRAFT Combined: BotoolAgent 文档架构 v2 + 执行引擎升级

> Stage 0 头脑风暴产出 | 日期: 2026-02-26
> 合并自: DRAFT.md (文档架构) + DRAFT_2.md (执行引擎) + 全链路分析

## 定位

**一句话**: 将 BotoolAgent 的 PRD 管线从"脆弱的单对话跳读架构"升级为"持久化 + 自给自足 + 大文件安全"的双产物管线。

**两个维度**:
- **输出格式升级** — prd.md + fat dev.json 两件套，消除 skip-read 脆弱性
- **执行引擎升级** — Q&A Journal + Subagent 管线，消除上下文爆炸

两者独立但互补：前者改善 PRD 生成后的**质量和可用性**，后者改善生成过程中的**可靠性和鲁棒性**。

---

## 背景与动机

### A. 输出格式问题

botool-present-v16（8120 行 PRD）Transform 转换后暴露的问题：

| # | 问题 | 根因 | 影响 |
|---|------|------|------|
| 1 | T7 假阳性 | T7 只检查 CREATE TABLE 数量和总行数 | 13 字段的表只生成 6 字段仍报 ✅ |
| 2 | UUID 漂移 | AI 擅自改 PK 类型 | 与源表 FK 链断裂 |
| 3 | 字段丢失 | T7 无字段级校验 | 两张表共缺 16 个字段 |
| 4 | 规则丢失 | 1165 行规则只生成 70 行 | 覆盖率 6% |
| 5 | skip-read 脆弱 | prdSection 行号在 prd.md 被编辑后漂移 | Lead Agent 跳读失败 |
| 6 | 职责重叠 | PyramidPRD 和 PRD2JSON 都写 prd.json | 前者白写，后者覆盖 |
| 7 | 两步手动操作 | PyramidPRD → 手动 /prd2json | 用户忘记跑第二步 |

### B. 执行引擎问题

| # | 问题 | 数据 | 后果 |
|---|------|------|------|
| 1 | 上下文膨胀 | 完整规划 ~150KB，Transform ~200KB+ | compact 丢失问答历史 |
| 2 | 代码扫描消耗 | 10-50KB 文件内容留在上下文 | 挤压后续 PRD 生成空间 |
| 3 | 大文件手动拆分 | 8120 行 PRD 拆为 A~H | Schema 孤岛 + 交叉引用断裂 |
| 4 | Transform 模式 | 读源 PRD + 比对 + 生成 ≈ 150KB+ | 几乎必爆 context limit |

---

## 架构决策记录 (ADR)

### ADR-1: 两件套 + §7 不剥离

```
决策: prd.md 保留完整 §1-§8（含 §7），dev.json 为胖格式自给自足
替代方案:
  A. 两件套 + §7 剥离 — 被否决
  B. 三件套 (prd.md + dev.md + dev.json) — 被否决
  D. 一件套 (prd.md 含 JSON) — 被否决
```

**理由**:

Fat dev.json 已经解决了"职责混乱"的核心痛点（Lead Agent 不再 skip-read §7）。
§7 在 prd.md 中变成**惰性内容** — 没有 Agent 主动依赖它，但保留它提供：

| 保留 §7 的价值 | 说明 |
|---------------|------|
| **容灾** | dev.json 损坏 → 从 prd.md §7 重跑 /prd2json 恢复 |
| **人类可读** | 开发者直接看 prd.md §7 了解计划，无需解析 JSON |
| **审查基准** | PRDReview 审查 prd.md 时 §7 提供完整上下文 |
| **简化 Pipeline** | 不需要剥离逻辑（DT-006 删除），不需要处理 §8 重编号 |

**量化简化**:
- 删除整个 DT-006（§7 剥离逻辑，~20 行 AC）
- 删除 BR-001（"prd.md 禁止包含 §7"）
- 删除 HIGH 风险项（"§7 剥离破坏 prd.md"）
- PRD2JSON 变为 prd.md 的 **只读消费方**（不再修改 prd.md）

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

零独立消费方 → dev.md 是纯冗余。而且三件套带来同步负担：
dev.md 说 A，dev.json 说 B，以谁为准？enrich 模式改 dev.json 后 dev.md 过期。

### ADR-3: Skill Chaining（PyramidPRD → PRD2JSON 自动连接）

```
决策: PyramidPRD Phase 7 完成后自动 chain PRD2JSON
参数: {mode, projectId, prerequisites}
```

**理由**:
- 消除用户两步手动操作
- 消除 PyramidPRD 和 PRD2JSON 职责重叠（PyramidPRD 不再写 prd.json/registry）
- chain 失败有明确降级路径（提示手动 /prd2json）

### ADR-4: PRD2JSON 变为 prd.md 只读消费方

```
决策: PRD2JSON 不再修改 prd.md（当前 Step 3 会注入 [规范] 到 prd.md §7）
替代方案: 保持当前注入行为 — 被否决
```

**理由**（ADR-1 的推论）:

当前 PRD2JSON 的规范融合流程：
```
1. 读 prd.md §7
2. 扫描 rules/ → 用户确认
3. 注入 [规范] 条目到 prd.md §7  ← 修改了 PyramidPRD 的产出！
4. 行号全变 → 必须重新扫描 prdSection ← 脆弱！
5. 从修改后的 prd.md 提取 → 生成 prd.json
```

新流程（PRD2JSON 只读）：
```
1. 读 prd.md §7（只读）
2. 扫描 rules/ → 用户确认
3. 生成 dev.json，在生成过程中直接将 [规范] 注入 AC[]
   → prd.md 不被修改，无行号漂移
   → PRD2JSON 对 prd.md 零副作用
```

好处：
- 消除"修改 prd.md 后重新扫描行号"的复杂度
- 消除"注入破坏 prd.md 格式"的风险
- prd.md 在整个管线中始终保持 PyramidPRD 生成时的原始状态
- [规范] 条目属于"执行层增强"，逻辑上归属 dev.json 而非设计文档

### ADR-5: Q&A Journal 持久化

```
决策: 每层问答结束后写入 qa-journal.md，下层从文件恢复上下文
路径: tasks/<projectId>/qa-journal.md
```

**理由**: 解决上下文膨胀问题。每层上下文从线性累积（~150KB）降到 journal 文件(~3KB) + 当前层(~5KB) ≈ 8KB。

**Compact 恢复**: /compact 发生在 L2 和 L3 之间 → L3 只需 Read qa-journal.md 恢复 L0-L2 全部上下文。

### ADR-6: Subagent 管线（重活委派）

```
决策: 代码扫描、PRD 生成、Transform 源文件分析委派给 subagent
主对话只做: 编排 + 用户交互 (AskUserQuestion)
```

**不能委派的（需用户交互）：**
- L0-L5 问答
- L5 确认门控
- 模式选择

**可委派的：**
| 阶段 | Subagent 类型 | 输入 → 输出 | 主对话节省 |
|------|-------------|-------------|-----------|
| 代码扫描 (2.5) | `Explore` | 项目目录 → `codebase-scan.md` | 30-50KB |
| PRD 生成 (7) | `general-purpose` | journal + scan → `prd.md` | 10-30KB |
| Transform T1-T2 | `Explore` | 源 PRD → `source-analysis.md` | 50-100KB |
| Transform T7 比对 | `general-purpose` | 源 PRD + 生成 PRD → 比对报告 | 15-30KB |

### ADR-7: 大文件 Master Context + Phase Bundle

```
决策:
  < 2000 行 → 当前 Transform 流程（Q&A Journal + Subagent 优化后够用）
  2000-5000 行 → 单源多遍抽取（C2，4 个 Explore subagent 按维度提取）
  > 5000 行 → Master Context + Phase Bundle（C1，自包含分包 + 并行处理）
```

**Master Context + Phase Bundle 架构图：**

```
第一遍: Explore Subagent → master-context.md
  提取: 项目概述(压缩) + 全部 CREATE TABLE(完整) + 架构设计(完整)
        + 全局业务规则(完整) + 技术栈声明

第二遍: 按 Phase 创建自包含分包
  phase-bundle-N.md = master-context.md(嵌入)
                    + Phase N 原文(完整)
                    + Phase N 引用的表定义(精选)
                    + Phase N 引用的业务规则(精选)
  每个分包 ~800-1300 行（可控）

第三遍: 并行 N 个 Subagent → prd-phase-N.md

第四遍: 合并校验 → 最终 prd.md
  去重 + 冲突检测 + CREATE TABLE 完整性 + 行数校验
```

---

## 核心方案详细设计

### A. 文档架构升级 — dev.json 胖格式

#### A1. dev.json Schema

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
      "description": "string (必填, 🆕 ≥2 句话完整描述)",
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

#### A2. 与当前 prd.json 的关键变化

| 字段 | 当前 prd.json | 新 dev.json | 变化说明 |
|------|--------------|-------------|---------|
| `DT.prdSection` | ✅ 行号指针 | ⛔ **删除** | 被 designRefs 替代 |
| `DT.description` | 可选 | 🔼 **必填** | Lead Agent 直接读，无需跳读 |
| `DT.acceptanceCriteria[]` | 可选 | 🔼 **必填** | 字段级 + [规范] 条目 |
| `DT.designRefs[]` | ❌ | 🆕 **必填** | 标题关键词格式 "§X.Y 名称"，抗行号漂移 |
| `DT.files[]` | ❌ | 🆕 可选 | 预期产出文件 |
| `constitutionFusedAt` | ✅ | ⛔ 删除 | write-only，零消费方 |
| `knownGaps[]` | ✅ | ⛔ 删除 | 改写入 prd-completeness-report.md |

#### A3. 规范融合流程（PRD2JSON 内部）

```
PRD2JSON 新流程（只读 prd.md）:

Step A: 扫描 rules/ 目录
  find "$RULES_DIR" -name "*.md" | sort
  rules/ 为空 → 警告 + constitution.rules = []

Step B: 用户确认规范选择
  AskUserQuestion: 全部保留(推荐) / 排除部分
  Quick Fix 模式: 跳过 Step B，自动保留全部

Step C: 读取规范 + 生成 constitution
  每条规范: Read → 提取 3-8 条 checklist → 写入 constitution.rules

Step D: 生成 dev.json 时融合规范
  对每个 DT:
    根据关键词匹配适用规范 (API→API_Rules, DB→DB_Rules, etc.)
    在 acceptanceCriteria[] 中追加 "[规范] 具体条目"
  → prd.md 不被修改（只读消费方）
```

#### A4. 双写策略 + 15 项 Checklist

**双写目标**:
```
主文件: tasks/<id>/dev.json
兼容副本: ./dev.json (根目录, BotoolAgent.sh / Lead Agent 读取)
```

**Checklist Before Saving（15 项，任一失败 → 拒绝保存）:**

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

#### A5. testCases + playwrightMcp 规则（保留不变）

| 任务类型 | 触发条件 | 必须包含 |
|---------|---------|---------|
| typecheck | 所有 DT | `{ type: "typecheck", desc: "..." }` |
| e2e | 涉及 UI/API 的 DT | `{ type: "e2e", playwrightMcp: { url, steps[] } }` |
| unit | 涉及纯逻辑的 DT | `{ type: "unit", desc: "...", tdd: true }` |

playwrightMcp 8 种 action: navigate / snapshot / click / fill / wait_for / assert_visible / assert_not_visible / screenshot

#### A6. 完整性比对（保留不变）

- 触发条件: 有 DRAFT.md 或 SOURCE_PRD.ref 源文件时自动执行
- 对比维度: 数据表、功能点、API 端点、业务规则
- 报告输出: `prd-completeness-report.md`
- FAIL 时用户决策: 自动补充 / 手动修复 / 确认接受

---

### B. 执行引擎升级 — PyramidPRD 鲁棒性

#### B1. Q&A Journal 持久化

**路径**: `tasks/<projectId>/qa-journal.md`

**格式**:
```markdown
# Q&A Journal — [项目名]
> 模式: 功能开发 | 复杂度: 中等

## L0: 方向探索
- 选定方向: 方向 A — [一句话]
- 实现思路: [技术方案]
- 范围: ✅ [要做] / ❌ [不做]
- 技术栈: Next.js + TypeScript + Prisma

## L1: 核心识别
- 问题域: [答案]
- 目标用户: [答案]
...

## 代码扫描摘要
> 来源: codebase-scan.md (Subagent 产出)
- 技术栈: [框架 + 语言 + 数据库]
- 关键模块: [组件列表]
- 已有 API: [端点列表]
```

**流程变化**:
```
当前（无持久化）:
  L0(上下文) → L1(上下文) → L2(上下文) → ... → 线性膨胀 ~150KB

新流程（Journal 持久化）:
  L0 → Write journal  →  每层上下文 ≈ 8KB
  L1: Read journal → Ask → Write journal
  L2: Read journal → Ask → Write journal
  ...
  Phase 7: Read journal + scan → Subagent 生成 prd.md
```

#### B2. Subagent 管线架构

```
主对话（精简编排器, 上下文控制在 ~50KB）
  │
  ├─ Phase 0: 模式选择 ─── 主对话 (AskUserQuestion)
  │
  ├─ L0 方向探索 ────────── 主对话 (AskUserQuestion → Write journal)
  │
  ├─ 代码扫描 ───────────── Explore Subagent ⚡
  │   └─ Output: codebase-scan.md → 主对话收到 3-5 行摘要
  │
  ├─ L1-L4 问答 ─────────── 主对话 (每层 Read journal → Ask → Write journal)
  │
  ├─ L5 确认门控 ─────────── 主对话 (Read journal + scan → ASCII → Ask)
  │
  ├─ PRD 生成 ───────────── general-purpose Subagent ⚡
  │   └─ Input: Read qa-journal.md + codebase-scan.md
  │   └─ Output: Write prd.md → 主对话收到 "PRD 已写入, 共 N 行"
  │
  └─ auto-chain PRD2JSON ── 主对话 (Skill 工具调用)
      └─ PRD2JSON 读 prd.md (只读) → 生成 dev.json
```

**预估效果：**
- 完整规划模式: ~150KB → ~40-50KB
- Transform 模式: ~200KB+ → ~50-60KB

---

### C. 大文件 Transform 架构

#### C0. 按大小分档处理

| 源 PRD 大小 | 处理策略 | 说明 |
|------------|---------|------|
| < 2000 行 | 当前 Transform 流程 | Journal + Subagent 优化后够用 |
| 2000-5000 行 | C2 单源多遍抽取 | 4 个 Explore subagent 按维度提取 |
| > 5000 行 | C1 Master Context + Phase Bundle | 自包含分包 + 并行处理 |

#### C1. Master Context + Phase Bundle（> 5000 行）

**第一遍: 提取共享上下文**
```
Explore Subagent → master-context.md (~500 行):
  - 项目概述（压缩为摘要）
  - 全部 CREATE TABLE（完整保留，不压缩）
  - 架构设计（状态机、角色权限矩阵 — 完整）
  - 全局业务规则（跨 Phase 约束 — 完整）
  - 技术栈声明
```

**第二遍: 创建自包含分包**
```
对源 PRD 每个 Phase（或 2-3 个相关 Phase 合并）:
  phase-bundle-N.md =
    master-context.md (完整嵌入)
    + Phase N 原文 (完整)
    + Phase N 引用的表定义 (从 master-context 精选)
    + Phase N 引用的业务规则 (精选)
    + Phase N 引用的 UI 设计 (精选)
  每个分包 ~800-1300 行
```

**第三遍: 并行 Subagent 处理**
```
主对话并行启动 N 个 general-purpose Subagent:
  Subagent-1: phase-bundle-1.md → prd-phase-1.md (§1-§8 标准格式)
  Subagent-2: phase-bundle-2.md → prd-phase-2.md
  ...
```

**第四遍: 合并校验**
```
合并所有 prd-phase-N.md → 最终 prd.md:
  - §1: 取 Phase-1 版本
  - §4: 去重合并所有 CREATE TABLE
  - §6: 合并所有规则（去重）
  - §7: 按 Phase 顺序拼接所有 DT
  - 冲突检测 + CREATE TABLE 完整性 + 行数校验
```

#### C2. 单源多遍抽取（2000-5000 行）

```
Explore Subagent A: 提取 §4 数据设计 → data-extraction.md
Explore Subagent B: 提取 §3+§6 架构+规则 → arch-rules-extraction.md
Explore Subagent C: 提取 §5+§8 UI+附录 → ui-appendix-extraction.md
Explore Subagent D: 提取 §7/§9 开发计划 → plan-extraction.md

主对话: Read 4 个提取文件 → L5 确认 → Subagent 生成 PRD
```

---

## 全链路管线对比

### 当前 v1 管线

```
PyramidPRD
  ├─ 全在主对话（上下文膨胀）
  ├─ WRITE: prd.md (§1-§8)
  ├─ WRITE: prd.json (slim) ← 与 PRD2JSON 冲突
  └─ WRITE: registry.json   ← 与 PRD2JSON 冲突

  手动运行 /prd2json ← 用户可能忘记

PRD2JSON
  ├─ MODIFY: prd.md §7 (注入 [规范]) ← 副作用
  ├─ 重新扫描行号 ← 脆弱
  ├─ WRITE: prd.json (slim, 覆盖) ← prdSection 行号指针
  └─ WRITE: registry.json

Lead Agent
  └─ READ: prd.json → skip-read prd.md §7 ← 脆弱
```

### 新管线

```
PyramidPRD
  ├─ 主对话: 编排 + 用户交互 (Q&A Journal 持久化)
  ├─ Subagent: 代码扫描 → codebase-scan.md
  ├─ Subagent: PRD 生成 → prd.md (§1-§8, 含 §7)
  ├─ ⛔ 不写 prd.json / registry（由 PRD2JSON 统一负责）
  └─ auto-chain → PRD2JSON

PRD2JSON (auto-chained)
  ├─ READ: prd.md §7 (只读, 零副作用)
  ├─ READ: rules/*.md → 用户确认
  ├─ GENERATE: dev.json (fat, 含 [规范] AC)
  ├─ WRITE: dev.json (双写: tasks/<id>/ + 根目录)
  └─ WRITE: registry.json (devJson 字段)

Lead Agent
  └─ READ: dev.json (自给自足)
     └─ 可选: designRefs → 标题关键词定位 prd.md 章节
```

**关键变化**:
1. PRD2JSON 变为 **prd.md 只读消费方**（零副作用）
2. 职责分离: PyramidPRD 只产 prd.md，PRD2JSON 只产 dev.json + registry
3. Lead Agent **无需 skip-read**（dev.json 自给自足）
4. 上下文从 ~150KB 降到 ~50KB（Journal + Subagent）

---

## 产物清单

### 永久产物

| 文件 | 生产方 | 消费方 | 说明 |
|------|-------|-------|------|
| `tasks/<id>/prd.md` | PyramidPRD | PRD2JSON(只读), PRDReview, Lead(designRefs), 人类 | §1-§8 完整设计+计划 |
| `tasks/<id>/dev.json` | PRD2JSON | Lead, Testing, Coding, Finalize, BotoolAgent.sh | 胖格式机读 DT |
| `./dev.json` | PRD2JSON | BotoolAgent.sh, Lead | 根目录兼容副本 |
| `tasks/registry.json` | PRD2JSON | Coding, BotoolAgent.sh, Viewer | 项目注册表 |
| `tasks/<id>/prd-completeness-report.md` | PRD2JSON | 人类 | Transform 完整性比对 |
| `tasks/<id>/prd-review.json` | PRDReview | 人类 | 审查报告 |

### 中间产物（Pipeline 内部）

| 文件 | 生产方 | 消费方 | 生命周期 |
|------|-------|-------|---------|
| `tasks/<id>/qa-journal.md` | PyramidPRD 主对话 | PyramidPRD 各层 + PRD Subagent | 问答完成后保留（调试用）|
| `tasks/<id>/codebase-scan.md` | Explore Subagent | PRD Subagent + L5 确认 | 生成后保留 |
| `tasks/<id>/master-context.md` | Explore Subagent | Phase Bundle Subagent | 大文件模式，生成后可删 |
| `tasks/<id>/phase-bundle-N.md` | 主对话 | Transform Subagent | 大文件模式，合并后删除 |
| `tasks/<id>/source-analysis.md` | Explore Subagent | Transform L5 + PRD Subagent | Transform 模式 |
| `tasks/<id>/prd_original.md` | PyramidPRD T1 | T7 字段级校验 | Transform 模式备份 |
| `tasks/<id>/SOURCE_PRD.ref` | PyramidPRD T1 | PRD2JSON 完整性比对 | 源路径引用 |

### 已废弃/不产生

| 文件 | 原因 |
|------|------|
| `prd.json` | 被 `dev.json` 取代 |
| `dev.md` | ADR-2: 零消费方，不生成 |
| `progress-*.txt` (旧命名) | 统一为 `progress.txt` |

---

## 消费方影响分析

### CLI 层（本 PRD 范围）

| 消费方 | 当前读取 | 新读取 | 改动量 |
|--------|---------|--------|-------|
| CLAUDE.lead.md | prd.json (slim+fat 双模式) | dev.json (fat-only) | 删 slim 模式，加 designRefs |
| Testing SKILL | `tasks/<id>/prd.json` | `tasks/<id>/dev.json` | 路径替换 |
| Coding SKILL | prd.json 路径 + branchName | dev.json | 路径替换 |
| Finalize SKILL | prd.json branchName | dev.json | 路径替换 |
| BotoolAgent.sh | prd.json (15+ 处硬编码) | dev.json | 全局替换 |
| PRDReview | prd.md + prd.json | prd.md + dev.json | enrich 改 dev.json |

### Viewer 层（不在本 PRD 范围，单独 PRD）

18 个文件（11 API routes + 6 UI 组件 + project-root.ts）留 CLI 层完成后处理。

---

## 开发计划

### Phase 依赖图

```
Stream 1: 输出格式                    Stream 2: 执行引擎
─────────────────                    ──────────────────
Phase 1 ──▶ Phase 2 ──▶ Phase 3     Phase 4 ──▶ Phase 5
PyramidPRD   PRD2JSON    消费方       Q&A Journal  大文件
auto-chain   fat dev.json 适配       + Subagent   Transform
(P0)         (P0)        (P0)        (P1)         (P2)
                              \       /
                               ▼     ▼
                              Phase 6
                              端到端验证
                              (P1)

Stream 1 和 Stream 2 可并行推进（不互相依赖）
Phase 6 依赖 Stream 1 Phase 1-3 + Stream 2 Phase 4（至少 Journal）
```

### Phase 1: PyramidPRD auto-chain（P0, 4 DT）

> 改动文件: `skills/BotoolAgent/PyramidPRD/SKILL.md`
> 前置: 无
> 产出: PyramidPRD → PRD2JSON 自动连接，Transform T7 字段级校验

| DT | 标题 | 核心改动 |
|----|------|---------|
| DT-001 | Phase 7 添加 auto-chain 指令 | 末尾 Skill 调用 prd2json，传 {mode, projectId, prerequisites}；**删除**直接写 prd.json (~L1002)；**删除**直接更新 registry (~L1003) |
| DT-002 | Quick Fix auto-chain 适配 | Quick Fix 也走 auto-chain，**删除**直接写 prd.json (~L325) |
| DT-003 | Transform T1 备份 + T7 字段级校验 | T1 cp → prd_original.md；T7 DT↔prd.md 交叉检查 + SQL 字段完整性 |
| DT-004 | Transform T2.5 字段数校验 | 每读完 CREATE TABLE 记录字段数，T2.5 对比字段数差异 |

### Phase 2: PRD2JSON 重构（P0, 6 DT）— 主工作

> 改动文件: `skills/BotoolAgent/PRD2JSON/SKILL.md`
> 前置: Phase 1
> 产出: PRD2JSON 变为 fat dev.json 生成器（prd.md 只读消费方）

| DT | 标题 | 核心改动 |
|----|------|---------|
| DT-005 | 输出从 slim prd.json → fat dev.json | Schema 变更：移除 prdSection → 新增 description(必填), AC[](必填), designRefs[](必填), files[](可选) |
| DT-006 | 规范确认 fusion 目标变更 | [规范] 条目直接生成到 dev.json AC[]（不再注入 prd.md §7）；Quick Fix 跳过 Step B 用户确认 |
| DT-007 | testCases/evals/steps/playwrightMcp/sessions 保留 | 验证现有逻辑在 dev.json 格式下正常工作 |
| DT-008 | 双写 + Archiving + Checklist + 完整性比对 | prd.json → dev.json 双写；Archiving 检查旧 prd.json 和 dev.json；15 项 Checklist 更新 |
| DT-009 | registry.json 字段更新 | 新增 devJson，移除 prdJson，保留 prdMd |
| DT-010 | Viewer Mode 文字更新 | 提示文字 prd.json → dev.json |

**注意**: 相比旧 PRD，删除了 DT-006（§7 剥离逻辑）→ Phase 2 从 7 个 DT 减为 6 个。

### Phase 3: 消费方适配（P0, 6 DT）

> 改动文件: Lead, Testing, Coding, Finalize, BotoolAgent.sh, PRDReview
> 前置: Phase 2
> 产出: 完整 CLI 链路读取 dev.json

| DT | 标题 | 核心改动 |
|----|------|---------|
| DT-011 | CLAUDE.lead.md — fat-only 模式 | 删 slim 模式 + prdSection；dev.json 为唯一路径；新增 designRefs 读取 |
| DT-012 | Testing SKILL — dev.json 路径 | PRD_PATH → dev.json，删 prd.json fallback |
| DT-013 | Coding SKILL — dev.json 路径 | 全局替换 prd.json → dev.json |
| DT-014 | Finalize SKILL — dev.json 路径 | 全局替换 |
| DT-015 | BotoolAgent.sh — 15+ 处路径更新 | basename "prd.json" → "dev.json"；PRD_FILE 指向 dev.json |
| DT-016 | PRDReview — 两件套审查 | 审查 prd.md + dev.json；enrich 修改 dev.json；新增检查 dev.json 字段完整性 |

### Phase 4: Q&A Journal + Subagent 基础（P1, 3 DT）

> 改动文件: `skills/BotoolAgent/PyramidPRD/SKILL.md`
> 前置: 无（可与 Stream 1 并行）
> 产出: PyramidPRD 上下文可控 + compact 安全

| DT | 标题 | 核心改动 |
|----|------|---------|
| DT-017 | Q&A Journal 持久化 | 每层结束 Write journal → 下层开始 Read journal；格式定义 |
| DT-018 | 代码扫描 → Explore Subagent | Phase 2.5 改为 Task(Explore) 调用；输出 codebase-scan.md |
| DT-019 | PRD 生成 → general-purpose Subagent | Phase 7 改为 Task(general-purpose) 调用；输入 journal + scan |

### Phase 5: 大文件 Transform 架构（P2, 4 DT）

> 改动文件: `skills/BotoolAgent/PyramidPRD/SKILL.md`
> 前置: Phase 4（Q&A Journal + Subagent 基础）
> 产出: > 5000 行 PRD 可靠处理

| DT | 标题 | 核心改动 |
|----|------|---------|
| DT-020 | 大文件检测 + 阈值路由 | 源 PRD 行数检测；< 2000 / 2000-5000 / > 5000 分流 |
| DT-021 | C2 单源多遍抽取 | 4 个 Explore subagent 按维度提取；主对话合并 |
| DT-022 | C1 Master Context 提取 | Explore subagent → master-context.md |
| DT-023 | C1 Phase Bundle 分包 + 并行处理 + 合并 | 按 Phase 创建分包；并行 subagent 处理；合并校验 |

### Phase 6: 端到端验证（P1, 1 DT）

> 前置: Phase 1-3 + Phase 4（至少 Journal）
> 产出: botool-present-v16 验证通过

| DT | 标题 | 核心改动 |
|----|------|---------|
| DT-024 | 重新转换 botool-present-v16 | 验证: CREATE TABLE 字段 ≥ 95%，规则覆盖 ≥ 40%，dev.json fat 完整，T7 无假阳性，BotoolAgent.sh 启动正确 |

### DT 统计

| Phase | DT 数 | 优先级 | Stream |
|-------|-------|--------|--------|
| Phase 1: PyramidPRD auto-chain | 4 | P0 | 输出格式 |
| Phase 2: PRD2JSON 重构 | 6 | P0 | 输出格式 |
| Phase 3: 消费方适配 | 6 | P0 | 输出格式 |
| Phase 4: Q&A Journal + Subagent | 3 | P1 | 执行引擎 |
| Phase 5: 大文件 Transform | 4 | P2 | 执行引擎 |
| Phase 6: 端到端验证 | 1 | P1 | 验证 |
| **合计** | **24** | | |

---

## 业务规则

| ID | 规则 | 说明 | 影响 DT |
|----|------|------|---------|
| BR-001 | prd.md 保留完整 §1-§8 含 §7 | §7 不剥离，作为人类可读计划和容灾备份 | ALL |
| BR-002 | dev.json 每个 DT 必有 description + AC[] | ≥ 2 句话描述 + ≥ 3 条 AC | DT-005 |
| BR-003 | designRefs 替代 prdSection | "§X.Y 标题关键词" 抗漂移 | DT-005 |
| BR-004 | 旧项目不做兼容 | 旧 prd.json 归档 | DT-008 |
| BR-005 | Quick Fix 也走 auto-chain | chain mode="quick-fix" | DT-002 |
| BR-006 | T7 字段级 + SQL 校验 | DT↔prd.md 交叉检查 | DT-003 |
| BR-007 | Transform T1 创建 prd_original.md | 只读备份，T7 基准 | DT-003 |
| BR-008 | registry.json 新增 devJson | 保留 prdMd，去掉 prdJson | DT-009 |
| BR-009 | 规范融合目标为 dev.json AC | 直接生成到 AC[]，不修改 prd.md | DT-006 |
| BR-010 | testCases 拦截门 | 空 testCases → 拒绝保存 | DT-007 |
| BR-011 | e2e 必含 playwrightMcp | steps 3-8，url 相对路径 | DT-007 |
| BR-012 | 双写策略 | tasks/<id>/ + 根目录 | DT-008 |
| BR-013 | 旧特征归档 | branchName 不同 → archive/ | DT-008 |
| BR-014 | 15 项 Checklist 全通过 | 任一失败 → 拒绝保存 | DT-008 |
| BR-015 | 完整性比对 | 有 DRAFT.md 时自动执行 | DT-008 |
| BR-016 | PRD2JSON 只读消费 prd.md | 零副作用，不修改 prd.md | DT-005, DT-006 |
| BR-017 | Journal 每层必写 | 每个 L 层结束写入 qa-journal.md | DT-017 |
| BR-018 | 大文件阈值 | > 5000 行 C1，2000-5000 C2，< 2000 当前流程 | DT-020 |

---

## 范围边界

### 要做的

**PyramidPRD SKILL.md:**
- auto-chain 指令（Phase 7 末尾 + Quick Fix）
- 删除直接写 prd.json / registry 的逻辑
- Transform T1 备份 + T7 字段级校验 + T2.5 字段数校验
- Q&A Journal 写入/读取指令
- 代码扫描、PRD 生成改为 Subagent 调用
- 大文件预处理（阈值检测 + C1/C2 路由）

**PRD2JSON SKILL.md:**
- 输出从 slim prd.json → fat dev.json
- 规范融合目标从 prd.md §7 → dev.json AC
- PRD2JSON 变为 prd.md 只读消费方（不再修改 prd.md）
- 双写 + Archiving + Checklist + registry 更新

**消费方:**
- CLAUDE.lead.md: fat-only 模式
- Testing/Coding/Finalize/PRDReview: 路径替换
- BotoolAgent.sh: 15+ 处 prd.json → dev.json

### 不做的（YAGNI）

- **不剥离 §7** — fat dev.json 已解决跳读问题，§7 保留为安全网
- **不生成 dev.md** — 零独立消费方
- **不修改 prd.md 格式** — PyramidPRD Phase 7 输出完全不变
- **Viewer 适配** — 18 个文件留 CLI 层完成后单独 PRD
- **不拆分 prd.md 为多文件** — 单文件保持简单
- **不修改旧 prd.json** — archive 后不回头
- **不修改 L0-L5 问答流程本身** — 只加 Journal 写入
- **不修改 L5 确认门控 ASCII 格式**
- **不修改 pack.sh**

---

## 成功标准

### 输出格式

- [ ] 重新转换 botool-present-v16 → CREATE TABLE 字段完整率 ≥ 95%
- [ ] 重新转换 botool-present-v16 → 业务规则覆盖率 ≥ 40%
- [ ] Lead Agent 执行 DT 时不再 skip-read prd.md §7（dev.json 自给自足）
- [ ] prd.md §7 保留完整（不被剥离）
- [ ] dev.json 损坏后，重跑 /prd2json 可从 prd.md §7 恢复
- [ ] auto-chain: 用户完成 PyramidPRD 后自动获得两件套

### 执行引擎

- [ ] 完整规划模式主对话上下文 ≤ 50KB（当前 ~150KB）
- [ ] Transform 模式处理 8120 行 PRD 不触发 context limit
- [ ] /compact 后 Read qa-journal.md 恢复问答，不丢失之前回答
- [ ] 大文件 Phase Bundle CREATE TABLE 数量 = Phase 引用表数量

---

## 开放问题

1. **Subagent 在 Skill 中的调用**: Claude Code 的 Task 工具在 Skill 执行上下文中是否有限制？需要实验验证。

2. **Q&A Journal 格式**: Markdown 够用还是需要更结构化（YAML frontmatter）以便 Subagent 解析？

3. **大文件并行 Subagent 上限**: 同时启动 5-9 个 Phase Bundle Subagent 是否有性能/配额问题？

4. **Phase 4-5 是否拆为独立 PRD**: 执行引擎升级（Q&A Journal + Subagent + 大文件）只改 PyramidPRD 一个文件，是否应该作为独立 PRD 以降低单次 PRD 复杂度？

5. **PRDReview 审查 §7 的价值**: §7 不被剥离时，PRDReview 是否应该对比 prd.md §7 和 dev.json 的一致性？

6. **auto-chain 失败后的状态**: PyramidPRD 已完成 prd.md（含 §7），auto-chain PRD2JSON 失败。此时 prd.md 已写入但无 dev.json。用户手动 /prd2json 可恢复。是否需要在 prd.md 末尾标注 "⚠️ dev.json 未生成"？

7. **延迟剥离可选**: 作为 finalize 步骤的可选功能 — 项目完成后（所有 DT passes:true）从 prd.md 移除 §7，生成干净的设计文档归档。这是锦上添花，不是 must-have。

---

> 下一步: 基于此 DRAFT 讨论 → 确认架构决策 → /botoolagent-pyramidprd 生成正式 PRD
