# PRD: PRD 对抗性审查 (PRD Adversarial Review)

## 1. 项目概述

### 1.1 背景与动机

BotoolAgent 的 Stage 2（任务规划）存在两个质量缺口：

1. **PRD 无门控**: Stage 1 用 Claude 生成的 PRD 直接进入 Enrich 和任务规划，Claude 可能有盲点（遗漏需求、描述模糊、逻辑矛盾），但目前没有任何校验
2. **Enrich 无审查**: Auto Enrich 生成的代码示例、测试用例、依赖关系、evals 全部直接合并进 prd.json，已发现以下具体缺陷：
   - `codeExamples` 全局挂载到每个任务（未按 taskId 过滤）
   - 依赖关系无环检测（可能生成循环依赖 A→B→C→A）
   - `filesToModify` 可能引用不存在的文件路径
   - `blocking: true` 的 eval 命令有 typo 会卡死整个 session
   - Session 分组大小无代码层面强制校验
   - JSON 解析失败时静默返回空数组，用户无感知

**GIGO 风险**: 有问题的 PRD 或 Enrich 产出直接进入自动开发，导致代码偏离预期，修复成本远高于在 Stage 2 阶段拦截。

### 1.2 核心目标

- **多模型交叉验证**: 用 Codex（OpenAI）审查 Claude 生成的内容，利用模型差异发现盲点
- **双节点质量拦截**: PRD 文档（Step 2）和 Enrich 产出（Step 4）两个关键节点均做对抗审查
- **规范级 PRD 审查**: Codex 审查 PRD 时同时对照编码规范逐 DT 检查，将规范冲突在设计阶段纠正（而非留给 Coding Agent 自行发现）
- **全自动对抗循环**: Codex↔Claude 最多 3 轮自动修正，无需用户干预

### 1.3 成功指标

- Stage 2 打开后自动触发 PRD 审查，Enrich 完成后自动触发 Enrich 审查，全程零用户操作
- Codex 能发现至少 3 类有意义的 PRD findings
- Codex 能检测到依赖环、无效文件路径、错误 eval 命令等结构性问题
- Claude 修正后的内容在下一轮审查中 HIGH/MEDIUM findings 显著减少
- 单轮审查 < 60s，完整 3 轮循环 < 3min
- `codeExamples` 按 taskId 正确分配到对应任务（Bug 修复）

## 2. 当前状态

### 2.1 已有能力

| 模块 | 状态 | 说明 |
|------|------|------|
| Stage 2 页面 (`stage2/page.tsx`) | ✅ 已实现 | 3 步流水线：Step 0 规则选择 → Step 1 Auto Enrich → Step 2 汇总 |
| `RuleCheckStep` 组件 | ✅ 已实现 | 加载 `/api/rules`，用户选择规范，CLI adapting |
| `AutoEnrichStep` 组件 | ✅ 已实现 | 调用 `/api/prd/enrich`，SSE 流式进度，生成 codeExamples/testCases/evals/dependencies/sessions |
| `EnrichmentSummary` 组件 | ✅ 已实现 | 调用 `/api/prd/convert` + `/api/prd/merge`，生成 prd.json |
| `/api/prd/enrich` | ✅ 已实现 | CLIManager 调用 Claude，生成 AutoEnrichResult |
| `/api/prd/convert` | ✅ 已实现 | PRD markdown → base prd.json |
| `/api/prd/merge` | ✅ 已实现 | 合并 base + enrichResult + rules → EnrichedPrdJson |
| `TerminalActivityFeed` 组件 | ✅ 已实现 | 终端日志实时展示 |
| SSE 流式进度模式 | ✅ 已实现 | 模拟进度 + 真实进度组合 |
| 9 个 CLI Skills | ✅ 已实现 | Brainstorm, PyramidPRD, PRD2JSON, Coding, Testing, Finalize 等 |
| shadcn/ui 组件库 | ✅ 已实现 | button, dialog, badge, tabs, input, textarea, label, popover, sheet |

### 2.2 缺口分析

| 缺口 | 影响 |
|------|------|
| 无 PRD 质量门控 | 有缺陷的 PRD 直接进入任务规划和自动开发 |
| 无 Enrich 产出校验 | 错误的代码示例、循环依赖、无效路径直接注入 prd.json |
| `codeExamples` 全局分配 | 所有代码示例挂载到每个任务，开发 Agent 看到无关代码 |
| 无规范级 PRD 审查 | PRD 中 DT 描述可能违反编码规范（如用 `fetch` 而非 `apiFetch`），23K 行规范整坨塞进 `constitution.rules`，Agent 可能看也可能不看，`ruleAuditSummary` 永远为空 |
| 无 Codex CLI 集成 | 项目中未使用 Codex 进行任何审查 |
| 无 `botoolagent-prdreview` Skill | CLI 用户无法手动触发 PRD 审查 |

## 3. 架构设计

### 3.1 Stage 2 新流程

```
Stage 2 任务规划（5 步）

Step 1        Step 2              Step 3        Step 4          Step 5
规则选择       PRD 审查(新)        Auto Enrich   Enrich审查(新)   汇总
(原Step0)      Codex通用+规范合并   (原Step1)        │            (原Step2)
               │                       │             │
               ▼                       ▼             ▼
          ┌──────────┐           ┌─────────┐    ┌─────────┐
          │ Codex    │           │ Claude  │    │ Codex   │
          │ exec     │           │ enrich  │    │ exec    │
          │ review   │           │ prompt  │    │ review  │
          │ +rules   │           └────┬────┘    └────┬────┘
          └────┬─────┘                │              │
               │                      ▼              ▼
               ▼                 ┌─────────┐    ┌─────────┐
          ┌──────────┐           │ Enrich  │    │ Claude  │
          │ Claude   │           │ Result  │    │ fix     │
          │ fix PRD  │           └─────────┘    │ enrich  │
          │ +summary │                          └─────────┘
          └──────────┘
```

**规范审查合并进 Codex 审查（而非独立步骤）:**

当前 `prd2json` 的 `constitution.rules` 只是把规范文件原样嵌入（23K+ 行），不审查 PRD 也不修正。
方案 A 将规范审查合并进 Step 2 的 Codex 审查：

1. Step 1 选定规范后，规范文件全文作为 Codex prompt 的**附加审查上下文**传入
2. Codex 同时做通用审查（5 维度）+ 规范审查（per-DT 对照规范检查）
3. 返回的 findings 中，`category='rule-violation'` 的条目携带 `ruleId`/`taskId`
4. Claude 修正 PRD 时一并处理规范违规（添加 `[规范]` 标注）
5. 对抗循环收敛后，从 rule-violation findings 中提取 `ruleAuditSummary`

### 3.2 对抗循环状态机

```
                    ┌──────────────────────────────────┐
                    │                                  │
    ┌───────┐   ┌───▼─────┐   ┌────────┐   ┌────────┐ │
    │ IDLE  ├──▶│REVIEWING├──▶│ FIXING ├──▶│REVIEW- │─┘
    └───────┘   └────┬────┘   └────────┘   │  ING   │
                     │                      └────┬───┘
                     │                           │
          ┌──────────┼───────────────────────────┤
          │          │                           │
          ▼          ▼                           ▼
    ┌──────────┐ ┌──────────┐            ┌──────────────┐
    │  PASSED  │ │  RETRY   │            │ ACKNOWLEDGED │
    │(H=0,M=0)│ │(1次重试) │            │ (3轮未收敛)  │
    └──────────┘ └────┬─────┘            └──────────────┘
                      │
                      ▼
                ┌──────────┐
                │ SKIPPED  │
                │(2次失败) │
                └──────────┘
```

**状态说明:**
- `IDLE` → 初始状态，进入 Step 后自动开始
- `REVIEWING` → Codex exec 正在审查
- `FIXING` → Claude 正在修正内容
- `PASSED` → 收敛成功（HIGH=0, MEDIUM=0）
- `ACKNOWLEDGED` → 达到 3 轮上限但未收敛，剩余 findings 标记 acknowledged，自动放行
- `RETRY` → Codex 调用失败，自动重试 1 次
- `SKIPPED` → 连续 2 次 Codex 失败，跳过审查

### 3.3 API 架构

```
Viewer 前端
    │
    ├── POST /api/prd/review ──────▶ 两步法（Codex 不支持 --base + 自定义 prompt 同时使用）
    │   请求: { content, reviewTarget,        Step 1: codex exec --full-auto "[审查prompt]"
    │           rules?: string[] (ruleIds) }         → Codex 自由文本输出
    │   响应: SSE stream                       Step 2: 服务端解析自由文本 → ReviewFinding[]
    │         { type: progress|complete|error }
    │   当 reviewTarget='prd' 且 rules 非空时，
    │   Codex prompt 同时包含通用审查维度 + 规范审查维度
    │
    └── POST /api/prd/fix ─────────▶ Claude API
        请求: { content, findings, target }
        响应: SSE stream
              { type: progress|complete|error }
```

### 3.4 组件复用设计

```
AdversarialReviewStep (复用组件)
    │
    ├── reviewTarget='prd'    ── Step 2 使用
    │   输入: prdContent + selectedRules (可选)
    │   输出: fixedPrdContent + ruleAuditSummary
    │   特点: Codex 同时做通用审查 + 规范审查
    │
    └── reviewTarget='enrich' ── Step 4 使用
        输入: enrichResult (JSON)
        输出: fixedEnrichResult
```

## 4. 数据设计

### 4.1 数据模型概览

| 模型 | 用途 | 存储位置 | 状态 |
|------|------|---------|------|
| `prd-review.json` | PRD 审查结果（含规范违规） | `tasks/{projectId}/` | 新建 |
| `enrich-review.json` | Enrich 审查结果 | `tasks/{projectId}/` | 新建 |
| `prd.md` | 修正后的 PRD | `tasks/{projectId}/` | 修改（覆盖） |

### 4.2 审查结果 Schema

```typescript
// prd-review.json 和 enrich-review.json 共用结构
interface ReviewResult {
  status: 'passed' | 'acknowledged' | 'skipped';
  reviewTarget: 'prd' | 'enrich';
  rounds: number;           // 实际执行轮数 (1-3)
  duration: number;          // 总耗时（秒）
  timestamp: string;         // ISO 时间戳
  findings: ReviewFinding[]; // 所有轮次累计的 findings（含 status: fixed/acknowledged）
  highCount: number;
  mediumCount: number;
  lowCount: number;
  backupPath?: string;          // 仅 reviewTarget='prd' 时，备份文件路径
}

interface ReviewFinding {
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  category: 'completeness' | 'consistency' | 'implementability'
           | 'security' | 'ux'
           // 规范审查（PRD 审查时附带）:
           | 'rule-violation'
           // Enrich 专属:
           | 'syntax' | 'dependency' | 'filepath' | 'eval' | 'session';
  message: string;
  suggestion: string;
  section?: string;          // PRD 中的对应章节
  ruleId?: string;           // 规范违规时: 如 "rule-001"
  ruleName?: string;         // 规范违规时: 如 "API设计规范"
  taskId?: string;           // 规范违规时: 如 "DT-001"（per-DT 定位）
  // 对抗循环解决状态（与 codex-review-schema.json 对齐）:
  resolution?: 'fixed' | 'rejected' | 'unresolved';
  rejectionReason?: string;  // 仅 resolution='rejected' 时
  codexAccepted?: boolean;   // 仅 resolution='rejected' 时，Codex 是否接受论证
  fixCommit?: string;        // 仅 resolution='fixed' 时
}
```

### 4.3 `ruleAuditSummary` 提取逻辑

PRD 审查（Step 2）完成后，从**所有轮次累计**的 `rule-violation` findings 中生成人类可读摘要。

**重要**: 不能仅看最终轮的 findings — 前轮发现并修正的违规在后续轮可能不再出现，但摘要需要记录它们被发现并修正的事实。对抗循环应维护一个累计 violations 列表（含 `status: 'fixed' | 'acknowledged'`），摘要基于累计结果生成。

**示例:**
```
审查 7 条规范（3 轮），发现 4 处违规: 3 处已修正, 1 处 acknowledged。DT-001: API_Rules 要求用 apiFetch() 不能用裸 fetch → 已修正(Round 1); DT-003: 样式规范要求按钮黑底白字 → 已修正(Round 1); DT-005: 缺少错误处理描述 → acknowledged(Round 3)。
```

如果没有 rule-violation findings，`ruleAuditSummary` 为 `"审查 N 条规范（M 轮），未发现违规"`。

### 4.4 Codex 调用方式与输出解析

**已验证限制**: Codex CLI 的 `review --base` 子命令与自定义 prompt 互斥（`error: the argument '--base <BRANCH>' cannot be used with '[PROMPT]'`）。Stage 2 审查 PRD 内容（非 git diff），因此必须使用 `codex exec --full-auto "[prompt]"` + 两步法。

**Step 1: Codex 自由文本输出**

```bash
REVIEW_OUTPUT=$(mktemp /tmp/prd-review-XXXXXX.txt)
codex exec --full-auto \
  "You are a red-team PRD reviewer. Review the following PRD for: ..." \
  2>&1 | tee "$REVIEW_OUTPUT"
```

Codex 以自由文本方式列出问题，不要求 JSON 格式。

**Step 2: 服务端解析为 ReviewFinding[]**

服务端（或 Claude）读取 Codex 自由文本输出，提取每个 finding 并结构化：
- 每个提到具体问题 + 建议的段落 → 一个 ReviewFinding
- severity 根据问题性质判断：安全/崩溃=HIGH，逻辑/缺失=MEDIUM，风格=LOW
- 解析失败 → 视为本轮调用失败（fail-closed, BR-009）

## 5. UI 设计

### 5.1 页面清单

| 页面 | 路由 | 说明 | 状态 |
|------|------|------|------|
| Stage 2 | `/stage2` | 任务规划页面，从 3 步扩展为 5 步（规则选择→PRD审查→Enrich→Enrich审查→汇总） | 修改 |

### 5.2 组件清单

| 组件 | Props 接口 | 复用位置 | 状态 |
|------|-----------|---------|------|
| `AdversarialReviewStep` | `{ reviewTarget, content, selectedRuleIds?, projectId?, onComplete, onBack? }` | Step 2 + Step 4 | 新建 |
| `PipelineProgress` | 无变化，仅增加步骤数（3→5） | Stage 2 顶部 | 修改 |

### 5.3 AdversarialReviewStep 组件布局

```
┌──────────────────────────────────────────┐
│ ☁ PRD 对抗性审查 / Enrich 对抗性审查     │
│ 正在用 Codex 审查...                     │
├──────────────────────────────────────────┤
│                                          │
│ Round 2/3  [============>       ] 67%    │
│                                          │
├──────────────────────────────────────────┤
│ ┌──────────────────────────────────────┐ │
│ │ > Codex reviewing PRD...             │ │
│ │ > Found 3 HIGH, 2 MEDIUM findings    │ │
│ │ > Claude fixing PRD...               │ │
│ │ > Round 2: reviewing fixed PRD...    │ │
│ │ > Round 2: 0 HIGH, 1 MEDIUM         │ │
│ │ > Claude fixing again...             │ │
│ │ > Round 3: 0 HIGH, 0 MEDIUM ✓       │ │
│ └──────────────────────────────────────┘ │
│ (TerminalActivityFeed 复用)              │
├──────────────────────────────────────────┤
│ 完成后显示:                               │
│                                          │
│ ┌────────┐  ┌────────┐  ┌────────┐      │
│ │ HIGH   │  │ MEDIUM │  │ LOW    │      │
│ │   0    │  │   0    │  │   2    │      │
│ └────────┘  └────────┘  └────────┘      │
│                                          │
│ 状态: ✅ PASSED (第3轮收敛)               │
│                                          │
│                          [继续 →]        │
└──────────────────────────────────────────┘
```

**交互说明:**
- 进入 Step 后自动开始审查，无需点击按钮
- 审查过程中显示进度条 + 终端日志
- 完成后显示 findings 统计摘要（简洁模式）
- 自动等待 1s 后进入下一步（或用户提前点击"继续"）
- 状态颜色：PASSED=绿色 Badge, ACKNOWLEDGED=琥珀色 Badge, SKIPPED=灰色 Badge + 醒目琥珀色警告 Banner（"⚠ 审查已跳过：Codex 服务不可用，PRD 未经对抗审查"）

### 5.4 Props 接口

```typescript
interface AdversarialReviewStepProps {
  reviewTarget: 'prd' | 'enrich';
  content: string;                    // PRD markdown 或 Enrich result JSON
  selectedRuleIds?: string[];         // Step 1 选定的规范 ruleId 数组（仅 reviewTarget='prd' 时传入，如 ["rule-001", "rule-003"]）
  projectId?: string;                 // 用于持久化路径
  onComplete: (result: ReviewStepResult) => void;
  onBack?: () => void;
}

// RuleSelection 完整定义（仅服务端内部使用）
interface RuleSelection {
  id: string;                   // 如 "rule-001"
  name: string;                 // 如 "API设计规范"
  category: string;             // 如 "backend"
  file: string;                 // 规范文件路径（仅服务端从固定映射表解析，禁止客户端传入）
  checklist: string[];          // 检查项列表
}

// API 请求中客户端只传 ruleId 数组（BR-010）
// POST /api/prd/review 的 rules 参数类型:
type RuleIdList = string[];     // 如 ["rule-001", "rule-003"]
// 服务端通过 ruleId 从固定映射表解析完整 RuleSelection（含 file 路径）

interface ReviewStepResult {
  status: 'passed' | 'acknowledged' | 'skipped';
  fixedContent: string;               // 修正后的内容
  reviewResult: ReviewResult;         // 审查报告（用于持久化）
  ruleAuditSummary?: string;          // 规范审查摘要（仅 PRD 审查时，写入 prd.json）
}
```

## 6. 业务规则

### 6.1 对抗循环规则

| ID | 规则 | 说明 | 影响任务 |
|----|------|------|---------|
| BR-001 | 收敛条件 = HIGH=0 且 MEDIUM=0 | 只有满足此条件才算 PASSED | DT-005 |
| BR-002 | 最多 3 轮循环 | 未收敛则自动放行，剩余 findings 标记 acknowledged | DT-005 |
| BR-003 | Codex 失败重试 1 次 | 连续 2 次失败则跳过（skipped），不阻断流程；**但 UI 必须显示醒目的琥珀色警告 Banner**（"⚠ 审查已跳过：Codex 服务不可用，PRD 未经对抗审查"），确保用户知晓此次 PRD 未被审查 | DT-005, DT-003 |
| BR-004 | PRD 和 Enrich 审查同等优先级 | 两者使用相同的收敛条件和容错策略 | DT-003, DT-004 |
| BR-005 | 审查全自动 | 进入 Step 后自动开始，无用户交互 | DT-003 |
| BR-006 | 修正后 PRD 先备份再覆盖 | 覆盖 `prd.md` 前先备份为 `prd.md.bak`（带时间戳 `prd-{yyyyMMddHHmmss}.md.bak`）；写入使用临时文件 + `fs.rename` 原子替换；`reviewResult` 中记录 `backupPath` | DT-006 |
| BR-009 | 解析 fail-closed（区分解析失败与合法空结果） | Codex 自由文本输出的解析分两种情况：**a) 解析失败**（Codex 返回空文本、乱码、或无法提取任何结构化段落）= 本轮调用失败，走 retry/skipped；**b) 解析成功但 0 findings**（Codex 明确表示"no issues found"或输出可解析但 findings 为空数组）= 合法结果，视为收敛成功（PASSED）。判断方法：解析器返回 `{ success: boolean, findings: ReviewFinding[] }`，`success=false` 走失败路径，`success=true && findings.length===0` 走 PASSED。 | DT-001, DT-005 |
| BR-010 | 路径安全 | `rules` 参数仅接收 `ruleId`，服务端固定映射解析文件路径；`projectId` 白名单 `/^[a-zA-Z0-9_-]+$/`；所有文件操作前 realpath 校验边界 | DT-001, DT-006 |
| BR-011 | spawn 安全 | `child_process.spawn` 必须 `shell: false`，使用固定 argv 数组，禁止拼接用户输入 | DT-001 |
| BR-012 | findings 累计 | 对抗循环维护所有轮次累计的 findings 列表（含 fixed/acknowledged 状态），不仅保存最终轮 | DT-005 |

### 6.2 规范审查规则（合并在 Codex PRD 审查中）

| ID | 规则 | 说明 | 影响任务 |
|----|------|------|---------|
| BR-008a | 规范作为 Codex prompt 附加上下文 | Step 1 选定的规范文件全文随 PRD 一起传入 Codex，作为额外审查维度 | DT-001 |
| BR-008b | 规范违规走对抗循环 | 规范违规和通用 findings 一起进入 Codex↔Claude 对抗循环，不单独处理 | DT-001, DT-005 |
| BR-008c | `[规范]` 标注注入 | Claude 修正 rule-violation findings 时，在 DT 描述中添加 `[规范] xxx` 标注行，不重写原有描述 | DT-002 |
| BR-008d | `ruleAuditSummary` 必须填充 | 循环收敛后，从 `category='rule-violation'` 的 findings 中提取摘要，写入 `prd.json` | DT-003, DT-004 |

### 6.3 Enrich 审查维度

| ID | 审查维度 | 检查内容 | category 值 |
|----|---------|---------|-------------|
| BR-007a | 代码语法 | 代码示例是否语法正确 | `syntax` |
| BR-007b | 依赖环 | 依赖关系是否有环（DAG 校验） | `dependency` |
| BR-007c | 文件路径 | `filesToModify` 路径是否存在 | `filepath` |
| BR-007d | Eval 命令 | eval command 是否语法正确、可执行 | `eval` |
| BR-007e | Session 分组 | 每组 ≤8 任务，依赖放同组 | `session` |

### 6.4 决策树：审查结果处理

```
审查完成
├── status = 'passed'
│   └── 自动进入下一步
├── status = 'acknowledged'
│   └── 自动进入下一步（findings 保留在 review.json）
└── status = 'skipped'
    └── 自动进入下一步（review.json 记录 skipped 原因）
```

## 7. 开发计划

### 7.0 Phase 依赖图

```
Phase 1 ──▶ Phase 2 ──▶ Phase 3
API 基础     Viewer 组件   循环+持久化
(P0)         (P0)          (P0)

             Phase 4 (可并行)
             Skill + Bug修复
             (P1)

依赖关系:
Phase 1 是 Phase 2 和 3 的前置（DT-001/002 提供 API）
Phase 2 包含 DT-003（对抗组件）+ DT-004（页面编排，依赖 DT-003）
Phase 4 仅依赖 Phase 1，可与 Phase 2/3 并行
```

### 7.1 Phase 1: API 基础设施 (P0)

> **前置**: 无
> **产出**: `/api/prd/review`（含规范审查）和 `/api/prd/fix` 两个 API 端点可用
> **对应设计**: Section 3.3, 4.2, 4.3
> **适用规范**: API设计规范, 项目结构规范
> **规范要点**: route.ts 在 api/{feature}/ 下; handler 用 try/catch; SSE 正确 headers; spawn 移除 CLAUDECODE

- [ ] DT-001: 创建 `/api/prd/review` API 路由 (`文件: viewer/src/app/api/prd/review/route.ts`)
  - 接收 `{ content: string, reviewTarget: 'prd' | 'enrich', rules?: string[] }` POST 请求（`rules` 为 ruleId 数组，如 `["rule-001", "rule-003"]`，服务端从固定映射表解析完整 RuleSelection）
  - **两步法调用 Codex**（已验证: `codex exec review --base` 与自定义 prompt 互斥）：
    - Step 1: 将 PRD/Enrich 内容写入临时文件，通过 `child_process.spawn` 调用 `codex exec --full-auto "[审查 prompt，引用临时文件]"`（**必须 `shell: false`，使用固定 argv 数组，禁止拼接用户输入到命令行参数**）
    - Step 2: Codex 以自由文本输出审查结果，服务端解析自由文本为 `ReviewFinding[]`
  - 构建 PRD 审查 prompt（5 维度）和 Enrich 审查 prompt（5 维度），根据 `reviewTarget` 选择
  - **规范审查合并**: 当 `reviewTarget='prd'` 且 `rules` 非空时，**服务端通过 `ruleId` 从固定映射表解析文件路径**（禁止直接接收客户端传入的 file path），读取前用 `fs.realpathSync` 校验在 `rules/` 根目录下，将规范全文作为 Codex prompt 附加审查上下文，要求 Codex 同时列出规范违规项
  - SSE 流式返回进度 `{ type: 'progress' | 'complete' | 'error' }`
  - **fail-closed（BR-009）**: 解析器返回 `{ success, findings }`；`success=false`（空文本/乱码/无法提取结构化段落）= 本轮调用失败，走 retry/skipped；`success=true && findings.length===0`（Codex 明确无问题）= 合法 PASSED
  - **临时文件清理**: 所有 `mktemp` 创建的临时文件必须在 `finally` 块中删除（`fs.unlink`），无论成功或失败。若条件允许优先使用内存 pipe（stdin）代替临时文件
  - 60s 超时保护
  - [规范] route.ts 放在 api/prd/review/ 下
  - [规范] handler 用 try/catch 包裹
  - [规范] spawn 移除 CLAUDECODE 环境变量
  - Typecheck passes
  - Verify Codex exec invocation works on local machine

- [ ] DT-002: 创建 `/api/prd/fix` API 路由 (`文件: viewer/src/app/api/prd/fix/route.ts`)
  - 接收 `{ content: string, findings: ReviewFinding[], target: 'prd' | 'enrich' }` POST 请求
  - 调用 Claude API（通过 CLIManager 或直接 API），将 content + findings 作为 prompt
  - PRD 修正 prompt：要求保持原 PRD 结构，仅修正 findings 指出的问题
  - Enrich 修正 prompt：要求修正代码示例、依赖关系、eval 命令等
  - SSE 流式返回进度 + 修正后的内容
  - [规范] SSE 响应设置正确 headers (Content-Type, Cache-Control)
  - [规范] 输入校验在 handler 顶部完成
  - Typecheck passes

### 7.2 Phase 2: Viewer 组件 (P0)

> **前置**: Phase 1
> **产出**: Stage 2 页面可展示 5 步流水线，PRD 审查（含规范）和 Enrich 审查步骤可用
> **对应设计**: Section 3.1, 3.4, 5.3, 5.4
> **适用规范**: 命名规范, 样式规范, 项目结构规范, 状态管理规范
> **规范要点**: 组件 PascalCase; 按钮黑底白字; 状态色仅用于 Badge; shadcn 组件优先; 'use client' 标记

- [ ] DT-003: 创建 `AdversarialReviewStep` 组件 (`文件: viewer/src/components/pipeline/AdversarialReviewStep.tsx`)
  - Props: `{ reviewTarget, content, selectedRuleIds?, projectId?, onComplete, onBack? }`
  - 进入组件自动触发 `/api/prd/review`（当 `reviewTarget='prd'` 且有 `selectedRuleIds` 时，传入 ruleId 数组）
  - 显示进度条（`useSimulatedProgress` hook 复用）+ `TerminalActivityFeed`
  - 解析 SSE 响应，展示每轮 findings 数量变化
  - 完成后显示简洁统计：HIGH/MEDIUM/LOW Badge 计数 + 状态 Badge
  - 状态颜色：PASSED=success Badge, ACKNOWLEDGED=warning Badge, SKIPPED=neutral Badge
  - 完成后从 rule-violation findings 中提取 `ruleAuditSummary`，通过 `onComplete` 传递
  - 自动延迟 1s 后调用 `onComplete`
  - 使用 shadcn Badge 组件展示状态
  - [规范] 组件使用 PascalCase 命名
  - [规范] 按钮黑底白字，状态用 Badge 彩色
  - [规范] 标记 'use client'
  - Typecheck passes
  - Verify in browser

- [ ] DT-004: 重构 Stage 2 页面步骤编排 (`文件: viewer/src/app/stage2/page.tsx`)
  - 步骤重新编号为 5 步（规则选择提前，规范审查合并进 PRD 审查）：
  - Step 0: `RuleCheckStep` (不变) — 规则选择（移到最前）
  - Step 1: `AdversarialReviewStep` (reviewTarget='prd', content=prdContent, selectedRuleIds) — PRD 审查（含规范）
  - Step 2: `AutoEnrichStep` (不变，但输入为修正后的 PRD) — Auto Enrich
  - Step 3: `AdversarialReviewStep` (reviewTarget='enrich', content=enrichResult JSON) — Enrich 审查
  - Step 4: `EnrichmentSummary` (不变，额外接收 ruleAuditSummary) — 汇总
  - 更新 `currentStep` 状态管理（0-4，5 步）
  - 更新 `PipelineProgress` 步骤标签（5 步）
  - 数据传递链：Step 0 selectedRuleIds → Step 1 (fixedPrd + ruleAuditSummary) → Step 2 → Step 3 → Step 4
  - Step 1 的 `ruleAuditSummary` 传递给 Step 4 写入 prd.json
  - [规范] 页面级状态用组件 state 管理
  - [规范] 流式数据使用 SSE 模式
  - Typecheck passes
  - Verify in browser

### 7.3 Phase 3: 对抗循环编排 + 持久化 (P0)

> **前置**: Phase 1, Phase 2
> **产出**: 对抗循环可自动运行最多 3 轮并收敛，审查结果持久化到文件
> **对应设计**: Section 3.2, 4.1, 6.1, 6.3, 6.4
> **适用规范**: API设计规范, 项目结构规范, 状态管理规范
> **规范要点**: 工具函数放 lib/ 无 React 依赖; 写入文件前确保目录存在; 错误响应不泄露路径

- [ ] DT-005: 实现对抗循环编排逻辑 (`文件: viewer/src/lib/adversarial-loop.ts`)
  - 导出 `runAdversarialLoop(content, reviewTarget, projectId, onProgress)` 函数
  - 实现状态机：IDLE → REVIEWING → FIXING → REVIEWING... → PASSED/ACKNOWLEDGED/SKIPPED
  - 每轮：调用 `/api/prd/review` → 检查收敛 → 如未收敛调用 `/api/prd/fix` → 下一轮
  - 收敛条件：HIGH=0 且 MEDIUM=0 → status='passed'
  - 最大 3 轮：未收敛 → status='acknowledged'
  - Codex 失败重试 1 次，连续 2 次失败 → status='skipped'
  - 通过 `onProgress` 回调报告每轮状态（轮次号、findings 数量、当前动作）
  - 返回 `ReviewStepResult`（fixedContent + reviewResult）
  - [规范] 工具函数放在 lib/ 目录，无 React 依赖
  - Typecheck passes

- [ ] DT-006: 实现审查结果持久化 (`文件: viewer/src/app/api/prd/review-save/route.ts`)
  - POST `/api/prd/review-save` 端点
  - 接收 `{ projectId, reviewTarget, reviewResult, fixedContent }`
  - **`projectId` 白名单校验**: 严格正则 `/^[a-zA-Z0-9_-]+$/`，拒绝含 `/`、`..`、空格等字符
  - **路径越界校验**: 写入前用 `path.resolve` + `realpath` 确认目标路径在 `tasks/` 根目录下
  - 将 `reviewResult` 写入 `tasks/{projectId}/prd-review.json` 或 `enrich-review.json`
  - 如果 `reviewTarget='prd'` 且有 `fixedContent`：先备份 `prd.md` 为 `prd-{yyyyMMddHHmmss}.md.bak`，再用临时文件 + `fs.rename` 原子替换覆盖 `prd.md`，在 `reviewResult` 中记录 `backupPath`
  - 兼容 portable 模式（`BotoolAgent/tasks/` 路径检测）
  - [规范] 写入文件前确保目录存在
  - [规范] 错误响应不泄露内部路径
  - Typecheck passes

### 7.4 Phase 4: CLI Skill + Bug 修复 (P1)

> **前置**: Phase 1（仅需 API 可用）
> **产出**: CLI 用户可独立运行 PRD 审查；Enrich 的 codeExamples 分配 bug 修复
> **对应设计**: Section 2.2
> **适用规范**: API设计规范, 测试用例规范
> **规范要点**: 每个 API 至少一个正常+一个错误路径测试; 输入校验在 handler 顶部

- [ ] DT-007: 创建 `botoolagent-prdreview` CLI Skill (`文件: skills/BotoolAgent/PRDReview/SKILL.md`)
  - Skill 元数据：`name: botoolagent-prdreview`, `user-invocable: true`
  - 触发词：prd review, review prd, 审查 prd, prdreview
  - 读取指定 PRD 文件或自动检测 `tasks/{projectId}/prd.md`
  - 调用 `codex exec --full-auto "[审查 prompt]"`（两步法：Codex 自由文本输出 → Claude 解析为结构化 findings，与 API 和 Testing SKILL 对齐）
  - 实现对抗循环（Claude 修正 → Codex 再审，最多 3 轮）
  - 输出审查报告到终端 + 保存 `prd-review.json`
  - 支持 `--target enrich` 选项审查 Enrich 结果
  - **创建后必须注册 symlink**: `mkdir -p ~/.claude/skills/botoolagent-prdreview && ln -sf "$(pwd)/skills/BotoolAgent/PRDReview/SKILL.md" ~/.claude/skills/botoolagent-prdreview/SKILL.md`
  - 注意：`setup.sh` 和 `pack.sh` 通过 glob `skills/BotoolAgent/*/SKILL.md` 自动发现，无需额外注册，但开发期间必须手动创建 symlink 才能在当前会话使用
  - SKILL.md frontmatter 格式校验（包含必需字段: name, description, user-invocable）+ symlink 存在性检查 + 触发词列表完整

- [ ] DT-008: 修复 Enrich `codeExamples` 全局分配 Bug (`文件: viewer/src/app/api/prd/merge/route.ts`)
  - 当前问题：`mergeEnrichedPrdJson()` 中所有 `codeExamples` 挂载到每个 task 的 `spec.codeExamples`
  - 修复方案：根据 `codeExample.taskId`（需在 enrich prompt 中要求输出）过滤，仅关联到对应任务
  - 如果 codeExample 没有 taskId，作为通用示例挂载到所有任务（向后兼容）
  - 同步更新 `/api/prd/enrich` 的 prompt，要求每个 codeExample 包含 `taskId` 字段
  - [规范] 输入校验在 handler 顶部完成
  - Typecheck passes

## 8. 附录

### A. 代码文件索引

| 文件路径 | 状态 | Phase | 任务 |
|---------|------|-------|------|
| `viewer/src/app/api/prd/review/route.ts` | 待开发 | Phase 1 | DT-001 |
| `viewer/src/app/api/prd/fix/route.ts` | 待开发 | Phase 1 | DT-002 |
| `viewer/src/components/pipeline/AdversarialReviewStep.tsx` | 待开发 | Phase 2 | DT-003 |
| `viewer/src/app/stage2/page.tsx` | 修改 | Phase 2 | DT-004 |
| `viewer/src/lib/adversarial-loop.ts` | 待开发 | Phase 3 | DT-005 |
| `viewer/src/app/api/prd/review-save/route.ts` | 待开发 | Phase 3 | DT-006 |
| `skills/BotoolAgent/PRDReview/SKILL.md` | 待开发 | Phase 4 | DT-007 |
| `viewer/src/app/api/prd/merge/route.ts` | 修改 | Phase 4 | DT-008 |
| `viewer/src/app/api/prd/enrich/route.ts` | 修改 | Phase 4 | DT-008 |

### B. 风险与缓解措施

#### MEDIUM
- **Codex exec 响应时间不确定**: Codex 模型推理时间可能超过 60s → **缓解**: 60s 超时 + 自动重试 1 次 + 失败后跳过
- **Codex 自由文本解析不稳定**: 两步法中 Codex 输出自由文本，服务端需解析为结构化 findings → **缓解**: 按段落提取（每个提到文件+问题的段落=一个 finding）；解析器返回 `{ success, findings }`：`success=false`（空文本/乱码）= 调用失败走 retry/skipped（BR-009）；`success=true && findings=[]`（Codex 明确无问题）= 合法 PASSED

#### LOW
- **Claude 修正可能改变 PRD 结构**: 修正时可能重写段落 → **缓解**: prompt 明确约束"保持原结构，仅修正问题"
- **Enrich 审查时无法验证文件路径**: Codex 可能无法访问项目源码 → **缓解**: 将项目文件列表作为审查上下文传入

### C. 测试策略

#### 单元测试
- 对抗循环状态机：测试所有状态转换路径（passed, acknowledged, skipped）
- 自由文本解析 fail-closed：测试 Codex 返回空/乱码时 `success=false` 走 retry；测试 Codex 返回"no issues"时 `success=true, findings=[]` 走 PASSED
- findings 累计：测试多轮 rule-violation findings 正确累计（不丢失前轮已修正的违规）
- findings 统计：测试 severity 计数逻辑

#### 安全测试（必须覆盖）
- **路径穿越 — rules**: 传入 `ruleId` 不存在时返回 400，禁止接受裸 file path
- **路径穿越 — projectId**: 传入 `../etc/passwd`、`foo/../../bar` 等路径时返回 400
- **命令注入**: 传入含 shell 特殊字符的 content 时 spawn 不执行注入
- **解析失败不绕门控**: mock Codex 返回空文本或乱码，验证最终状态为 skipped 而非 passed；同时 mock Codex 返回"no issues found"明确文本，验证解析为 `success=true, findings=[]` 且状态为 passed

#### 集成测试
- API 端点：测试 `/api/prd/review` 和 `/api/prd/fix` 的 SSE 流式响应
- 端到端循环：测试完整 3 轮对抗循环（mock Codex 输出）

#### E2E 测试
- Viewer 流程：从 Stage 2 Step 1 到 Step 5 完整走通
- 各状态 Badge 颜色验证

### D. 非目标 (Out of Scope)
- 不审查代码 — 代码审查由 Stage 4 的 adversarial-review 项目负责
- 不做用户交互式 findings 管理 — 全自动，不需用户逐条处理
- 不做 Codex SDK 集成 — 用 CLI exec 即可
- 不要求 Codex 直接输出 JSON — 已验证不可靠，采用两步法（自由文本 → 服务端解析）
- 不做 MCP Server 集成 — 保持简单
- 不做历史审查记录浏览 — 只保存最新一次
