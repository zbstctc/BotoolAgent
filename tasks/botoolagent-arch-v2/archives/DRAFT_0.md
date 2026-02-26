# PRD: BotoolAgent 文档架构 v2

> **⚠️ 范围声明：本 PRD 仅覆盖 CLI 层（Skills + BotoolAgent.sh + CLAUDE.lead.md）。Viewer 适配（18 个文件）将在 CLI 层架构落地后，单独撰写 Viewer PRD。**

## 1. 项目概述

### 1.1 背景与动机

在对 `botool-present-v16`（8120 行 PRD）进行 Transform Mode 转换后，发现严重细节丢失问题：

1. **T7 假阳性** — T7 只检查 `CREATE TABLE` 数量和总行数，不检查字段完整性。源 PRD 13 字段的表生成后只有 6 字段，T7 仍报 ✅
2. **UUID 漂移** — AI 把所有新表 PK 从 `SERIAL/INT` 改成 `UUID`，与源表 `botool_users.id INT` FK 链断裂
3. **字段丢失** — `present_versions` 缺 7 字段，`present_translations` 缺 9 个进度字段
4. **规则丢失** — 源 PRD 1165 行业务规则，生成 PRD 只有 ~70 行（覆盖率 6%）
5. **职责混乱** — prd.md 同时承担「设计文档」和「§7 开发计划（DTs）」，slim prd.json 只有 `prdSection` 指针，Lead Agent 执行 DT 时必须回读 prd.md §7 获取验收标准，跳读失败风险高

### 1.2 核心目标

- **目标 1**: 将 prd.md 职责拆分为两件套（prd.md 纯设计 + dev.json 机读胖 DT），消除职责混乱
- **目标 2**: dev.json 胖格式内嵌 `description` + `acceptanceCriteria[]`，Lead Agent 无需跳读 prd.md §7
- **目标 3**: T7 从行数/数量统计升级为字段级覆盖验证，消除假阳性
- **目标 4**: PyramidPRD 完成后通过 Skill Chaining 自动调用 PRD2JSON，用户无需手动 `/prd2json`

### 1.3 成功指标

- 重新转换 botool-present-v16 后，CREATE TABLE 字段完整率 ≥ 95%
- 重新转换后，业务规则覆盖率 ≥ 40%（当前 6%）
- Lead Agent 执行 DT 时不再需要回读 prd.md §7
- 用户完成需求收集后，PyramidPRD 自动 chain PRD2JSON 生成两件套，无需额外运行 `/prd2json`

## 2. 当前状态

### 2.1 已有能力

| 模块 | 状态 | 说明 |
|------|------|------|
| PyramidPRD SKILL.md (1883行) | ✅ 已实现 | L0-L5 问答 + Phase 7 生成 prd.md(含§7) + **直接生成 prd.json (~L1002)** + 更新 registry.json (~L1003) |
| PRD2JSON SKILL.md (1006行) | ✅ 已实现 | 读取 prd.md → 生成 slim prd.json |
| CLAUDE.lead.md (346行) | ✅ 已实现 | Slim 模式(跳读) + Fat 模式(向后兼容) |
| Testing SKILL.md (1660行) | ✅ 已实现 | 读取 prd.json 获取 testCases/branchName |
| PRDReview SKILL.md (427行) | ✅ 已实现 | 审查 prd.md + prd.json，含 enrich 模式直接修改 prd.json |
| Coding SKILL.md | ✅ 已实现 | 读取 prd.json（PRD_PATH ~L44-48, prd.json 检查 ~L58-78） |
| Finalize SKILL.md | ✅ 已实现 | 读取 prd.json（PRD_PATH ~L56-57, branchName 检查 ~L59-86） |
| BotoolAgent.sh | ✅ 已实现 | 外循环驱动，设置 BOTOOL_PRD_FILE 环境变量指向 prd.json，15+ 处硬编码 prd.json |
| Viewer (18个文件) | ✅ 已实现 | 11 API routes + 6 UI 组件 + project-root.ts 引用 prd.json |

### 2.2 缺口分析

```
当前架构:
┌─────────────────────────────────────────────┐
│  prd.md (§1-§8 含§7 开发计划)               │
│       │                                     │
│       └─▶ prd.json (slim: prdSection 指针)  │
│              │                              │
│              └─▶ Lead Agent 回读 prd.md §7  │
│                   (跳读失败风险!)            │
└─────────────────────────────────────────────┘

问题:
1. prd.md 职责过重（设计+执行计划）
2. prd.json slim 模式依赖 prdSection 行号，修改 PRD 后行号漂移
3. T7 只做数量检查，不检查字段完整性
4. 用户需两步操作: PyramidPRD → 手动 /prd2json
5. PRD2JSON 输出 slim prd.json 格式不足，缺少 description/acceptanceCriteria 等胖字段
6. BotoolAgent.sh 硬编码 prd.json（15+ 处引用）
7. PyramidPRD 直接生成 prd.json（~L1002）+ 更新 registry，与 PRD2JSON 职责重叠
8. Viewer /api/prd/convert 有独立 prd.json schema（L9-76），是 Viewer 版 PRD2JSON → **Viewer PRD 处理**
```

## 3. 架构设计

### 3.1 核心概念

```
新架构（两件套）:
┌─────────────────────────────────────────────┐
│  prd.md (§1-§6+§8 纯设计，无§7)            │
│       │                                     │
│  dev.json (胖格式: description,             │
│            acceptanceCriteria[],             │
│            designRefs[], evals,             │
│            testCases, steps, sessions,      │
│            constitution)                    │
│       │                                     │
│       └─▶ Lead Agent 直接读 dev.json        │
│            (自给自足，无需回读 prd.md!)      │
└─────────────────────────────────────────────┘
```

### 3.2 用户角色

```
┌──────────────────┐   ┌──────────────────┐
│  开发者(boszan)  │   │  Lead Agent      │
│                  │   │                  │
│  读写:           │   │  读:             │
│  - prd.md        │   │  - dev.json      │
│  - dev.json      │   │  - prd.md(ref)   │
│                  │   │                  │
│  工具:           │   │  写:             │
│  PyramidPRD      │   │  - dev.json      │
│                  │   │    (passes:true) │
└──────────────────┘   └──────────────────┘

┌──────────────────┐   ┌──────────────────┐
│  Testing Agent   │   │  Review Agent    │
│                  │   │                  │
│  读:             │   │  读:             │
│  - dev.json      │   │  - prd.md        │
│    (testCases)   │   │  - dev.json      │
│    (branchName)  │   │                  │
└──────────────────┘   └──────────────────┘

权限矩阵:
┌──────────┬────────┬────────┬────────┬────────┐
│ 文件     │ 开发者 │ Lead   │ Test   │ Review │
├──────────┼────────┼────────┼────────┼────────┤
│ prd.md   │ R/W    │ R(ref) │ ─      │ R      │
│ dev.json │ R/W    │ R/W    │ R      │ R      │
└──────────┴────────┴────────┴────────┴────────┘
```

### 3.3 核心工作流

```
用户视角（Skill Chaining — 对用户透明）:
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ /pyramidprd  │────▶│ /prdreview   │────▶│ /coding      │
│              │     │              │     │              │
│ 问答收集需求 │     │ 审查两件套   │     │ 自动开发     │
│ 生成 prd.md  │     │              │     │              │
│ ─ auto-chain │     │              │     │              │
│ → PRD2JSON   │     │              │     │              │
│ 生成两件套   │     │              │     │              │
└──────────────┘     └──────────────┘     └──────────────┘

内部流程（两步 Skill Chaining）:
┌──────────────────────────┐  ┌──────────────────────────────────┐
│ Step 1: PyramidPRD       │  │ Step 2: PRD2JSON (auto-chained)  │
│                          │  │                                  │
│ L0-L5 问答收集需求       │  │ 接收 chain 参数:                 │
│    ↓                     │  │  {mode, projectId, prerequisites}│
│ Phase 7: 生成 prd.md     │  │    ↓                             │
│  (§1-§8, 含 §7)         │  │ 读取 prd.md（含 §7）            │
│    ↓                     │  │    ↓                             │
│ ⛔ 不再生成 prd.json     │  │ 规范确认环节（用户交互）         │
│ ⛔ 不再更新 registry     │  │    ↓                             │
│    ↓                     │  │ §7 剥离：                        │
│ Transform Mode:          │  │  读取 §7 → 生成 dev.json        │
│  T1 备份 prd_original.md │  │  从 prd.md 移除 §7              │
│  T7 字段级校验           │──▶│    ↓                             │
│    ↓                     │  │ 生成 dev.json（胖格式）          │
│ auto-chain: 自动调用     │  │  description, AC[], designRefs[] │
│ PRD2JSON (Skill 工具)    │  │  testCases, evals, steps,        │
│ 传入 {mode, projectId,   │  │  sessions, constitution          │
│       prerequisites}     │  │    ↓                             │
│                          │  │ Checklist Before Saving（15项）  │
│                          │  │ 双写: tasks/<id>/ + 根目录       │
│                          │  │ registry.json 更新               │
│                          │  │ 完整性比对（有 DRAFT.md 时）     │
└──────────────────────────┘  └──────────────────────────────────┘
```

### 3.4 文件结构

```
tasks/<projectId>/
  prd.md              ← §1-§6+§8 纯设计文档（无 §7）
  dev.json            ← 机读版胖格式 DT（含字段级验收标准 + [规范] AC）
  prd_original.md     ← Transform Mode 专用：原始 PRD 完整备份（只读，T7 基准）
  SOURCE_PRD.ref      ← Transform Mode 专用：源文件路径引用
  progress.txt        ← 运行时进度（不变）

项目根目录:
  dev.json            ← 兼容副本（BotoolAgent.sh / CLAUDE.lead.md 读取）
  progress.txt        ← 兼容副本
```

## 4. 数据设计

### 4.1 dev.json Schema 定义

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
      "description": "string (必填, 🆕 完整任务描述)",
      "acceptanceCriteria": [
        "关键字段 xxx 存在于 CREATE TABLE (必填, 🆕)",
        "PK 类型为 SERIAL 不是 UUID",
        "[规范] 所有请求带 apikey header",
        "Typecheck passes"
      ],
      "designRefs": ["§4.2 数据模型概览", "§3.3 状态机 (🆕)"],
      "files": ["sql/04_versions.sql", "src/components/Foo.tsx (可选, 🆕)"],
      "evals": [
        {
          "type": "code-based",
          "blocking": true,
          "description": "Typecheck passes",
          "command": "npx tsc --noEmit",
          "expect": "exit-0"
        }
      ],
      "testCases": [
        { "type": "typecheck", "desc": "TypeScript 编译通过" },
        {
          "type": "e2e",
          "desc": "点击导入按钮，弹窗正确打开并显示文件选择器",
          "playwrightMcp": {
            "url": "/admin",
            "steps": [
              { "action": "navigate", "url": "/admin" },
              { "action": "snapshot", "assert": "管理页面正常加载" },
              { "action": "click", "element": "导入按钮" },
              { "action": "assert_visible", "text": "选择文件" }
            ]
          }
        }
      ],
      "steps": [
        { "action": "create", "file": "src/xxx.ts", "description": "创建文件" },
        { "action": "implement", "description": "实现逻辑" },
        { "action": "verify", "command": "npx tsc --noEmit", "expected": "exit 0" },
        { "action": "commit", "message": "feat: DT-001 - description" }
      ]
    }
  ]
}
```

### 4.2 与当前 prd.json 的字段对比

| 字段 | 当前 prd.json | 新 dev.json | 变化 |
|------|--------------|-------------|------|
| `project` | ✅ | ✅ 保留 | 不变 |
| `branchName` | ✅ | ✅ 保留 | 不变 |
| `description` | ✅ | ✅ 保留 | 不变 |
| `prdFile` | ✅ | ✅ 保留 | 降为设计上下文补充 |
| `prerequisites[]` | ✅ | ✅ 保留 | 不变（chain 传入） |
| `sessions[]` | ✅ | ✅ 保留 | 不变 |
| `constitution` | ✅ | ✅ 保留 | 结构完全不变 |
| `DT.prdSection` | ✅ slim 指针 | ⛔ **删除** | §7 已从 prd.md 移除 |
| `DT.description` | 可选 | 🔼 **必填** | Lead Agent 直接读 |
| `DT.acceptanceCriteria[]` | 可选 | 🔼 **必填** | 字段级 + [规范] 条目，T7 校验基础 |
| `DT.designRefs[]` | ❌ | 🆕 新增 | 替代 prdSection |
| `DT.files[]` | ❌ | 🆕 新增（可选） | 预期产出文件 |
| `DT.evals[]` | ✅ | ✅ 保留 | 不变 |
| `DT.testCases[]` | ✅ | ✅ 保留 | 不变（含 playwrightMcp） |
| `DT.steps[]` | ✅ | ✅ 保留 | 不变 |

**废弃字段（从 dev.json 中移除）：**
- `constitutionFusedAt`（ISO 时间戳）— 当前 PRD2JSON 写入但无消费方读取，纯 write-only 元数据，删除
- `knownGaps[]`（用户接受的覆盖差距）— 当前 PRD2JSON 写入但无消费方读取，差距信息改写入 `prd-completeness-report.md`

### 4.3 designRefs 格式

字符串数组，格式为 `"§X.Y 标题关键词"`：

```json
"designRefs": [
  "§4.2 数据模型概览",
  "§3.3 状态机",
  "§5.3 关键页面布局"
]
```

Lead Agent 使用标题关键词在 prd.md 中定位章节（抗行号漂移）。

### 4.4 registry.json 变化

新增 `devJson` 字段：

```json
{
  "botoolagent-arch-v2": {
    "name": "BotoolAgent 文档架构 v2",
    "prdMd": "botoolagent-arch-v2/prd.md",
    "devJson": "botoolagent-arch-v2/dev.json",
    "progress": "botoolagent-arch-v2/progress.txt",
    "branch": "botool/botoolagent-arch-v2",
    "status": "prd",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

保留 `prdMd` 字段（指向纯设计文档）。不再有 `prdJson` 字段。不再有 `devMd` 字段。

## 5. UI 设计

> **⚠️ Viewer 不在本 PRD 范围内。** Viewer 涉及 18 个文件（11 API routes + 6 UI 组件 + project-root.ts），将在 CLI 层架构完成后单独撰写 Viewer PRD。详见 §8.D 非目标。

## 6. 业务规则

### 6.1 文件生成规则

| ID | 规则 | 说明 | 影响 DT |
|----|------|------|---------|
| BR-001 | prd.md 禁止包含 §7 开发计划 | PRD2JSON 剥离 §7 后，prd.md 仅含 §1-§6+§8 | DT-006 |
| BR-002 | dev.json 每个 DT 必有 description + acceptanceCriteria[] | 至少 3 条 AC | DT-005 |
| BR-003 | designRefs 用字符串数组格式 | `"§X.Y 标题关键词"` | DT-005 |
| BR-004 | 旧项目不做兼容，全部 archive | 无 prd.json fallback（PRD2JSON 层面） | DT-009 |
| BR-005 | Quick Fix 也通过 auto-chain 生成两件套 | Quick Fix 完成后 chain PRD2JSON 生成 dev.json | DT-002 |
| BR-006 | T7 必须做字段级 + SQL 校验 | DT↔prd.md 交叉检查 + SQL 字段完整性 | DT-003 |
| BR-007 | Transform Mode T1 创建 prd_original.md | 作为 T7 字段级比对基准 | DT-003 |
| BR-008 | registry.json 新增 devJson 字段 | 保留 prdMd，去掉 prdJson | DT-010 |
| BR-009 | 规范融合目标为 dev.json AC | 旧：注入 prd.md §7。新：PRD2JSON 剥离 §7 后，[规范] 条目写入 dev.json acceptanceCriteria[] | DT-007 |
| BR-010 | testCases 拦截门 | 任何 DT 的 testCases 为空 [] → 拒绝保存 dev.json | DT-008 |
| BR-011 | e2e testCase 必含 playwrightMcp | type=e2e 的 testCase 必须有 playwrightMcp 字段，steps 3-8 步 | DT-008 |
| BR-012 | 双写策略 | dev.json 同时写入 `tasks/<id>/dev.json`（主文件）+ `./dev.json`（根目录副本） | DT-009 |
| BR-013 | 旧特征归档 | 写入新 dev.json 前，检查根目录已有 prd.json/dev.json，若 branchName 不同则归档 | DT-009 |
| BR-014 | Checklist Before Saving 必须全部通过 | 15 项质量门控，任一失败 → 拒绝保存 | DT-009 |
| BR-015 | 非 Transform 模式也执行完整性比对 | 有 DRAFT.md 时对比源文件与生成 PRD 的覆盖率 | DT-009 |

### 6.2 Lead Agent 决策树

```
Lead Agent 读取 dev.json
├── 有 devTasks[]?
│   ├── 是 → 找下一个 passes:false 的 DT
│   │       ├── 读 description + acceptanceCriteria[]
│   │       ├── 需要设计上下文?
│   │       │   ├── 是 → 读 designRefs[] → 用标题关键词定位 prd.md 章节
│   │       │   └── 否 → 直接执行
│   │       ├── 执行实现
│   │       ├── 运行 evals[]
│   │       ├── Stage A: 逐条校验 constitution checklist
│   │       └── 更新 passes: true
│   └── 否 → 报错: "dev.json 中无 devTasks"
└── 无 devTasks → 报错
```

### 6.3 PRD2JSON 重构要点

PRD2JSON 从 slim prd.json 生成器重构为 fat dev.json 生成器。以下是关键变更：

| # | 重构要点 | 当前行为 | 新行为 | 对应 DT |
|---|---------|---------|--------|---------|
| 1 | **输出格式** | slim prd.json（prdSection 指针） | fat dev.json（description + AC[] + designRefs[]） | DT-005 |
| 2 | **§7 处理** | 从 prd.md §7 提取 DT 列表 → 写入 prd.json | 从 prd.md §7 提取 → 生成 dev.json → **剥离 §7**，回写 prd.md 为纯设计 | DT-006 |
| 3 | **Schema** | `prdSection` 行号指针 | `description`(必填) + `acceptanceCriteria[]`(必填) + `designRefs[]`(必填) + `files[]`(可选) | DT-005 |
| 4 | **规范融合目标** | [规范] 条目 → prd.md §7 验收标准 | [规范] 条目 → dev.json acceptanceCriteria[]（§7 已剥离） | DT-007 |
| 5 | **testCases/evals/steps** | 保留 | 保留 + 增强验证（拦截门更严格） | DT-008 |
| 6 | **sessions 分组** | 保留 | 保留（max 8 规则不变） | DT-008 |
| 7 | **双写策略** | prd.json → tasks/ + 根目录 | dev.json → tasks/ + 根目录 | DT-009 |
| 8 | **Archiving** | 检查旧 prd.json | 检查旧 prd.json 和 dev.json | DT-009 |
| 9 | **Checklist** | 16 项质量门控 | 15 项（移除 devFile 检查，更新字段名：prdSection → designRefs，prd.json → dev.json） | DT-009 |
| 10 | **完整性比对** | 保留 | 保留（触发条件不变） | DT-009 |
| 11 | **registry.json** | 写入 prdJson 字段 | 写入 devJson 字段，移除 prdJson | DT-010 |
| 12 | **Viewer Mode** | 打开 /stage2 页面 | 更新文字引用（prd.json → dev.json） | DT-011 |

**不变的逻辑（无需改动）：**
- 规范扫描（rules/ 目录 + AskUserQuestion）— 流程保持，仅融合目标变更
- playwrightMcp 8 种 action 类型规则 — 完全保留
- Task Size / Ordering Rules — 完全保留
- 安全关键词注入 — 完全保留

### 6.4 规范确认详细流程（PRD2JSON 改造）

**位置：** PRD2JSON 转换流程中（auto-chain 触发后、§7 剥离前）。

**跳过条件：** Quick Fix 模式的规范处理保持自动检测（不弹出用户交互），但仍生成 constitution。

#### Step A: 扫描 rules/ 目录

```bash
RULES_DIR="$([ -d BotoolAgent/rules ] && echo BotoolAgent/rules || echo rules)"
find "$RULES_DIR" -name "*.md" -type f 2>/dev/null | sort
```

展示发现的规范文件列表：
```
Found the following coding standards in rules/:
  [1] backend/API设计规范.md
  [2] frontend/命名规范.md
  [3] testing/测试用例规范.md
```

**rules/ 为空时的处理：**
```
⚠️ WARNING: 未发现任何规范文件（rules/ 目录为空）

以下规范检查将被完全跳过：
  - API 设计规范合规检查
  - 数据库操作规范合规检查
  - Lead Agent 的 Stage A Constitution Review（将形同虚设）

建议：在 rules/ 目录中添加规范文件后重新运行
（你也可以继续，但 Lead Agent 将没有规范依据）
```

空目录时 constitution 设为：
```json
{
  "rules": [],
  "ruleAuditSummary": "⚠️ rules/ 目录为空，规范检查全部跳过"
}
```

#### Step B: 用户确认规范选择 (AskUserQuestion)

```json
{
  "questions": [
    {
      "question": "【规范确认】发现以下编码规范，默认全部应用。是否需要排除？\n\n[1] API设计规范 (rules/backend/API设计规范.md)\n[2] 前端代码规范 (rules/frontend/命名规范.md)\n[3] 测试用例规范 (rules/testing/测试用例规范.md)",
      "header": "规范选择",
      "options": [
        { "label": "全部保留（推荐）", "description": "所有发现的规范都应用到 dev.json constitution 和 DT 验收标准" },
        { "label": "排除部分规范", "description": "手动选择要排除的规范文件" }
      ],
      "multiSelect": false
    }
  ],
  "metadata": {
    "source": "prd2json",
    "levelName": "规范确认"
  }
}
```

**如果用户选择"排除部分规范"：**
```json
{
  "questions": [
    {
      "question": "请选择要**排除**的规范文件（未选中的将被保留）：",
      "header": "排除规范",
      "options": [
        { "label": "API设计规范", "description": "rules/backend/API设计规范.md" },
        { "label": "前端代码规范", "description": "rules/frontend/命名规范.md" },
        { "label": "测试用例规范", "description": "rules/testing/测试用例规范.md" }
      ],
      "multiSelect": true
    }
  ]
}
```

#### Step C: 读取规范 + 生成 constitution

对每个选中的规范文件：
1. 使用 Read 读取全部内容
2. 提取 3-8 条核心 checklist 要点（每条 ≤ 30 字，动宾结构）
3. 写入 constitution.rules

**Checklist 条数校验：** 每条 rule 的 checklist 必须 3-8 条（少于 3 条说明规范太简单可合并，多于 8 条说明需拆分）。

#### Step D: 规范融合（目标从 prd.md §7 改为 dev.json AC）

**旧流程（当前 PRD2JSON Step 3）：** 将 [规范] 条目注入到 prd.md §7 每个 DT 的验收标准中。
**新流程：** PRD2JSON 剥离 §7 后，prd.md 不再有 §7，规范条目直接写入 dev.json。

```
对每个选中的规范 rule:
  1. 根据 DT 涉及的关键词匹配适用规范
     (API/route → API_Rules, 数据库/SQL → DB_Rules,
      前端/组件/UI → Frontend_Rules, 测试/test → Testing_Rules)

  2. 在 dev.json 每个 DT 的 acceptanceCriteria[] 中追加（Typecheck passes 之前）:
     "[规范] 具体规范条目1"
     "[规范] 具体规范条目2"

  3. 只追加与该 DT 直接相关的条目（不是所有规范）
```

### 6.5 testCases + playwrightMcp 生成规则（PRD2JSON 保留 + 增强）

#### testCases 基本规则

每个 DT 必须有至少一条 testCase：
```json
{ "type": "typecheck", "desc": "TypeScript 编译通过" }
```

根据 DT 的**具体功能**追加（desc 必须描述该 DT 的实际行为，不能写泛泛的"UI 渲染"）：

| 任务类型 | 触发条件 | 生成 testCase 示例 |
|---------|---------|-------------------|
| E2E | 涉及用户可见的交互：页面、弹窗、按钮、表单、数据展示、API 端点 | `{ "type": "e2e", "desc": "点击导入按钮，弹窗正确打开并显示文件选择器" }` |
| Unit | 涉及纯逻辑：数据转换、计算、schema 验证、工具函数 | `{ "type": "unit", "desc": "convertStatus() 正确映射所有状态枚举", "tdd": true }` |
| Manual | 涉及视觉/动画效果无法自动验证 | `{ "type": "manual", "desc": "拖拽元素时动画流畅无卡顿" }` |

**强制规则：**
- `desc` 必须具体描述该 DT 的行为，不得写"测试功能正常"、"页面渲染正确"等无意义描述
- 一个 DT 可同时有多种 type（如既有 unit 又有 e2e）
- 任何 UI 交互、API 端点相关的 DT 必须至少有一条 e2e testCase

**拦截门（dev.json 保存前）：**
若任意 DT 的 testCases 为空数组 `[]` → **拒绝保存 dev.json**，报错：
> "❌ DT-{id} testCases 为空，请根据 DT 描述和验收标准生成对应 testCases"

#### playwrightMcp 详细规则

所有 `type: "e2e"` 的 testCase **必须**包含 `playwrightMcp` 字段：

```json
{
  "type": "e2e",
  "desc": "点击新建项目按钮，弹窗正确打开并能输入名称",
  "playwrightMcp": {
    "url": "/stage1",
    "steps": [
      { "action": "navigate", "url": "/stage1" },
      { "action": "snapshot", "assert": "页面正常加载，显示阶段一标题和新建项目按钮" },
      { "action": "click", "element": "新建项目按钮" },
      { "action": "wait_for", "text": "项目名称" },
      { "action": "fill", "element": "项目名称输入框", "value": "测试项目" },
      { "action": "click", "element": "确认按钮" },
      { "action": "assert_visible", "text": "测试项目" }
    ]
  }
}
```

**step action 类型（对应 Playwright MCP 工具）：**

| action | 对应 MCP 工具 | 必含字段 | 说明 |
|--------|-------------|---------|------|
| `navigate` | `browser_navigate` | `url` | 跳转到页面 |
| `snapshot` | `browser_snapshot` + Claude 判断 | `assert`（期望状态描述） | 截取 accessibility tree，Claude 验证 assert 条件 |
| `click` | `browser_snapshot` 找 ref → `browser_click` | `element`（人类可读描述） | 先 snapshot 定位，再点击 |
| `fill` | `browser_snapshot` 找 ref → `browser_type` | `element`、`value` | 先 snapshot 定位输入框，再输入 |
| `wait_for` | `browser_wait_for` | `text` | 等待特定文字出现 |
| `assert_visible` | `browser_snapshot` 分析 | `text` | 验证文字/元素存在于页面 |
| `assert_not_visible` | `browser_snapshot` 分析 | `text` | 验证文字/元素不存在于页面 |
| `screenshot` | `browser_take_screenshot` | `filename` | 截图留证（用描述性文件名） |

**playwrightMcp 生成约束：**
- `url` 用**相对路径**（如 `/stage1`、`/dashboard`），Testing Layer 3b 会自动拼上 `http://localhost:$TEST_PORT`
- steps 数量：**3-8 步**，每步对应一个明确操作或验证点
- `element` 描述必须人类可读，使用功能性描述（如 "新建项目按钮"、"名称输入框"），**禁止写 CSS 选择器**
- `assert` / `assert_visible` 的 text 必须是页面中会实际出现的文字内容
- **禁止**写通用步骤（如 "verify page works"、"check UI renders"）
- **每条 playwrightMcp 对应该 DT 的核心验收场景**，步骤要能还原一个真实用户操作流程

### 6.6 双写策略 + Checklist Before Saving（PRD2JSON 保留 + 更新）

#### 双写策略

```bash
TASKS_DIR="$([ -d BotoolAgent/tasks ] && echo BotoolAgent/tasks || echo tasks)"
PROJECT_DIR="$TASKS_DIR/<projectId>"

# 1. 主文件：$PROJECT_DIR/dev.json（与 Viewer 对齐）
Write dev.json → $PROJECT_DIR/dev.json

# 2. 兼容副本：./dev.json（项目根目录）
#    BotoolAgent.sh 和 CLAUDE.lead.md 从 $PROJECT_DIR/dev.json 或根目录读取
Write dev.json → ./dev.json (项目根目录，内容相同)

# 3. 更新 registry：$TASKS_DIR/registry.json

# 同时重置 progress 文件：
# $PROJECT_DIR/progress.txt + ./progress.txt
```

#### Archiving Previous Runs

写入新 dev.json 前，检查已有文件：

1. 检查根目录是否有 `./prd.json` 或 `./dev.json`
2. 如果存在且 `branchName` 与当前不同 AND `progress.txt` 有内容：
   - 创建 archive 目录: `archive/YYYY-MM-DD-feature-name/`
   - 将旧文件移入 archive
   - 重置 progress.txt

#### Checklist Before Saving（15 项质量门控）

以下所有检查必须在 dev.json 写入磁盘前通过，任一失败 → 拒绝保存：

- [ ] Previous run archived (if dev.json exists with different branchName)
- [ ] `prdFile` points to correct PRD markdown path
- [ ] **每个 DT 有 description**（非空，≥ 2 句话）
- [ ] **每个 DT 有 acceptanceCriteria[]**（≥ 3 条）
- [ ] **每个 DT 有 designRefs[]**（≥ 1 条）
- [ ] Each task completable in one iteration
- [ ] Tasks ordered by dependency (no task depends on a later task)
- [ ] Every task has at least one eval (typecheck)
- [ ] Sessions have max 8 tasks each
- [ ] **规范融合完成**: dev.json 每个匹配规范的 DT 有 [规范] AC 条目（有 rules/ 时）
- [ ] **Constitution 使用 file+checklist**: 每条 rule 有 file 路径 + 3-8 条 checklist
- [ ] **Steps 颗粒度**: 有 steps 的 DT 每步可用单条命令验证，3-6 步
- [ ] **testCases 非空**: 每个 DT 至少有 typecheck；涉及 UI/API 的 DT 至少有一条 e2e；所有 desc 具体描述该 DT 的实际行为
- [ ] **playwrightMcp 已注入**: 所有 type=e2e 的 testCase 必须含 playwrightMcp 字段；steps 3-8 步；url 用相对路径
- [ ] **registry.json 已更新**: devJson 字段正确

### 6.7 非 Transform 模式完整性比对（PRD2JSON 保留）

**触发条件：** PRD2JSON 输出后，如果存在 DRAFT.md 或 SOURCE_PRD.ref 源文件，自动执行完整性比对。

1. 确定源文件：`SOURCE_PRD.ref`（Transform 模式）> `DRAFT.md`（Brainstorm 模式）> 无源文件（跳过）
2. 从源文件提取：数据表清单、功能点清单、API 端点清单、业务规则清单
3. 从生成的 prd.md 提取相同四类结构
4. 对比差异：❌ MISSING（必须修复）/ ✅ ADDED（PyramidPRD 增强）/ ✅ COVERED
5. 生成报告写入 `$PROJECT_DIR/prd-completeness-report.md`

**结论为 FAIL 时：** 使用 AskUserQuestion 让用户决策：自动补充 / 手动修复 / 确认接受（差距记录在 `prd-completeness-report.md` 中）。

## 7. 开发计划

### 7.0 Phase 依赖图

```
Phase 1 ──▶ Phase 2 ──▶ Phase 3 ──▶ Phase 4
PyramidPRD   PRD2JSON    消费方适配    端到端
最小改动     重构(主工作) Lead/Test/   验证
(P0)         (P0)        Coding/Fin   (P1)
                         /Sh/Review
                         (P0)

依赖关系:
Phase 2 依赖 Phase 1（auto-chain 指令 + prd.md 格式确定后，PRD2JSON 才能重构）
Phase 3 依赖 Phase 2（消费方需要 dev.json 格式确定后才能适配）
Phase 4 依赖 Phase 1-3 全部完成（端到端验证需要完整 CLI 管线）

注: Viewer 适配（18 个文件）留 CLI 层完成后单独撰写 Viewer PRD
```

### 7.1 Phase 1: PyramidPRD 最小改动 (P0)

> **前置**: 无
> **产出**: PyramidPRD Phase 7 末尾自动 chain PRD2JSON；Transform Mode T7 字段级校验
> **对应设计**: §3.3, §6.1 (BR-005~BR-007)

- [ ] DT-001: PyramidPRD Phase 7 — 添加 auto-chain 指令 (`文件: skills/BotoolAgent/PyramidPRD/SKILL.md`)
  - Phase 7 生成 prd.md（含 §7，格式不变）后，末尾添加 auto-chain 逻辑：
    1. 输出提示: "✅ prd.md 已生成。正在自动调用 PRD2JSON 生成 dev.json..."
    2. 使用 Skill 工具自动调用 `prd2json`，传入 `{mode, projectId, prerequisites}`
       - `mode`: 当前模式（quick-fix / feature / full / transform）
       - `projectId`: 项目 ID
       - `prerequisites`: Phase 5.5 收集的外部依赖列表（如有）
    3. chain 失败处理: 输出明确错误 + 提示用户手动运行 `/prd2json`
  - **删除** Phase 7 中已有的 prd.json 直接生成逻辑（~L1002）
  - **删除** Phase 7 中已有的 registry.json 更新逻辑（~L1003）— registry 更新统一由 PRD2JSON 负责
  - 清理 Phase 7 末尾引导用户运行 `/prd2json` 的提示语（L1880-1883，改为 auto-chain）
  - AC:
    - [ ] Phase 7 完成后自动调用 PRD2JSON（Skill 工具），传入 {mode, projectId, prerequisites}
    - [ ] Phase 7 不再直接生成 prd.json
    - [ ] Phase 7 不再更新 registry.json（由 PRD2JSON 统一处理）
    - [ ] chain 成功时输出 "✅ 两件套已生成"
    - [ ] chain 失败时输出错误 + "请手动运行 /prd2json"
    - [ ] 不再有引导用户手动运行 /prd2json 的提示
    - [ ] Typecheck passes (N/A, Markdown file)

- [ ] DT-002: PyramidPRD — Quick Fix 模式 auto-chain 适配 (`文件: skills/BotoolAgent/PyramidPRD/SKILL.md`)
  - Quick Fix 当前直接生成 prd.md + prd.json（~L325，绕过 PRD2JSON）
  - 修改: Quick Fix 生成 prd.md（含极简 §7）后，同样 auto-chain PRD2JSON
  - **删除** Quick Fix 中直接生成 prd.json 的逻辑（~L325）
  - **删除** Quick Fix 中 registry.json 更新逻辑
  - AC:
    - [ ] Quick Fix 不再直接生成 prd.json
    - [ ] Quick Fix 不再更新 registry.json
    - [ ] Quick Fix 完成后 auto-chain PRD2JSON，传入 {mode: "quick-fix", projectId, prerequisites}
    - [ ] Quick Fix 通过 chain 获得两件套: prd.md + dev.json
    - [ ] Quick Fix 完成时间仍在 5 分钟以内
    - [ ] Typecheck passes (N/A)

- [ ] DT-003: PyramidPRD — Transform Mode T1 备份 + T7 字段级校验 (`文件: skills/BotoolAgent/PyramidPRD/SKILL.md`)
  - T1 新增备份步骤：`cp source → prd_original.md`（只读备份，作为 T7 比对基准）
  - T7 重写为双重校验：
    1. DT ↔ prd.md 交叉检查：抽查 DT 涉及的关键字段是否出现在 prd.md 对应 designRefs 章节
    2. SQL 字段完整性检查：逐表对比 prd_original.md 和 prd.md 的 CREATE TABLE 字段数
  - T7 不再只检查行数和 CREATE TABLE 数量
  - AC:
    - [ ] Transform Mode T1 创建 prd_original.md 备份
    - [ ] T7 执行 DT↔prd.md 交叉检查
    - [ ] T7 执行 SQL 字段完整性检查（逐表对比字段数）
    - [ ] T7 发现字段缺失时自动补充（不报假阳性 ✅）
    - [ ] Typecheck passes (N/A)

- [ ] DT-004: PyramidPRD — Transform Mode T2.5 字段数校验增强 (`文件: skills/BotoolAgent/PyramidPRD/SKILL.md`)
  - 当前 T2.5 只检查表名是否存在，增加字段数校验
  - 每读完一张 CREATE TABLE，记录字段数量
  - T2.5 校验时对比已记录字段数与源 PRD 字段数
  - AC:
    - [ ] T2.5 校验包含字段数对比
    - [ ] 字段数差异 > 20% 时触发补充读取
    - [ ] Typecheck passes (N/A)

### 7.2 Phase 2: PRD2JSON 重构 (P0) — 主工作

> **前置**: Phase 1（auto-chain 指令就绪，prd.md 格式确定）
> **产出**: PRD2JSON 从 slim prd.json 生成器变为 fat dev.json 生成器
> **对应设计**: §3.3, §4.1-§4.4, §6.3-§6.7

- [ ] DT-005: PRD2JSON — 输出从 slim prd.json → fat dev.json (Schema 变更) (`文件: skills/BotoolAgent/PRD2JSON/SKILL.md`)
  - 修改 dev.json 输出 schema，按 §4.1 定义：
    - devTasks[]: 移除 `prdSection` → 新增 `description`(必填), `acceptanceCriteria[]`(必填), `designRefs[]`(必填), `files[]`(可选)
    - 保留所有现有字段: project, branchName, description, prdFile, prerequisites, sessions, constitution, evals, testCases, steps
  - prerequisites 字段处理：如果 chain 参数中传入了 prerequisites，直接使用；否则检查 prd.md 是否有相关信息
  - AC:
    - [ ] 输出文件名为 dev.json（非 prd.json）
    - [ ] dev.json 按 §4.1 schema 生成
    - [ ] 每个 DT 有 description（非空，≥ 2 句话）
    - [ ] 每个 DT 有 acceptanceCriteria[]（≥ 3 条）
    - [ ] 每个 DT 有 designRefs[]（≥ 1 条，格式 "§X.Y 标题"）
    - [ ] devTasks[].prdSection 字段**不存在**
    - [ ] prerequisites 从 chain 参数或 prd.md 中正确获取
    - [ ] Typecheck passes (N/A)

- [ ] DT-006: PRD2JSON — §7 剥离逻辑 (`文件: skills/BotoolAgent/PRD2JSON/SKILL.md`)
  - 新增 §7 剥离步骤（在生成 dev.json 之后执行）：
    1. 定位 prd.md 中的 `## 7. 开发计划` 章节及其所有子章节
    2. 提取 §7 内容（已在生成 dev.json 时使用）
    3. 从 prd.md 中移除 §7 整体
    4. 更新 §8 编号（如果 §8 在 §7 之后，无需重编号——直接保留 §8 原编号即可，因为 §7 空白不影响标题引用）
    5. 回写更新后的 prd.md（§1-§6+§8，无 §7）
  - AC:
    - [ ] prd.md 执行后不含 `## 7. 开发计划` 及子章节
    - [ ] prd.md 的 §1-§6 和 §8 内容完整保留
    - [ ] §8 编号保持不变（允许 §7 空缺）
    - [ ] 剥离操作不破坏其他章节的格式
    - [ ] **§7 剥离仅在 dev.json 成功写入磁盘后执行**（写入失败则保留 §7 不变，防止数据丢失）
    - [ ] Typecheck passes (N/A)

- [ ] DT-007: PRD2JSON — 规范确认 fusion 目标变更 (`文件: skills/BotoolAgent/PRD2JSON/SKILL.md`)
  - 按 §6.4 Step D 修改规范融合目标：
    - 旧：[规范] 条目 → prd.md §7 的 DT 验收标准
    - 新：[规范] 条目 → dev.json acceptanceCriteria[]
  - 规范扫描、用户确认流程不变（§6.4 Step A-C）
  - AC:
    - [ ] [规范] 条目出现在 dev.json 的 acceptanceCriteria[] 中
    - [ ] 不再向 prd.md §7 注入规范条目（§7 已剥离）
    - [ ] rules/ 为空时 constitution.rules 为空数组，ruleAuditSummary 含警告
    - [ ] **Quick Fix 模式（chain 参数 mode="quick-fix"）跳过 Step B 用户确认，自动保留全部规范**
    - [ ] Typecheck passes (N/A)

- [ ] DT-008: PRD2JSON — testCases/evals/steps/playwrightMcp/sessions 确认保留 (`文件: skills/BotoolAgent/PRD2JSON/SKILL.md`)
  - 验证并确认以下现有逻辑在重构后仍正常工作：
    - testCases 生成规则（§6.5）：每个 DT 至少 typecheck，UI/API DT 有 e2e
    - playwrightMcp 规则：8 种 action 类型，steps 3-8 步
    - evals 生成规则：typecheck 必有 + 按任务类型追加
    - steps 生成规则：3-6 步，每步可验证
    - sessions 分组规则：依赖同组、文件重叠同组、max 8
    - testCases 拦截门：空 testCases → 拒绝保存
  - 确保上述规则适用于新的 dev.json 格式（字段名不变，无需改动）
  - AC:
    - [ ] testCases 生成规则正常工作（与重构前一致）
    - [ ] playwrightMcp 注入正常（所有 e2e 有 playwrightMcp）
    - [ ] evals 生成正常（每个 DT 至少 typecheck）
    - [ ] steps 生成正常（3-6 步）
    - [ ] sessions 分组正常（max 8）
    - [ ] testCases 空时拒绝保存 dev.json
    - [ ] Typecheck passes (N/A)

- [ ] DT-009: PRD2JSON — 双写 + Archiving + Checklist + 完整性比对更新 (`文件: skills/BotoolAgent/PRD2JSON/SKILL.md`)
  - 双写策略更新（§6.6）：prd.json → dev.json
    - 主文件: `tasks/<id>/dev.json`
    - 兼容副本: `./dev.json`（根目录）
  - Archiving 更新：检查旧 prd.json **和** dev.json
  - Checklist Before Saving 15 项更新：字段名从 prd.json/prdSection → dev.json/designRefs，移除 devFile 检查
  - 完整性比对（§6.7）：触发条件和流程不变
  - AC:
    - [ ] dev.json 写入 `tasks/<id>/dev.json`（主文件）
    - [ ] dev.json 写入 `./dev.json`（根目录兼容副本）
    - [ ] 旧 prd.json 或 dev.json 的 branchName 不同时自动归档
    - [ ] Checklist 15 项全部通过才保存
    - [ ] 有 DRAFT.md/SOURCE_PRD.ref 时执行完整性比对
    - [ ] progress.txt 同步重置
    - [ ] Typecheck passes (N/A)

- [ ] DT-010: PRD2JSON — registry.json 字段更新 (`文件: skills/BotoolAgent/PRD2JSON/SKILL.md`)
  - registry.json 写入逻辑更新：
    - 新增 `devJson` 字段（指向 `<projectId>/dev.json`）
    - 移除 `prdJson` 字段
    - 保留 `prdMd` 字段
  - **注意**: registry.json 更新现在只在 PRD2JSON 中发生（PyramidPRD 不再更新 registry）
  - AC:
    - [ ] registry.json 包含 devJson 字段
    - [ ] registry.json 不含 prdJson 字段
    - [ ] prdMd 字段保留且正确
    - [ ] Typecheck passes (N/A)

- [ ] DT-011: PRD2JSON — Viewer Mode 文字更新 (`文件: skills/BotoolAgent/PRD2JSON/SKILL.md`)
  - Viewer Mode（检测到 Viewer 环境时的行为）文字引用更新：
    - "prd.json" → "dev.json" 在所有用户可见的提示文字中
    - 保留打开 /stage2 的行为（Viewer 工作流重构留后续版本）
  - AC:
    - [ ] 用户可见提示中不再出现 "prd.json"（改为 "dev.json"）
    - [ ] Viewer Mode 仍能正确打开 /stage2
    - [ ] Typecheck passes (N/A)

### 7.3 Phase 3: 消费方适配 (P0)

> **前置**: Phase 2（dev.json 格式确定）
> **产出**: Lead Agent、Testing Agent、Coding SKILL、Finalize SKILL、BotoolAgent.sh、PRDReview 正确读取 dev.json
> **对应设计**: §3.2, §6.2

- [ ] DT-012: CLAUDE.lead.md — 胖模式升为唯一模式 (`文件: CLAUDE.lead.md`)
  - 将当前 Fat 模式（有 description/acceptanceCriteria）升为唯一执行模式
  - 删除 Slim 模式（prdFile + prdSection 跳读流程）
  - 删除模式判断逻辑（if/else）
  - 删除跳读失败处理逻辑（prdSection 行号无效时的 blocked 标记）
  - 文件路径：优先查找 `dev.json`（不再 fallback 到 prd.json）
  - 新增 designRefs 读取逻辑：当 DT 有 designRefs 时，用标题关键词在 prd.md 中搜索对应章节
  - AC:
    - [ ] 不再有 Slim 模式代码
    - [ ] 不再有 prdSection 相关逻辑
    - [ ] 不再有跳读失败处理代码
    - [ ] 读取路径为 dev.json（无 prd.json fallback）
    - [ ] Lead Agent 使用 description + acceptanceCriteria[] 执行任务
    - [ ] designRefs 触发时正确读取 prd.md 对应章节
    - [ ] Typecheck passes (N/A)

- [ ] DT-013: Testing SKILL.md — dev.json 路径更新 (`文件: skills/BotoolAgent/Testing/SKILL.md`)
  - PRD_PATH 从 `tasks/${PROJECT_ID}/prd.json` 改为 `tasks/${PROJECT_ID}/dev.json`
  - 移除 prd.json fallback 逻辑
  - 报错提示中文件名从 `prd.json` 改为 `dev.json`
  - AC:
    - [ ] PRD_PATH 指向 dev.json
    - [ ] 不再有 prd.json fallback
    - [ ] 错误提示显示 dev.json
    - [ ] testCases/branchName 等字段正确读取
    - [ ] Typecheck passes (N/A)

- [ ] DT-014: Coding SKILL.md — dev.json 路径更新 (`文件: skills/BotoolAgent/Coding/SKILL.md`)
  - 搜索所有 `prd.json` 引用，替换为 `dev.json`
  - 更新文件读取路径和错误提示
  - AC:
    - [ ] 不再有 `prd.json` 字面量引用
    - [ ] dev.json 路径正确
    - [ ] 启动开发时正确读取 dev.json
    - [ ] Typecheck passes (N/A)

- [ ] DT-015: Finalize SKILL.md — dev.json 路径更新 (`文件: skills/BotoolAgent/Finalize/SKILL.md`)
  - 搜索所有 `prd.json` 引用，替换为 `dev.json`
  - 更新文件读取路径和错误提示
  - AC:
    - [ ] 不再有 `prd.json` 字面量引用
    - [ ] dev.json 路径正确
    - [ ] finalize 流程正确读取 dev.json
    - [ ] Typecheck passes (N/A)

- [ ] DT-016: BotoolAgent.sh — prd.json → dev.json 路径更新 (`文件: scripts/BotoolAgent.sh`)
  - BotoolAgent.sh 中有 15+ 处硬编码 `prd.json`，需要全部更新：
    - `if [ "$PRD_BASENAME" = "prd.json" ]` → `"dev.json"`（~L92-117 basename 检查逻辑）
    - `PRD_FILE="$PROJECT_DIR/prd.json"` → `"$PROJECT_DIR/dev.json"`
    - `ERROR: prd.json not found` → `dev.json`
    - 日志输出 `prd.json:` → `dev.json:`
    - `BOTOOL_PRD_FILE=$PRD_FILE` — 环境变量名可保持（指向 dev.json）
  - 多 PRD 路径逻辑（~L92-117）: basename 判断从 `"prd.json"` → `"dev.json"`
  - 所有 grep 读取字段（branchName, passes, DT-id）不需要改（dev.json 字段名相同）
  - AC:
    - [ ] BotoolAgent.sh 中不再有 `prd.json` 字面量
    - [ ] PRD_FILE 指向 `$PROJECT_DIR/dev.json`
    - [ ] basename 判断使用 `"dev.json"`（非 `"prd.json"`）
    - [ ] `BOTOOL_PRD_FILE` 环境变量正确指向 dev.json
    - [ ] branchName/passes/DT-id 的 grep 读取仍正常工作
    - [ ] BotoolAgent.sh 能正确启动 Lead Agent 并传递正确的文件路径
    - [ ] Typecheck passes (N/A, Shell script)

- [ ] DT-017: PRDReview SKILL.md — 适配两件套审查 (`文件: skills/BotoolAgent/PRDReview/SKILL.md`)
  - 审查范围从 prd.md + prd.json 改为 prd.md + dev.json
  - **enrich 模式**从直接修改 prd.json 改为修改 dev.json
  - 新增检查项：
    - prd.md 不含 §7
    - dev.json 每个 DT 有 description + acceptanceCriteria[]
    - dev.json designRefs 指向的 prd.md 章节实际存在
  - AC:
    - [ ] 审查两个文件: prd.md, dev.json
    - [ ] enrich 模式修改 dev.json（不再修改 prd.json）
    - [ ] 检查 prd.md 不含 §7
    - [ ] 检查 dev.json DT 字段完整性
    - [ ] 检查 designRefs 有效性
    - [ ] Typecheck passes (N/A)

### 7.4 Phase 4: 端到端验证 (P1)

> **前置**: Phase 1-3 全部完成（端到端验证需要完整 CLI 管线）
> **产出**: botool-present-v16 验证通过，CLI 完整管线确认

- [ ] DT-018: 端到端验证 — 重新转换 botool-present-v16
  - 使用重构后的 PyramidPRD（auto-chain PRD2JSON）重新处理 8120 行 PRD
  - 验证 CREATE TABLE 字段完整率 ≥ 95%
  - 验证业务规则覆盖率 ≥ 40%
  - 验证 dev.json 每个 DT 有有效的 description + AC[]
  - 验证 T7 字段级校验不再报假阳性
  - 验证 Lead Agent 能正确读取 dev.json 执行任务
  - 验证 BotoolAgent.sh 能正确启动并传递 dev.json
  - AC:
    - [ ] botool-present-v16 成功转换为两件套（prd.md + dev.json）
    - [ ] prd.md 不含 §7
    - [ ] CREATE TABLE 字段完整率 ≥ 95%
    - [ ] 业务规则覆盖率 ≥ 40%
    - [ ] dev.json 所有 DT 有 description + AC[]
    - [ ] T7 不再有假阳性
    - [ ] BotoolAgent.sh 能正确启动并读取 dev.json

## 8. 附录

### A. 代码文件索引

| 文件路径 | 状态 | Phase | 任务 |
|---------|------|-------|------|
| `skills/BotoolAgent/PyramidPRD/SKILL.md` | 修改 | Phase 1 | DT-001~DT-004 |
| `skills/BotoolAgent/PRD2JSON/SKILL.md` | **修改** | Phase 2 | DT-005~DT-011 |
| `CLAUDE.lead.md` | 修改 | Phase 3 | DT-012 |
| `skills/BotoolAgent/Testing/SKILL.md` | 修改 | Phase 3 | DT-013 |
| `skills/BotoolAgent/Coding/SKILL.md` | 修改 | Phase 3 | DT-014 |
| `skills/BotoolAgent/Finalize/SKILL.md` | 修改 | Phase 3 | DT-015 |
| `scripts/BotoolAgent.sh` | 修改 | Phase 3 | DT-016 |
| `skills/BotoolAgent/PRDReview/SKILL.md` | 修改 | Phase 3 | DT-017 |
| `tasks/registry.json` | 修改(运行时) | Phase 2 | DT-010 |

### B. 风险与缓解措施

#### HIGH
- **auto-chain 失败**: PyramidPRD auto-chain PRD2JSON 时，如果 PRD2JSON skill 不存在、未安装、或执行出错 → 两件套不完整，用户以为已完成但实际只有 prd.md → **缓解**: DT-001 添加 chain 失败处理（输出明确错误 + 提示手动运行 /prd2json）；PRD2JSON 不删除，始终可手动调用。
- **§7 剥离破坏 prd.md**: PRD2JSON 从 prd.md 移除 §7 时，可能残留片段、破坏后续章节格式或丢失内容 → **缓解**: DT-006 AC 要求验证 prd.md §1-§6+§8 完整保留；剥离前先读取 §7 内容用于生成 dev.json，再执行移除操作。
- **BotoolAgent.sh 硬编码 prd.json（15+ 处）**: 遗漏任何一处 → BotoolAgent.sh 启动失败或 Lead Agent 读取错误文件 → **缓解**: DT-016 使用全局搜索替换，AC 要求"不再有 prd.json 字面量"。
- **规范融合目标变更**: 旧流程注入 prd.md §7（已剥离），新流程需写入 dev.json AC → 如果遗漏，Lead Agent constitution review 将无效 → **缓解**: DT-007 AC 明确要求"[规范] 条目出现在 dev.json"。

#### MEDIUM
- **T7 字段级校验逻辑复杂**: 需要精确定位 prd.md 和 prd_original.md 中的对应章节 → **缓解**: 使用 designRefs 的标题关键词定位而非行号，抗漂移。
- **Quick Fix 时间增加**: auto-chain 增加 PRD2JSON 步骤，可能让 Quick Fix 从 2 分钟变成 5-10 分钟 → **缓解**: DT-002 AC 要求 "Quick Fix 完成时间仍在 5 分钟以内"；PRD2JSON Quick Fix 模式简化处理。
- **消费方遗漏**: Coding SKILL、Finalize SKILL 中可能有未发现的 prd.json 引用 → **缓解**: DT-014、DT-015 使用全局搜索确认无遗漏。
- **PyramidPRD prd.json 生成残留**: PyramidPRD Phase 7 当前直接生成 prd.json（~L1002）+ 更新 registry（~L1003），如果 DT-001/002 遗漏删除这些逻辑，会导致同时存在 prd.json 和 dev.json → **缓解**: DT-001/002 AC 明确要求"不再生成 prd.json"和"不再更新 registry"。

#### LOW
- **PRDReview 适配范围**: enrich 模式从修改 prd.json 改为 dev.json → **缓解**: 风险低，正常开发即可。

### C. 测试策略

#### 端到端测试
- 重新转换 botool-present-v16（8120 行），验证字段完整性和覆盖率
- 对比转换前后的 CREATE TABLE 字段数
- 验证 BotoolAgent.sh → Lead Agent → dev.json 完整链路

#### 集成测试
- Quick Fix 模式 auto-chain 生成两件套
- 功能开发模式 auto-chain 生成两件套
- 完整规划模式 auto-chain 生成两件套
- Transform Mode 生成两件套 + T7 校验 + §7 剥离
- 规范确认环节（全部保留 / 排除部分 / rules/ 为空）
- auto-chain 失败时的错误处理

#### 回归测试
- Lead Agent 使用新 dev.json 执行 DT（验证胖模式工作）
- Testing Agent 使用新 dev.json 路径（验证 testCases 读取）
- Coding SKILL 正确读取 dev.json
- Finalize SKILL 正确读取 dev.json
- PRDReview 审查两件套（含 enrich 模式修改 dev.json）
- BotoolAgent.sh 启动并正确传递 BOTOOL_PRD_FILE

### D. 非目标 (Out of Scope)

- 不删除 PRD2JSON skill（保留并重构，方案 B 核心原则）
- **Viewer dev.json 适配** — 18 个文件（11 API routes + 6 UI 组件 + project-root.ts）留 CLI 层完成后单独撰写 Viewer PRD
- 不拆分 prd.md 为多个 Phase 文件
- 不修改旧有已生成的 prd.json（旧项目全部 archive）
- 不改变 PyramidPRD 的问答流程（L0-L5 保持不变）
- 不修改 pack.sh 打包脚本

### E. 安全检查项

本项目为纯 Markdown Skill 文件 + Shell 脚本修改，无安全关键词触发。
BotoolAgent.sh 修改仅限文件名替换，不涉及用户输入处理。

