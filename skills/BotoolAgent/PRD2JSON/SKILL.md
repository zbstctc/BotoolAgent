---
name: botoolagent-prd2json
description: "Convert PRDs to fat dev.json format for BotoolAgent autonomous execution. dev.json contains all fields needed by the coding agent (description, acceptanceCriteria, designRefs). Triggers on: convert this prd, turn this into json, create dev.json, prd to json."
user-invocable: true
---

# BotoolAgent PRD to dev.json Converter (Fat Index)

Converts PRDs to a **fat dev.json** — a self-sufficient automation file that contains all fields the coding agent needs. PRD.md remains the design source of truth; dev.json embeds description, acceptanceCriteria[], and designRefs[] so agents never need fragile line-number skip-reads.

---

## Overview

This skill supports two modes:
1. **Viewer Mode (Preferred)** - Use the BotoolAgent Viewer web interface for visual PRD selection and conversion
2. **CLI Mode (Fallback)** - Direct conversion in the terminal if Viewer is unavailable

**Announce at start:** "Using BotoolAgent:PRD2JSON to convert a PRD to dev.json format."

---

## Core Design Principle

```
PRD.md (人读 + 设计详情)               dev.json (机器读 + 自动化循环)
════════════════════════════          ════════════════════════════════

完整的设计信息：                        自给自足的执行信息：
- 架构设计 (ASCII)                    - 任务列表 (id/title/passes)
- 数据模型 (SQL)                      - description (完整描述，≥2句)
- UI 设计 (ASCII)                     - acceptanceCriteria[] (验收条件，≥3条)
- 业务规则 (表格)                     - designRefs[] (设计章节引用，标题级)
- 开发计划 (每个任务完整描述)          - evals / testCases / steps
- 代码示例                            - 依赖关系 (dependsOn)
- 测试用例描述                        - 会话分组 (sessions)
- 安全检查项                          - 编码规范 (constitution)

Coding Agent 工作流：
1. 读 dev.json → 找到下一个 passes:false 的任务
2. 读 description + acceptanceCriteria → 直接获取任务上下文
3. 需要设计详情时 → 通过 designRefs 按标题 Grep PRD 章节
4. 实现 → 验证 → 更新 dev.json 的 passes
```

**dev.json 包含 coding agent 所需的全部字段。** description、acceptanceCriteria、designRefs 直接嵌入，消除了旧 prdSection 行号跳读的脆弱性。

---

## Mode Selection: Viewer vs CLI

### Step 1: Check for Available PRDs

```bash
# Check if any PRD files exist (auto-detect mode)
TASKS_DIR="$([ -d BotoolAgent/tasks ] && echo BotoolAgent/tasks || echo tasks)"
ls "$TASKS_DIR"/prd-*.md 2>/dev/null
```

**If no PRDs found:**
```
No PRD files found in tasks/ directory.

Please create a PRD first using /botoolagent-pyramidprd or through the Viewer.
```
Then stop here.

### Step 2: Try Viewer Mode First

```bash
# Auto-detect port: BotoolAgent repo = 3100, other project = 3101
VIEWER_PORT="$([ -d BotoolAgent/viewer ] && echo 3101 || echo 3100)"
lsof -i :"$VIEWER_PORT" | grep LISTEN
```

**If server is NOT running:**
```bash
VIEWER_DIR="$([ -d BotoolAgent/viewer ] && echo BotoolAgent/viewer || echo viewer)"
VIEWER_PORT="$([ -d BotoolAgent/viewer ] && echo 3101 || echo 3100)"
cd "$VIEWER_DIR" && npx next dev --port "$VIEWER_PORT" &
sleep 3
```

**Open Stage 2 directly:**
```bash
VIEWER_PORT="$([ -d BotoolAgent/viewer ] && echo 3101 || echo 3100)"
# macOS
open http://localhost:$VIEWER_PORT/stage2
```

**Announce to user:**
```
BotoolAgent Viewer is ready!

Opening PRD Converter at: http://localhost:<VIEWER_PORT>/stage2

If you prefer the CLI experience, let me know and we can continue here.
```

**Then stop here.** The user will complete conversion in the browser.

### Step 3: CLI Fallback

If the Viewer fails to start or the user prefers CLI, continue with the CLI process below.

---

## CLI Mode (Fallback)

### Step 1: 读取规范确认结果（全自动，无用户交互）

**规范确认已在 PyramidPRD 的 R1 阶段完成。PRD2JSON 只需读取结果。**

```bash
TASKS_DIR="$([ -d BotoolAgent/tasks ] && echo BotoolAgent/tasks || echo tasks)"
PROJECT_DIR="$TASKS_DIR/<projectId>"
JOURNAL_PATH="$PROJECT_DIR/qa-journal.md"
```

**读取 qa-journal.md 中的 R1 规范确认结果：**

1. 检查 `$JOURNAL_PATH` 是否存在
2. 如果存在 → Grep `## R1 规范确认` 章节，提取已确认的规范列表
3. 如果不存在（旧模式/直接调用） → 自动扫描 `rules/` 目录，保留全部规范
4. 对每个已确认的规范文件，读取内容并生成 `constitution.rules` 条目（file + checklist 格式）

**[规范] 条目直接写入 dev.json 的 acceptanceCriteria[]：**
- 对每个 DT，根据 title/description 关键词匹配适用规范
- 将匹配的规范 checklist 条目作为 `[规范] xxx` 格式追加到该 DT 的 `acceptanceCriteria[]` 中
- **不修改 prd.md**（prd.md 是只读的）

**无 rules/ 目录时：**
```json
"constitution": {
  "rules": [],
  "ruleAuditSummary": "rules/ 目录为空，规范检查跳过"
}
```

### Step 2: Fat Conversion

Take the PRD content + constitution rules and generate a **fat dev.json**.

**输出路径（双写策略，兼容 portable 模式）：**
```bash
TASKS_DIR="$([ -d BotoolAgent/tasks ] && echo BotoolAgent/tasks || echo tasks)"
PROJECT_DIR="$TASKS_DIR/<projectId>"

# 双写：
# 1. 主文件：$PROJECT_DIR/dev.json（per-project 目录）
# 2. 兼容副本：./dev.json（项目根目录，BotoolAgent.sh / CLAUDE.lead.md 读取）

# 同时重置对应的 progress 文件：
# $PROJECT_DIR/progress.txt
```

**Conversion process:**

1. **Parse PRD § 7 (开发计划)** — extract all DT entries from each Phase
2. **For each DT, read PRD content then generate fat fields:**
   - 使用 Grep 按 Phase 标题关键词定位 PRD 章节（**不使用行号**，抗行号漂移）
   - 读取该 DT 的描述、验收标准、涉及文件/组件/API 路由
   - 生成 `description`（≥ 2 句话完整描述该任务做什么）
   - 生成 `acceptanceCriteria[]`（≥ 3 条，含 [规范] 条目 + "Typecheck passes"）
   - 生成 `designRefs[]`（≥ 1 条，格式 "§X.Y 章节标题关键词"）
   - 生成 `files[]`（可选，预期产出文件路径）
   - 根据读到的具体内容生成 `testCases`（参见 testCases Generation Rules）
   - 根据涉及文件类型生成 `evals`（参见 Eval Generation Rules）
   - 根据 DT 间依赖关系填写 `dependsOn`
   - **禁止不读 PRD 内容直接推断 testCases，禁止留空 `[]`**
3. **Group tasks into sessions** — based on dependencies and file overlap
4. **Embed constitution** — from Step 1 的 rule 处理结果
5. **Set `prdFile`** — use `tasks/<projectId>/prd.md`（相对于项目根目录）

**What to embed in dev.json:**
- DT id, title, priority, passes
- `description` — 完整任务描述（≥ 2 句话）
- `acceptanceCriteria[]` — 验收条件（≥ 3 条，含 [规范]）
- `designRefs[]` — 设计章节引用（标题关键词格式 "§X.Y 名称"）
- `files[]` — 预期产出文件（可选）
- `dependsOn` — task dependency analysis
- `evals` — executable verification commands
- `testCases` — test metadata with TDD flags
- `sessions` — task grouping

---

## Output Format (Fat dev.json Schema)

```json
{
  "project": "[Project Name]",
  "branchName": "botool/[feature-name-kebab-case]",
  "description": "[Feature description from PRD § 1]",
  "prdFile": "tasks/<projectId>/prd.md",
  "constitution": {
    "rules": [
      {
        "id": "rule-001",
        "name": "API设计规范",
        "category": "backend",
        "file": "rules/backend/API设计规范.md",
        "checklist": [
          "所有请求带 apikey + Authorization header",
          "查询必须附带 is_deleted=eq.false 过滤",
          "软删除用 PATCH 不用 DELETE"
        ]
      }
    ],
    "ruleAuditSummary": ""
  },
  "devTasks": [
    {
      "id": "DT-001",
      "title": "[Task title from PRD § 7]",
      "priority": 1,
      "passes": false,
      "dependsOn": [],
      "description": "添加 task_status 表到数据库 schema，包含 id、name、color 字段。此表用于存储任务的自定义状态标签，支持用户创建和编辑状态类型。",
      "acceptanceCriteria": [
        "task_status 表已创建，含 id/name/color 字段",
        "[规范] 使用参数化查询",
        "Typecheck passes"
      ],
      "designRefs": ["§4.2 Schema 定义", "§3.1 核心概念"],
      "files": ["src/db/schema.ts"],
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
        { "type": "unit", "desc": "核心逻辑单元测试", "tdd": true }
      ],
      "steps": [
        { "action": "create", "file": "src/db/schema.ts", "description": "创建 schema 文件" },
        { "action": "implement", "description": "定义 status 字段和迁移" },
        { "action": "verify", "command": "npx tsc --noEmit", "expected": "exit 0" },
        { "action": "commit", "message": "feat: DT-001 - add status field" }
      ]
    }
  ],
  "sessions": [
    {
      "id": "S1",
      "tasks": ["DT-001", "DT-002", "DT-003"],
      "reason": "Phase 1 数据库基础，有依赖关系"
    }
  ]
}
```

### Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `project` | string | Yes | Project name |
| `branchName` | string | Yes | Git branch, prefixed with `botool/` |
| `description` | string | Yes | Feature description (from PRD § 1) |
| `prdFile` | string | Yes | Path to the PRD markdown file |
| `constitution` | object | No | Coding standards from `rules/` (file+checklist 模式) |
| `prerequisites[]` | Prerequisite[] | No | 外部依赖列表，由 PyramidPRD 依赖扫描自动生成 |
| `devTasks[]` | FatDevTask[] | Yes | Development tasks (fat version) |
| `devTasks[].id` | string | Yes | Task ID (DT-001, DT-002, ...) |
| `devTasks[].title` | string | Yes | Task title |
| `devTasks[].priority` | number | Yes | Execution order |
| `devTasks[].passes` | boolean | Yes | Always `false` initially |
| `devTasks[].description` | string | **Yes** | 完整任务描述（≥ 2 句话） |
| `devTasks[].acceptanceCriteria` | string[] | **Yes** | 验收条件列表（≥ 3 条，含 [规范] 和 Typecheck） |
| `devTasks[].designRefs` | string[] | **Yes** | 设计章节引用（格式 "§X.Y 章节标题"，≥ 1 条） |
| `devTasks[].files` | string[] | No | 预期产出文件路径 |
| `devTasks[].dependsOn` | string[] | No | IDs of tasks this task depends on |
| `devTasks[].evals` | DevTaskEval[] | No | Verification commands |
| `devTasks[].testCases` | TestCase[] | No | Test case metadata with type and tdd flag |
| `devTasks[].testCases[].playwrightMcp` | object | Yes（e2e 必填） | Playwright MCP 执行步骤 |
| `devTasks[].steps` | Step[] | No | 分步执行指引（3-6 步） |
| `sessions[]` | SessionGroup[] | No | Task grouping for batch execution |

### Constitution Rule Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `rules[].id` | string | Yes | Rule ID (rule-001, rule-002, ...) |
| `rules[].name` | string | Yes | Rule display name |
| `rules[].category` | string | Yes | Category (backend, frontend, testing, etc.) |
| `rules[].file` | string | Yes | Path to rule markdown file |
| `rules[].checklist` | string[] | Yes | 3-8 条核心校验要点 |

**Checklist 条数校验：** 每条 rule 的 checklist 必须 3-8 条。不满足时警告用户调整。

---

## designRefs 生成规则

**designRefs 替代旧的 prdSection 行号指针。** 使用标题关键词格式，抗行号漂移。

### 格式

每条 designRef 的格式为 `"§X.Y 章节标题关键词"`，例如：
- `"§4.2 Schema 定义"`
- `"§3.3 状态机"`
- `"§5.2 组件清单"`

### 生成流程

1. **Parse PRD § 7 每个 Phase 的 "对应设计" 引用**
   - Phase 头部通常有 `> **对应设计**: Section 3.3, 4.2, 5.3`
   - 提取这些引用作为该 Phase 下所有 DT 的 designRefs 基础
2. **按 DT 内容匹配细化**
   - 数据库相关 DT → 追加 `§4.X` 引用
   - UI 组件 DT → 追加 `§5.X` 引用
   - 业务规则 DT → 追加 `§6.X` 引用
3. **每个 DT 至少 1 条 designRef**

### Coding Agent 如何使用 designRefs

1. 读取 dev.json 中的 `description` + `acceptanceCriteria` → 获取任务上下文
2. 需要设计详情时，用 designRefs 中的标题关键词 Grep PRD.md
   - 例如 `"§4.2 Schema 定义"` → `Grep "4.2" prd.md` 或 `Grep "Schema 定义" prd.md`
3. 跳读匹配到的章节获取 SQL schema、ASCII 图、业务规则等
4. **无需行号，无需精确 offset** — 标题关键词匹配即可

---

## Eval Generation Rules

Every task must have at least one eval:

```json
{ "type": "code-based", "blocking": true, "command": "npx tsc --noEmit", "expect": "exit-0" }
```

Additional evals based on task content:
- Database tasks → `test -f [migration-file]`
- Component tasks → `test -f [component-file]`
- API tasks → `test -f [route-file]`

### Eval 命令安全白名单

**所有 eval command 必须匹配以下安全模板之一。** 不在白名单中的命令拒绝写入 dev.json。

| 安全模板 | 示例 | 说明 |
|---------|------|------|
| `npx tsc --noEmit` | `npx tsc --noEmit` | TypeScript 类型检查 |
| `npm test` | `npm test` | 运行测试套件 |
| `npx vitest run [path]` | `npx vitest run src/lib/utils.test.ts` | 运行特定测试 |
| `test -f [path]` | `test -f src/components/Button.tsx` | 文件存在检查 |
| `test -d [path]` | `test -d src/lib` | 目录存在检查 |
| `grep -q [pattern] [file]` | `grep -q 'export' src/index.ts` | 内容存在检查 |
| `! grep -q [pattern] [file]` | `! grep -q 'console.log' src/api/route.ts` | 内容不存在检查 |
| `bash -n [file]` | `bash -n scripts/deploy.sh` | Shell 语法检查 |
| `npx eslint [path]` | `npx eslint src/` | Lint 检查 |
| `cd [dir] && npx tsc --noEmit` | `cd viewer && npx tsc --noEmit` | 子目录类型检查 |

**禁止的模式（硬拒绝）：**
- 管道符 `|`（如 `grep x | wc -l`）
- 链式执行 `&&` 超过 2 段（如 `a && b && c`）
- 重定向 `>` `>>` `2>`
- 子 shell `$(...)` 或反引号
- `rm`、`mv`、`cp`、`curl`、`wget` 等副作用命令
- 环境变量展开 `$VAR`（eval 中不应依赖运行时环境）

**拦截门：** dev.json 保存前检查每个 eval.command，不匹配白名单 → 报错并拒绝保存。

---

## testCases Generation Rules

**生成流程：先读 PRD，再写 testCases。**

对每个 DT，必须先读取 PRD 中该 DT 的描述和验收标准（通过 `designRefs` 标题关键词定位 PRD 章节），然后根据具体功能推导 testCases。**禁止不读 PRD 就直接生成，禁止留空数组。**

每个 DT 必须有：
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
若任意 DT 的 testCases 为空数组 `[]` → 拒绝保存 dev.json，报错：
> "❌ DT-{id} testCases 为空，请先通过 designRefs 读取 PRD 内容并生成对应 testCases"
修复所有 DT 的 testCases 后才能继续。

### e2e testCase 必须含 `playwrightMcp` 字段

所有 `type: "e2e"` 的 testCase **必须**包含 `playwrightMcp` 字段，描述 Claude 使用 Playwright MCP 工具执行验收测试的具体操作步骤。这是捕获前端渲染/交互 bug 的核心机制。

**格式：**

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

**playwrightMcp 生成规则：**
- `url` 用**相对路径**（如 `/stage1`、`/dashboard`），Testing Layer 3b 会自动拼上 `http://localhost:$TEST_PORT`
- steps 数量：**3-8 步**，每步对应一个明确操作或验证点
- `element` 描述必须人类可读，使用功能性描述（如 "新建项目按钮"、"名称输入框"），禁止写 CSS 选择器
- `assert` / `assert_visible` 的 text 必须是页面中会实际出现的文字内容
- **禁止**写通用步骤（如 "verify page works"、"check UI renders"）
- **每条 playwrightMcp 对应该 DT 的核心验收场景**，步骤要能还原一个真实用户操作流程

---

## Steps 生成规则（可选）

每个 DT 可包含可选的 `steps` 数组，为 Coding Agent 提供分步执行指引。

### 颗粒度规则（Q1 设计决策）

**核心原则：每步结束时必须能用一条命令验证。**

- 典型 3-4 步，最多 6 步
- 每步必须有明确的可验证产出
- 如果一步无法用单条命令验证，需要拆分

### Step Action 类型

| action | 说明 | 必含字段 |
|--------|------|----------|
| `create` | 创建新文件 | `file` |
| `modify` | 修改已有文件 | `file` |
| `implement` | 实现逻辑（可能跨多文件） | `description` |
| `verify` | 运行验证命令 | `command`, `expected` |
| `commit` | 提交代码 | `message` |

### Steps 示例

```json
{
  "id": "DT-003",
  "title": "实现自动生成标题功能",
  "steps": [
    { "action": "create", "file": "viewer/src/app/api/cli/generate-title/route.ts", "description": "创建 API 路由文件" },
    { "action": "implement", "description": "实现调用 Claude API 生成标题的逻辑" },
    { "action": "verify", "command": "npx tsc --noEmit", "expected": "exit 0" },
    { "action": "commit", "message": "feat: DT-003 - add auto-generate title API" }
  ]
}
```

### 何时必须生成 Steps（强制）

满足以下任一条件时，**必须**生成 steps（不可省略）：
- DT 标题含「迁移」「重构」「多文件」「架构」「替换」等关键词
- DT 涉及 ≥ 2 个不同目录的文件修改
- DT 的 acceptanceCriteria ≥ 5 条
- DT filesToModify ≥ 3 个文件

以下情况**不生成** steps（通常太简单）：
- 纯配置修改（单文件，1-2 行）
- 文档更新
- 单函数 bug fix

---

## Task Size: The Number One Rule

**Each task must be completable in ONE iteration (one context window).**

### Right-sized tasks:
- Add a database table and migration
- Add a UI component to an existing page
- Update a server action with new logic
- Add a filter dropdown to a list

### Too big (split these):
- "Build the entire dashboard" → Split into: schema, queries, UI components, filters
- "Add authentication" → Split into: schema, middleware, login UI, session handling

**Rule of thumb:** If you cannot describe the change in 2-3 sentences, it's too big.

---

## Task Ordering: Dependencies First

Tasks execute in priority order. Earlier tasks must not depend on later ones.

**Correct order:**
1. Schema/database changes (migrations)
2. Server actions / backend logic
3. UI components that use the backend
4. Dashboard/summary views that aggregate data

---

## Session Grouping Rules

- Tasks with dependencies go in the same session
- Tasks modifying the same files go in the same session
- Independent tasks fill by priority
- Max 8 tasks per session
- Each session has a `reason` explaining the grouping

---

## dev.json 输出位置（双写策略）

**双写策略：同时写入 per-project 目录和项目根目录。**

```bash
TASKS_DIR="$([ -d BotoolAgent/tasks ] && echo BotoolAgent/tasks || echo tasks)"
PROJECT_DIR="$TASKS_DIR/<projectId>"

# 1. 主文件：$PROJECT_DIR/dev.json（per-project 目录）
Write dev.json → $PROJECT_DIR/dev.json

# 2. 兼容副本：./dev.json（项目根目录）
#    BotoolAgent.sh 和 CLAUDE.lead.md 从项目根目录读取
Write dev.json → ./dev.json (项目根目录，内容相同)

# 3. 更新 registry：$TASKS_DIR/registry.json
#    格式与 Viewer 的 updateRegistry() 一致
```

**同时重置对应的 progress 文件：**
```bash
# 重置 $PROJECT_DIR/progress.txt
```

---

## Registry 更新

**写完 dev.json 后，更新 `$TASKS_DIR/registry.json`。** 格式与 Viewer 的 `updateRegistry()` 一致。

从 PRD 源文件名派生 `projectId`：`prd-{feature-name}.md` → `projectId = feature-name`

```json
{
  "version": 1,
  "projects": {
    "{feature-name}": {
      "name": "[project name from dev.json]",
      "prdMd": "<projectId>/prd.md",
      "devJson": "<projectId>/dev.json",
      "progress": "<projectId>/progress.txt",
      "branch": "botool/{feature-name}",
      "status": "coding",
      "createdAt": "[ISO timestamp, preserve if existing]",
      "updatedAt": "[current ISO timestamp]"
    }
  },
  "activeProject": "{feature-name}"
}
```

**字段变更：** `prdJson` → **`devJson`**（与文件名 dev.json 对齐），路径改为 per-project 子目录格式。

**更新逻辑：**
1. 读取现有 `$TASKS_DIR/registry.json`（如果存在）
2. 合并/更新当前项目条目（保留 `createdAt`，更新 `updatedAt`）
3. 设置 `activeProject` 为当前项目
4. 写回 `$TASKS_DIR/registry.json`

---

## Archiving Previous Runs

**Before writing a new dev.json, check if there's an existing one from a different feature:**

1. Read current `dev.json` (or legacy `prd.json`) if it exists
2. Check if `branchName` differs from the new feature
3. If different AND `progress.txt` has content:
   - Create archive folder: `archive/YYYY-MM-DD-feature-name/`
   - Copy current `dev.json` and `progress.txt` to archive
   - Reset `progress.txt` with fresh header

---

## Example

**Input PRD (new multi-dimensional format):**

```markdown
# PRD: Task Status Feature

## 1. 项目概述
### 1.1 背景与动机
Add ability to mark tasks with different statuses.

## 4. 数据设计
### 4.2 Schema 定义
CREATE TABLE task_status (...)

## 5. UI 设计
### 5.2 组件清单
| StatusBadge | { status: TaskStatus } | TaskList | 新建 |

## 7. 开发计划

### 7.1 Phase 1: 数据库 (P0)
> **前置**: 无
> **产出**: status 字段
> **对应设计**: Section 4.2

- [ ] DT-001: 添加 status 字段 (`文件: src/db/schema.ts`)

### 7.2 Phase 2: UI (P1)
> **前置**: Phase 1
> **产出**: 状态标签组件
> **对应设计**: Section 5.2, 5.3

- [ ] DT-002: 实现 StatusBadge 组件 (`组件: <StatusBadge>`, `文件: src/components/StatusBadge.tsx`)
```

**Output dev.json (fat):**

```json
{
  "project": "MyApp",
  "branchName": "botool/task-status",
  "description": "Task Status Feature - Track task progress with status indicators",
  "prdFile": "tasks/task-status/prd.md",
  "constitution": {
    "rules": [
      {
        "id": "rule-001",
        "name": "API设计规范",
        "category": "backend",
        "file": "rules/backend/API设计规范.md",
        "checklist": [
          "所有请求带 apikey + Authorization header",
          "查询必须附带 is_deleted=eq.false 过滤",
          "软删除用 PATCH 不用 DELETE"
        ]
      }
    ],
    "ruleAuditSummary": ""
  },
  "devTasks": [
    {
      "id": "DT-001",
      "title": "添加 status 字段",
      "priority": 1,
      "passes": false,
      "dependsOn": [],
      "description": "添加 task_status 表到数据库 schema，包含 id、name、color 字段。此表用于存储任务的自定义状态标签，支持用户创建和编辑状态类型。",
      "acceptanceCriteria": [
        "task_status 表已创建，含 id/name/color 字段",
        "[规范] 使用参数化查询",
        "Typecheck passes"
      ],
      "designRefs": ["§4.2 Schema 定义"],
      "files": ["src/db/schema.ts"],
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
        { "type": "unit", "desc": "task_status 表 Schema 定义包含 id/name/color 字段", "tdd": true }
      ]
    },
    {
      "id": "DT-002",
      "title": "实现 StatusBadge 组件",
      "priority": 2,
      "passes": false,
      "dependsOn": ["DT-001"],
      "description": "创建 StatusBadge React 组件，根据 task_status 的 color 字段渲染对应颜色的状态徽章。组件接收 status 对象作为 props，显示状态名称和圆点指示器。",
      "acceptanceCriteria": [
        "StatusBadge 组件正确渲染状态名称和对应颜色",
        "组件支持所有预定义状态类型",
        "[规范] 使用 Pressable 而非 TouchableOpacity",
        "Typecheck passes"
      ],
      "designRefs": ["§5.2 组件清单", "§5.3 组件交互"],
      "files": ["src/components/StatusBadge.tsx"],
      "evals": [
        {
          "type": "code-based",
          "blocking": true,
          "description": "Typecheck passes",
          "command": "npx tsc --noEmit",
          "expect": "exit-0"
        },
        {
          "type": "code-based",
          "blocking": true,
          "description": "StatusBadge component exists",
          "command": "test -f src/components/StatusBadge.tsx",
          "expect": "exit-0"
        }
      ],
      "testCases": [
        { "type": "typecheck", "desc": "TypeScript 编译通过" },
        {
          "type": "e2e",
          "desc": "在任务列表中，StatusBadge 根据 status 值显示对应颜色的徽章",
          "playwrightMcp": {
            "url": "/tasks",
            "steps": [
              { "action": "navigate", "url": "/tasks" },
              { "action": "snapshot", "assert": "任务列表页面正常加载，可见任务条目" },
              { "action": "assert_visible", "text": "进行中" },
              { "action": "screenshot", "filename": "status-badge-colors.png" }
            ]
          }
        }
      ]
    }
  ],
  "sessions": [
    {
      "id": "S1",
      "tasks": ["DT-001", "DT-002"],
      "reason": "DT-002 依赖 DT-001，放在同一 session"
    }
  ]
}
```

---

## After Conversion (CLI Mode)

Announce next steps:

"dev.json created (fat index):
- Main:   $PROJECT_DIR/dev.json
- Compat: ./dev.json (root copy)
- Registry: $TASKS_DIR/registry.json updated

Ready for autonomous execution:

**Option 1: Use the Viewer (Recommended)**
Open the Viewer `/stage3` page to monitor development visually.

**Option 2: Run from terminal**
```bash
/botoolagent-coding
```

The coding agent will:
1. Read dev.json to find the next task (passes: false)
2. Read description + acceptanceCriteria directly from dev.json
3. Use designRefs to Grep PRD.md for design details when needed
4. Implement, verify, and update passes"

---

## Step 6: PRD 完整性比对（源文件存在时自动执行）

**目标：** 确认生成的 prd.md + dev.json 完整呈现了原版 PRD/草案的所有需求。
功能只能多（PyramidPRD 的增强），不能少（遗漏 = 硬失败）。

### 6.1 确定源文件

```bash
# 优先级：Transform 模式源文件 > Brainstorm 草案
TASKS_DIR="$([ -d BotoolAgent/tasks ] && echo BotoolAgent/tasks || echo tasks)"
PROJECT_DIR="$TASKS_DIR/<projectId>"

if [ -f "$PROJECT_DIR/SOURCE_PRD.ref" ]; then
  SOURCE_FILE=$(cat "$PROJECT_DIR/SOURCE_PRD.ref")
  SOURCE_TYPE="transform"
elif [ -f "$PROJECT_DIR/DRAFT.md" ]; then
  SOURCE_FILE="$PROJECT_DIR/DRAFT.md"
  SOURCE_TYPE="brainstorm"
else
  echo "ℹ️ 无源文件可比对（非 Transform/Brainstorm 模式），跳过 Step 6"
  # 直接进入 Checklist
fi
```

### 6.2 提取源文件关键结构

从源文件中提取：
- **数据表清单**：Grep `CREATE TABLE` → 表名列表
- **功能点清单**：提取 Phase/功能章节标题（`## ` 或 `### ` 一级）→ 功能列表
- **API 端点清单**：Grep `GET /|POST /|PUT /|DELETE /|PATCH /` → 端点列表
- **业务规则清单**：提取规则表格标题或编号（BR-xxx、规则 N）

### 6.3 提取生成 PRD 的相同结构

从 `$PROJECT_DIR/prd.md` 中提取相同四类结构。

### 6.4 对比差异，分类输出

```
缺失项（源文件有，生成 PRD 无）→ 标记为 ❌ MISSING — 必须修复
新增项（生成 PRD 有，源文件无）→ 标记为 ✅ ADDED   — PyramidPRD 增强，可接受
保留项（两者都有）              → 标记为 ✅ COVERED
```

### 6.5 生成报告文件

将报告写入 `$PROJECT_DIR/prd-completeness-report.md`：

````markdown
# PRD 完整性对比报告

**生成时间：** {ISO 时间戳}
**源文件：** {SOURCE_FILE}（{SOURCE_TYPE} 模式）
**生成 PRD：** tasks/{projectId}/prd.md
**生成 JSON：** tasks/{projectId}/dev.json

## 总体结论

| 指标 | 结果 |
|------|------|
| 总体状态 | ✅ PASS / ❌ FAIL |
| 数据表覆盖 | X / Y（源文件 Y 张表，生成 PRD 覆盖 X 张）|
| 功能点覆盖 | X / Y |
| 缺失项数量 | N 项（0 = PASS）|
| 新增项数量 | M 项（PyramidPRD 增强）|

## ❌ 缺失项（必须修复）

| 类别 | 缺失内容 | 源文件位置 | 建议处置 |
|------|---------|---------|---------|
| 数据表 | present_collaborators | §4.3 | 补充到生成 PRD §4 |

（若无缺失项，此节显示：✅ 无缺失，所有源文件需求已完整覆盖）

## ✅ 新增项（PyramidPRD 增强，可接受）

| 类别 | 新增内容 | 来源 |
|------|---------|------|
| 功能 | 批量操作 UI | PyramidPRD L3 分析 |

## 维度详情

### 数据表对比
...

### 功能点对比
...

### API 端点对比
...

### 业务规则对比
...
````

### 6.6 结论处理

**若报告结论为 PASS（缺失项 = 0）：**
> "✅ PRD 完整性比对通过。生成 PRD 完整覆盖源文件所有需求，新增 M 项 PyramidPRD 增强功能。"
> 继续进入 Checklist Before Saving。

**若报告结论为 FAIL（有缺失项）：**
使用 AskUserQuestion 向用户展示缺失项，要求决策：

```json
{
  "questions": [
    {
      "question": "❌ PRD 完整性比对失败：发现 N 项缺失（详见 prd-completeness-report.md）\n\n缺失示例：\n- 数据表 present_collaborators 未在生成 PRD 中找到\n- 功能 parent_id 多层分类结构 未覆盖\n\n请选择处置方式：",
      "header": "完整性比对",
      "multiSelect": false,
      "options": [
        {
          "label": "自动补充缺失项",
          "description": "BotoolAgent 读取源文件缺失章节，补充到生成 PRD 对应位置后重新生成 dev.json"
        },
        {
          "label": "我手动修复后重跑",
          "description": "先手动编辑 prd.md 补充缺失内容，再重新运行 /botoolagent-prd2json"
        },
        {
          "label": "确认接受（记录到报告）",
          "description": "将缺失项记录到 prd-completeness-report.md，继续生成。不建议，可能导致实现偏差。"
        }
      ]
    }
  ]
}
```

若选择"自动补充"：读取源文件对应章节 → 将缺失内容追加到生成 PRD 的对应 § → 重新执行 Step 6 比对 → 直到 PASS。

若选择"确认接受"：在 `prd-completeness-report.md` 的 "已知缺失" 节追加记录，**不写入 dev.json**。

---

## Checklist Before Saving（18 项）

1. - [ ] Previous run archived (if dev.json exists with different branchName)
2. - [ ] `prdFile` points to correct PRD markdown path
3. - [ ] **description ≥ 2 句话**：每个 DT 有完整任务描述
4. - [ ] **acceptanceCriteria[] ≥ 3 条**：每个 DT 含 [规范] 条目 + "Typecheck passes"
5. - [ ] **designRefs[] ≥ 1 条**：每个 DT 有格式 "§X.Y 章节标题" 的设计引用
6. - [ ] Each task completable in one iteration
7. - [ ] Tasks ordered by dependency (no task depends on a later task)
8. - [ ] Every task has at least one eval (typecheck)
9. - [ ] Sessions have max 8 tasks each
10. - [ ] **规范融合完成**：[规范] 条目直接写入 dev.json acceptanceCriteria[]（不修改 prd.md）
11. - [ ] **Constitution 使用 file+checklist**：每条 rule 有 file 路径 + 3-8 条 checklist
12. - [ ] **Steps 颗粒度**：有 steps 的 DT 每步可用单条命令验证，3-6 步
13. - [ ] **testCases 非空**：每个 DT 至少有 typecheck；涉及 UI/API 的 DT 至少有一条 e2e；desc 具体描述实际行为
14. - [ ] **playwrightMcp 已注入**：所有 type=e2e 的 testCase 含 playwrightMcp 字段；steps 3-8 步；url 相对路径
15. - [ ] **registry.json 已更新**：devJson 字段指向 per-project dev.json 路径
16. - [ ] **field-completeness**：扫描所有 DT，确认 description/acceptanceCriteria/designRefs 均满足最低数量
17. - [ ] **designRef-validity**：每条 designRef 的 "§X.Y 名称" 能在 prd.md 中 Grep 匹配到对应章节标题
18. - [ ] **prd-dev-consistency**：prd.md § 7 的 DT 数量和 Phase 结构与 dev.json 的 devTasks 一致
19. - [ ] **Step 6 完整性比对**：若源文件存在，prd-completeness-report.md 已生成且结论为 PASS
20. - [ ] `$PROJECT_DIR/dev.json` written (main file)
21. - [ ] `./dev.json` written (root compat copy)
