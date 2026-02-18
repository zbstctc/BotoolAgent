# PRD: BotoolAgent Performance Update

## 1. 项目概述

### 1.1 背景与动机

BotoolAgent 当前存在两个核心瓶颈：

1. **prd.json 体积过大（272KB）**：constitution 规范全文嵌入占 66%，消耗 ~98K tokens，Agent 可用 context 仅 ~51%
2. **DT 执行质量不足**：缺乏严格验证机制，Teammate 报告完成后 Lead Agent 直接信任，导致"虚假通过"；修复迭代平均 2-3 轮
3. **规范与 PRD 割裂**：规范作为独立 constitution 存在于 prd.json，Teammate 需要分别读 PRD section 和 checklist 两处；PRD.md 本身不包含规范要求，可能写出违规设计

### 1.2 核心目标

- prd.json 大小从 272KB 降至 <30KB（constitution 占比从 66% 降至 <5%）
- Agent 可用 context 从 ~51% 提升至 ~95%
- DT "虚假通过" 不可能（验证铁律）
- Spec 偏差在 DT 级别发现（而非 Layer 4 最终阶段）
- 修复迭代次数从平均 2-3 轮降至 1-2 轮
- PRD.md 成为唯一真理源（设计 + 规范一体化），Teammate 只需读一处

### 1.3 成功指标

| 指标 | 当前 | 目标 |
|------|------|------|
| prd.json 大小 | 272KB (~98K tokens) | <30KB (~10K tokens) |
| constitution 占比 | 66% | <5% |
| Agent 可用 context | ~51% | ~95% |
| DT "虚假通过" | 可能发生 | 不可能（验证铁律） |
| 修复迭代次数 | 平均 2-3 轮 | 平均 1-2 轮 |
| Spec 偏差发现时机 | Layer 4（最终） | DT 级别（每个任务后） |
| Teammate 信息源 | PRD section + constitution（两处） | PRD section 一处（设计+规范一体化） |

## 2. 当前状态

### 2.1 已有能力

| 模块 | 状态 | 说明 |
|------|------|------|
| ConstitutionRule 类型 | ⚠️ 需升级 | 只有 id/name/category/content，缺 file/checklist |
| merge route | ⚠️ 需升级 | RuleInput 直接嵌入 content 全文 |
| review-summary route | ⚠️ 需适配 | 可能依赖 content 字段 |
| CLAUDE.lead.md | ⚠️ 需升级 | 无验证铁律、无双阶段 Review、Teammate prompt 只有 typecheck |
| PRD2JSON SKILL | ⚠️ 需升级 | 规范处理嵌入全文，无 steps 字段 |
| Testing SKILL | ⚠️ 需升级 | Ralph 循环无根因分析，试错式修复 |
| PyramidPRD SKILL | ⚠️ 需升级 | 无 L0 方向探索层，快速模式不生成 checklist |

### 2.2 缺口分析

- **ConstitutionRule**: 当前 schema `{ id, name, category, content? }` 缺少 `file` 和 `checklist` 字段
- **Teammate prompt**: 只运行 `npx tsc --noEmit`，不运行 prd.json 中的其他 evals
- **验收流程**: Lead Agent 信任 Teammate 报告，无独立验证步骤
- **修复策略**: Testing 层面对所有错误使用相同的修复策略，不区分信号清晰度
- **规范割裂**: 规范独立于 PRD.md 之外，PRD 的 DT 验收条件不包含规范要求，Teammate 需分别读两处

## 3. 架构设计（概要）

### 3.1 数据流向

```
         rules/*.md ─────────────────────────────────┐
              │                                       │
Stage 1: PyramidPRD (L0 方向探索)                     │
              │                                       │
              ▼                                       │
         PRD.md §1-§7 (纯设计)                        │
              │                                       │
Stage 2: PRD2JSON                                    │
              ├── 选择适用规范                         │
              ├── 【规范融合】逐 Phase/DT 注入 [规范]    ←┘
              │    → 每个 Phase 添加 "适用规范" 头部
              │    → 每个 DT 追加 [规范] 验收条件
              │    → 写回 PRD.md §7 (PRD 变成自给自足)
              ├── 生成 slim prd.json:
              │    → DT.prdSection → §7.X (指向融合后 PRD)
              │    → constitution: file + checklist (紧凑冗余)
              ▼
Stage 3: Lead Agent (验证铁律 + 双阶段 Review)
              │
              ▼
         Teammate (读 PRD section = 设计+规范一体化)
              │
              ▼
Stage 4: Testing (根因分析 Ralph)
```

**核心原则：PRD.md §7 是唯一真理源。** prd.json 是轻量索引，constitution checklist 是 Lead 快速校验的紧凑冗余。

### 3.2 文件变更矩阵

| 文件 | A: Constitution 瘦身 | B: 执行质量提升 | C: 规范融合 |
|------|---------------------|----------------|------------|
| `viewer/src/lib/tool-types.ts` | ConstitutionRule schema 变更 | — | — |
| `viewer/src/app/api/prd/merge/route.ts` | 写 file+checklist 而非 content | — | 规范融合写回 PRD.md |
| `viewer/src/app/api/review-summary/route.ts` | 适配新 schema | — | — |
| `CLAUDE.lead.md` | Teammate prompt 简化(只读 PRD section) | 验证铁律 + 双阶段 Review + steps | — |
| `skills/.../PRD2JSON/SKILL.md` | 规范处理改为 file+checklist | 新增 steps 字段生成规则 | 规范融合步骤 |
| `skills/.../Testing/SKILL.md` | — | 根因分析重构 Ralph 循环 | — |
| `skills/.../PyramidPRD/SKILL.md` | 快速模式生成 checklist | L0 方向探索层 | — |

## 6. 业务规则

### 6.1 设计决策

| ID | 规则 | 说明 | 影响任务 |
|----|------|------|---------|
| Q1 | Steps 颗粒度 — 按可验证节点切 | 每步结束时必须能用一条命令验证。典型 3-4 步，最多 6 步 | DT-005, DT-008 |
| Q2 | Spec Review — 数 acceptanceCriteria（含 [规范] 条目） | criteria 含原始验收 + [规范] 条目，缺=FAIL；新增文件不属于 criteria，多=WARNING 不阻塞 | DT-007, DT-009 |
| Q3 | 根因分析深度 — 按信号清晰度分档 | 信号清晰（file:line:errorCode, <5 个, 类型<3 种）→直接修；信号模糊→先诊断再修 | DT-010 |
| Q4 | 向后兼容 | content 保留 optional；检测逻辑: `rule.file ? "新模式" : rule.content ? "旧模式" : "无规范"` | DT-001, DT-004 |
| Q5 | 规范融合 — PRD.md 是唯一真理源 | Stage 2 选完规范后，自动将规范要求注入 PRD.md §7 每个 Phase/DT（[规范] 前缀），prd.json 只做轻量索引 + checklist 冗余 | DT-004, DT-002 |
| Q6 | 规范融合时机 — Stage 2 而非 Stage 1 | Stage 1 专注用户需求(WHAT)，Stage 2 处理技术规范(HOW)，规范选择和融合都在 Stage 2 完成 | DT-004 |

### 6.2 验证流程决策树

```
Teammate 报告完成
├── Lead 独立运行 evals
│   ├── 全部通过 → 进入 Spec Review
│   └── 任一失败 → 修复/重派 → 重新运行
├── Spec + Constitution Review (Stage A)
│   ├── acceptanceCriteria 每条有实现 → OK
│   ├── 缺 criteria → FAIL → 修复
│   ├── constitution checklist 逐条对照代码 → OK
│   └── checklist 不合规 → FAIL → 修复（不确定时读 rule.file）
├── Quality Check (Stage B)
│   ├── HIGH → 立即修复
│   └── MEDIUM/LOW → 记录不阻塞
└── 全部 PASS → passes: true
```

### 6.3 根因分析决策树

```
收到错误信息
├── 信号清晰?
│   ├── 有 file:line:errorCode
│   ├── 错误数 < 5
│   └── 类型 < 3 种
│   → 全部满足 → 跳过分析，直接修
│
└── 信号模糊?
    → Phase 1: 根因诊断（独立/级联/环境）
    → Phase 2: 制定修复方案（优先修级联根因）
    → Phase 3: 执行修复
    → 断路器: 无进展 2 次后中断
```

## 7. 开发计划

### 7.0 Phase 依赖图

```
Phase 1 ──▶ Phase 2 ──▶ Phase 3 ──▶ Phase 6
基础设施    PRD2JSON    Lead Agent    端到端验证
(P0)       (P0)        (P0)          (P0)
                         │
              Phase 4 ──┤
              Testing    │
              (P1)      │
                         │
              Phase 5 ──┘
              PyramidPRD
              (P1)

依赖关系:
Phase 1 → 2 → 3 (严格顺序)
Phase 4 + 5 可与 Phase 3 并行
Phase 6 依赖全部完成
```

### 7.1 Phase 1: 基础设施 — 类型 + Viewer API (P0)

> **前置**: 无
> **产出**: ConstitutionRule 新 schema 生效，Viewer API 适配完成
> **对应设计**: Section 3.2, 6.1 Q4

- [ ] DT-001: 更新 ConstitutionRule TypeScript 类型 (`文件: viewer/src/lib/tool-types.ts`)
  - **描述**: ConstitutionRule 新增 `file: string` 和 `checklist: string[]`，`content` 保持 optional 向后兼容
  - **验收条件**:
    - [ ] ConstitutionRule 新增 `file: string` 和 `checklist: string[]`
    - [ ] `content` 保持 optional（向后兼容）
    - [ ] Typecheck passes

  ```typescript
  // 旧
  interface ConstitutionRule {
    id: string;
    name: string;
    category: string;
    content?: string;      // 完整规范全文 10-14KB each
  }

  // 新
  interface ConstitutionRule {
    id: string;
    name: string;
    category: string;
    file: string;          // 路径引用 (e.g., "rules/API_Rules.md")
    checklist: string[];   // 3-8 条核心检查项
    content?: string;      // 保留 optional，向后兼容旧 prd.json
  }
  ```

- [ ] DT-002: 更新 Viewer merge route (`文件: viewer/src/app/api/prd/merge/route.ts`)
  - **描述**: `mergeEnrichedPrdJson()` 写入 `file` + `checklist` 而非 `content`；新增规范融合逻辑：读取适用规范 → 注入 [规范] 条目到 PRD.md §7 → 写回 PRD.md
  - **验收条件**:
    - [ ] `mergeEnrichedPrdJson()` 写入 `file` + `checklist` 而非 `content`
    - [ ] `RuleInput` interface 适配新 schema
    - [ ] 新增规范融合逻辑：读取 PRD.md §7 → 注入 [规范] 条目 → 写回 PRD.md
    - [ ] [安全] 错误响应不泄露内部信息
    - [ ] Typecheck passes

- [ ] DT-003: 更新 review-summary route (`文件: viewer/src/app/api/review-summary/route.ts`)
  - **描述**: 确认只依赖 `name`/`id`/`checklist`，不依赖 `content`；可展示 checklist 条数作为规范覆盖度指标
  - **验收条件**:
    - [ ] 确认只依赖 `name`/`id`/`checklist`，不依赖 `content`
    - [ ] 可展示 checklist 条数作为规范覆盖度指标
    - [ ] [安全] 错误响应不泄露内部信息
    - [ ] Typecheck passes

### 7.2 Phase 2: PRD2JSON 升级 — checklist + steps (P0)

> **前置**: Phase 1（依赖 ConstitutionRule 新类型）
> **产出**: PRD2JSON 生成 slim prd.json（file+checklist 取代 content），DT 支持 steps 字段
> **对应设计**: Section 6.1 Q1, Q4

- [ ] DT-004: PRD2JSON — 规范融合 + checklist 模式 (`文件: skills/BotoolAgent/PRD2JSON/SKILL.md`)
  - **描述**: PRD2JSON 的规范处理分为两步：(1) 规范融合 — 将规范要求注入 PRD.md §7 每个 Phase/DT；(2) checklist 生成 — 为 prd.json 生成紧凑 checklist 作为 Lead 快速校验冗余
  - **验收条件**:
    - [ ] 新增「规范融合」步骤：读 rules/*.md → 匹配 Phase/DT → 注入 [规范] 验收条件
    - [ ] 每个 Phase 添加 "适用规范" 头部（`> **适用规范**: RuleName1, RuleName2`）
    - [ ] 每个 DT 追加 [规范] 前缀的验收条件（基于该 DT 涉及的领域匹配规范）
    - [ ] 融合结果写回 PRD.md §7
    - [ ] 同时生成 prd.json 的 constitution: file + checklist（紧凑冗余）
    - [ ] Output Format 示例 JSON 已更新
    - [ ] 新增 "checklist 条数 3-8" 检查

  **规范融合规则：**
  ```
  对每个 Phase:
    1. 根据 Phase 涉及的关键词匹配适用规范
       (API/route → API_Rules, 数据库/SQL → DB_Rules, 认证/auth → Auth_Rules)
    2. 在 Phase 头部添加: > **适用规范**: matched_rules
    3. 在 Phase 头部添加: > **规范要点**: 3-5 条最关键的规范

  对每个 DT:
    1. 根据 DT title/描述匹配适用规范条目
    2. 在 acceptanceCriteria 末尾（Typecheck passes 之前）追加:
       - [ ] [规范] 具体规范条目1
       - [ ] [规范] 具体规范条目2
    3. 只追加与该 DT 直接相关的条目（不是所有规范）
  ```

  **融合后 PRD.md §7 示例：**
  ```markdown
  ### 7.1 Phase 1: 用户 API

  > **适用规范**: API_Rules, Auth_Rules
  > **规范要点**:
  > - 所有请求带 apikey + Authorization header
  > - 查询附带 is_deleted=eq.false
  > - 软删除用 PATCH 不用 DELETE

  - [ ] DT-001: 创建用户列表 API
    - [ ] GET /api/users 返回用户列表
    - [ ] 支持分页
    - [ ] [规范] 请求带 apikey + Authorization header
    - [ ] [规范] 查询附带 is_deleted=eq.false 过滤
    - [ ] Typecheck passes
  ```

  **prd.json constitution 示例（紧凑冗余）：**
  ```json
  {
    "id": "rule-001",
    "name": "API_Rules",
    "category": "backend",
    "file": "rules/API_Rules.md",
    "checklist": [
      "所有请求带 apikey + Authorization header",
      "查询必须附带 is_deleted=eq.false 过滤",
      "软删除用 PATCH 不用 DELETE",
      "仅 Server Action/CRON 可使用 service_role key",
      "Prefer: return=representation"
    ]
  }
  ```

- [ ] DT-005: PRD2JSON — 新增 steps 字段生成 (`文件: skills/BotoolAgent/PRD2JSON/SKILL.md`)
  - **描述**: 在 prd.json 每个 DT 中新增可选 `steps` 数组。颗粒度规则：每步必须能用一条命令验证（Q1 设计决策）。典型 3-4 步，最多 6 步
  - **验收条件**:
    - [ ] SKILL.md 新增 steps 生成规则章节
    - [ ] 示例 JSON 包含 steps 字段
    - [ ] 颗粒度规则写入文档

  ```json
  {
    "id": "DT-003",
    "title": "实现自动生成标题功能",
    "steps": [
      { "action": "create", "file": "viewer/src/app/api/cli/generate-title/route.ts", "description": "创建 API 路由" },
      { "action": "implement", "description": "实现调用 Claude API 生成标题的逻辑" },
      { "action": "verify", "command": "npx tsc --noEmit", "expected": "exit 0" },
      { "action": "commit", "message": "feat: DT-003 - add auto-generate title API" }
    ]
  }
  ```

### 7.3 Phase 3: Lead Agent 升级 — 验证 + Review + 执行协议 (P0)

> **前置**: Phase 2（依赖 steps/checklist 字段定义）
> **产出**: Lead Agent 具备验证铁律、双阶段 Review、步骤化 Teammate prompt
> **对应设计**: Section 6.1 Q2, 6.2

- [ ] DT-006: CLAUDE.lead.md — 新增「验证铁律」(`文件: CLAUDE.lead.md`)
  - **描述**: 在「单任务执行协议」和「多任务批次」之间插入验证铁律章节，要求 Lead Agent 独立运行所有 evals 后才能标记 passes: true
  - **验收条件**:
    - [ ] 验证铁律章节已插入正确位置
    - [ ] 包含禁止行为列表（信任口头报告、使用 should pass、跳过 eval）

  ```markdown
  ## 验证铁律

  **任何 DT 在标记 passes: true 之前，Lead Agent 必须：**

  1. 运行 prd.json 中该任务的所有 evals（不仅仅是 typecheck）
  2. 读取完整输出并确认退出码为 0
  3. 检查文件是否存在（如果 eval 包含 test -f）
  4. 只有全部 evals 通过后才能写 passes: true

  如果 Teammate 报告完成但 Lead 的独立验证失败：
  - 不标记 passes: true
  - Lead 自行修复或重新派发 Teammate
  - 在 progress.txt 记录 "验证失败：{原因}"

  **禁止的行为：**
  - 信任 Teammate 的口头报告而不独立验证
  - 使用 "should pass" / "looks correct" 代替实际运行
  - 跳过任何 eval
  ```

- [ ] DT-007: CLAUDE.lead.md — 新增「DT 双阶段 Review」(`文件: CLAUDE.lead.md`)
  - **描述**: 在验证铁律之后、标记 passes: true 之前插入 review 流程（Stage A: Spec Compliance + Stage B: Quality Check）
  - **验收条件**:
    - [ ] 双阶段 Review 章节已插入
    - [ ] Spec Review 规则清晰（少了 = FAIL，多了 = WARNING）
    - [ ] Stage A 包含 constitution checklist 合规检查（不合规 = FAIL，不确定 = 读 rule.file）
    - [ ] 完整流程图：验证 → Spec + Constitution Review → Quality Check → passes: true

  ```markdown
  ## DT 双阶段 Review

  每个 DT 通过验证铁律后、标记 passes: true 之前：

  ### Stage A: Spec + Constitution Review
  1. 遍历 acceptanceCriteria，每条用 grep/read 确认代码有对应实现 → 缺了 = FAIL
  2. 看 git diff --stat 新增文件，不属于任何 criteria → 多了 = WARNING（不阻塞）
  3. 遍历 prd.json 中的 constitution checklist，逐条对照本次修改的代码：
     - 合规 → OK
     - 不合规 → FAIL → 修复
     - 不确定 → 读 rule.file 获取完整规范后判断

  ### Stage B: Quick Quality Check
  1. 检查明显安全问题（硬编码密钥、SQL 拼接）
  2. 检查 console.log / debugger 遗留
  3. HIGH → 立即修复；MEDIUM/LOW → 记录不阻塞
  ```

- [ ] DT-008: CLAUDE.lead.md — 升级 Teammate prompt 模板 (`文件: CLAUDE.lead.md`)
  - **描述**: Teammate prompt 简化为：读 PRD section（设计+规范一体化）→ 实现 → 运行所有 evals → 对照 [规范] 验收条件自检 → 提交。支持 steps 模式和旧模式。
  - **验收条件**:
    - [ ] Teammate prompt 支持 steps 模式和旧模式
    - [ ] Teammate 读 PRD section 获取设计 + [规范] 条目（一处读取）
    - [ ] evals 全量运行（不只是 typecheck）
    - [ ] 报告要求包含每个验证命令的完整输出

  ```markdown
  你正在实现 {id}: {title}

  上下文获取:
  1. 读取 {prdFile}，跳读 prdSection {prdSection} 对应的章节
  2. 从 Phase 章节提取：适用规范、规范要点、任务描述、验收条件（含 [规范] 条目）
  3. 如有"对应设计"引用，跳读对应设计章节
  4. 读取 progress.txt 了解 Codebase Patterns

  {如果有 steps 字段}
  按以下步骤顺序执行，不要跳步：
  {steps 逐条列出}
  每完成一步后确认结果再继续。如果某步失败，停下来报告。

  {如果没有 steps 字段}
  实现步骤:
  1. 实现功能
  2. 运行所有验证命令：
     a. npx tsc --noEmit
     b. {task.evals 中的其他命令}
  3. 逐条对照验收条件（特别注意 [规范] 前缀的条目）
     - 如果某条 [规范] 不确定如何实现 → 读取 Phase 头部的规范文件获取详细说明
     - 修复不符合项
  4. git add <modified files> && git commit
  5. 在报告中包含每个验证命令的完整输出
  ```

- [ ] DT-009: CLAUDE.lead.md — 升级验收流程 (`文件: CLAUDE.lead.md`)
  - **描述**: 修改「等所有 teammate 完成」后的流程为：独立验证 → Spec Review → Quality Check → passes: true
  - **验收条件**:
    - [ ] 验收流程包含独立验证 + Spec Review + Quality Check
    - [ ] 失败时有明确的修复 → 重新验证路径

### 7.4 Phase 4: Testing 升级 — 根因分析 (P1)

> **前置**: 无（可与 Phase 3 并行）
> **产出**: Testing SKILL 的 Ralph 循环具备根因分析能力
> **对应设计**: Section 6.1 Q3, 6.3

- [ ] DT-010: Testing SKILL.md — Ralph 循环加入根因分析 (`文件: skills/BotoolAgent/Testing/SKILL.md`)
  - **描述**: 将所有 Layer 的 Ralph 修复循环从「试错式修复」改为「根因分析 → 修复」。按信号清晰度分两档（Q3 设计决策）
  - **验收条件**:
    - [ ] 每个 Layer 的 Ralph 循环已加入信号清晰度判断
    - [ ] 信号模糊时有三阶段根因分析流程
    - [ ] 断路器阈值更新为 2 次
    - [ ] Layer 特化诊断重点已写入

  **信号清晰度分档：**
  ```
  信号清晰（有 file:line:errorCode，且 < 5 个，类型 < 3 种）
    → 跳过根因分析，直接修

  信号模糊（只有症状描述，或 >= 5 个错误，或 >= 3 种类型）
    → Phase 1: 根因诊断（分类：独立/级联/环境）
    → Phase 2: 制定修复方案（优先修级联根因）
    → Phase 3: 执行修复
  ```

  **各 Layer 特化：**

  | Layer | 根因诊断重点 |
  |-------|-------------|
  | Layer 1 TypeCheck | 级联 vs 独立错误，优先修 interface/type 定义 |
  | Layer 1 Lint | auto-fixable vs manual-fix，先 eslint --fix |
  | Layer 2 Unit Tests | assertion 失败 vs 环境问题（mock/setup） |
  | Layer 3 E2E | selector 过期 vs 实现 bug vs 环境问题 |

### 7.5 Phase 5: PyramidPRD 升级 — 方向探索 (P1)

> **前置**: 无（可与 Phase 3 并行）
> **产出**: PyramidPRD 具备 L0 方向探索层，快速模式适配 checklist
> **对应设计**: Section 3.1

- [ ] DT-011: PyramidPRD — 新增 L0 方向探索层 (`文件: skills/BotoolAgent/PyramidPRD/SKILL.md`)
  - **描述**: 在 L1 之前插入 L0（2-3 个 AskUserQuestion），包含项目上下文扫描、需求方向理解、实现方案选择、范围确认
  - **验收条件**:
    - [ ] L0 章节已插入 L1 之前
    - [ ] 控制在 2-3 个 AskUserQuestion
    - [ ] 有跳过条件（Quick Fix 模式 / 用户明确说不需要）
    - [ ] 输出作为后续层级上下文

  ```
  L0: 方向探索（2-3 个 AskUserQuestion）

  1. 扫描项目上下文 → 技术栈、已有组件、可复用代码
  2. 理解需求方向 → 提出 2-3 种理解方式，用户选择
  3. 提出实现方案 → 2 种方案 + trade-offs + 推荐，用户选择
  4. 确认范围 → "要做的" vs "不做的"（YAGNI）
  ```

- [ ] DT-012: PyramidPRD — 快速模式适配 checklist (`文件: skills/BotoolAgent/PyramidPRD/SKILL.md`)
  - **描述**: 跳过 Stage 2 的规则选择时，如果有 `rules/` 目录，也生成 `file + checklist`（而非 content）
  - **验收条件**:
    - [ ] 快速模式的规范处理已改为 file + checklist
    - [ ] 向后兼容旧行为

### 7.6 Phase 6: 端到端验证 (P0)

> **前置**: 全部 Phase 完成
> **产出**: 确认所有变更协同工作
> **对应设计**: Section 1.3

- [ ] DT-013: 端到端验证
  - **描述**: 手动验证所有变更的协同效果
  - **验收条件**:
    - [ ] 用现有 PRD 重新生成 prd.json，确认大小 < 30KB
    - [ ] 确认 checklist 覆盖所有规范文件
    - [ ] 确认 Viewer Stage 2 页面正常显示
    - [ ] 旧 prd.json（带 content）仍可被 Lead Agent 处理
    - [ ] Verify in browser

## 8. 附录

### A. 代码文件索引

| 文件路径 | 状态 | Phase | 任务 |
|---------|------|-------|------|
| `viewer/src/lib/tool-types.ts` | 修改 | Phase 1 | DT-001 |
| `viewer/src/app/api/prd/merge/route.ts` | 修改 | Phase 1 | DT-002 |
| `viewer/src/app/api/review-summary/route.ts` | 修改 | Phase 1 | DT-003 |
| `skills/BotoolAgent/PRD2JSON/SKILL.md` | 修改 | Phase 2 | DT-004, DT-005 |
| `CLAUDE.lead.md` | 修改 | Phase 3 | DT-006, DT-007, DT-008, DT-009 |
| `skills/BotoolAgent/Testing/SKILL.md` | 修改 | Phase 4 | DT-010 |
| `skills/BotoolAgent/PyramidPRD/SKILL.md` | 修改 | Phase 5 | DT-011, DT-012 |

### B. 风险与缓解措施

#### MEDIUM
- **Review 环节降低执行速度**: DT 增加 Review 环节可能减慢执行 → **缓解**: Quality Check 是轻量级，不做全面 code review
- **根因分析过度分析**: 简单错误也做复杂分析 → **缓解**: 信号清晰度分档（Q3），清晰信号跳过分析

#### LOW
- **L0 打断用户心流**: 方向探索增加额外步骤 → **缓解**: Quick Fix 模式跳过；控制在 2-3 个问题内
- **规范融合过度注入**: 每个 DT 注入太多 [规范] 条目导致噪音 → **缓解**: 只注入与 DT 直接相关的条目，不是所有规范
- **PRD.md 被覆写**: 规范融合写回 PRD.md 可能覆盖用户内容 → **缓解**: 只追加 [规范] 条目到已有验收条件末尾，不修改原有设计内容

### C. 测试策略

#### 单元测试
- TypeScript 类型变更的 typecheck（`npx tsc --noEmit`）

#### 集成测试
- DT-013 手动端到端验证：prd.json 重新生成 + Viewer 页面检查
- 确认 Viewer Stage 2 页面正常渲染新 schema

#### 回归测试
- 旧 prd.json（带 content 字段）仍可被 Lead Agent 正常处理
- 旧模式 Teammate prompt（无 steps）仍正常工作

### D. 非目标 (Out of Scope)

- Vercel 自动部署集成（后续单独规划）
- 语音输入
- 协作编辑
- 规范版本控制

### E. 安全检查项

以下安全项已自动注入到对应 DT 的验收条件中：

| DT | 安全检查 | 触发关键词 |
|----|---------|-----------|
| DT-002 | 错误响应不泄露内部信息 | API/接口/路由 |
| DT-003 | 错误响应不泄露内部信息 | API/接口/路由 |
