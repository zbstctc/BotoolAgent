---
name: botoolagent-prd2json
description: "Convert PRDs to slim prd.json format for BotoolAgent autonomous execution. PRD.md is the single source of truth; prd.json only contains automation fields. Triggers on: convert this prd, turn this into json, create prd.json, prd to json."
user-invocable: true
---

# BotoolAgent PRD to JSON Converter (Slim Index)

Converts PRDs to a **slim prd.json** — an automation index that points back to the PRD for design content. The PRD.md is the Single Source of Truth.

---

## Overview

This skill supports two modes:
1. **Viewer Mode (Preferred)** - Use the BotoolAgent Viewer web interface for visual PRD selection and conversion
2. **CLI Mode (Fallback)** - Direct conversion in the terminal if Viewer is unavailable

**Announce at start:** "Using BotoolAgent:PRD2JSON to convert a PRD to JSON format."

---

## Core Design Principle

```
PRD.md (人读 + agent 读内容)          prd.json (机器读 + 自动化循环)
════════════════════════════          ════════════════════════════════

完整的设计信息：                        精简的自动化信息：
- 架构设计 (ASCII)                    - 任务列表 (id/title/passes)
- 数据模型 (SQL)                      - 依赖关系 (dependsOn)
- UI 设计 (ASCII)                     - 验证命令 (evals)
- 业务规则 (表格)                     - 进度追踪 (passes: true/false)
- 开发计划 (每个任务完整描述)          - 会话分组 (sessions)
- 代码示例                            - 编码规范 (constitution)
- 测试用例描述                        - prdFile 指向 PRD 路径
- 安全检查项                          - prdSection 指向对应章节

Coding Agent 工作流：
1. 读 prd.json → 找到下一个 passes:false 的任务
2. 读 prdSection → 跳读 PRD.md 对应章节 → 获取完整设计上下文
3. 实现 → 验证 → 更新 prd.json 的 passes
```

**prd.json 不再重复 PRD 中的设计内容（description/acceptanceCriteria/spec）。** 这些信息留在 PRD.md 中，coding agent 通过 `prdSection` 跳读获取。

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

Please create a PRD first using /botoolagent-pyramidprd or through the Viewer at:
http://localhost:3000/stage1
```
Then stop here.

### Step 2: Try Viewer Mode First

```bash
# Check if Viewer server is running
lsof -i :3000 | grep LISTEN
```

**If server is NOT running:**
```bash
# Start the Viewer dev server in background
VIEWER_DIR="$([ -d BotoolAgent/viewer ] && echo BotoolAgent/viewer || echo viewer)"
cd "$VIEWER_DIR" && npm run dev &
sleep 3
```

**Open Stage 2 directly:**
```bash
# macOS
open http://localhost:3000/stage2
```

**Announce to user:**
```
BotoolAgent Viewer is ready!

Opening PRD Converter at: http://localhost:3000/stage2

If you prefer the CLI experience, let me know and we can continue here.
```

**Then stop here.** The user will complete conversion in the browser.

### Step 3: CLI Fallback

If the Viewer fails to start or the user prefers CLI, continue with the CLI process below.

---

## CLI Mode (Fallback)

### Step 1: Scan Available Rules

```bash
RULES_DIR="$([ -d BotoolAgent/rules ] && echo BotoolAgent/rules || echo rules)"
find "$RULES_DIR" -name "*.md" -type f 2>/dev/null | sort
```

Present the discovered rules to the user:

```
Found the following coding standards in rules/:

  [1] backend/API设计规范.md
  [2] frontend/命名规范.md
  [3] testing/测试用例规范.md
  ...

All rules are selected by default.
```

### Step 2: Confirm Rule Selection (AskUserQuestion)

Use `AskUserQuestion` to confirm with the user:

```
Question: "以上规范默认全部应用到 prd.json 中。是否需要排除某些规范？"
Options:
  - "全部保留（推荐）"
  - "排除部分规范"
```

- If "全部保留" → use all discovered rules
- If "排除部分规范" → follow up with a multi-select question listing each rule

After confirmation, **read the content of each selected rule file** to embed as `constitution.rules`.

### Step 3: Slim Conversion

Take the PRD content + selected rules and generate a **slim prd.json**.

**输出路径（双写策略，兼容 portable 模式）：**
```bash
TASKS_DIR="$([ -d BotoolAgent/tasks ] && echo BotoolAgent/tasks || echo tasks)"

# 从 PRD 源文件名派生 JSON 文件名：
# 例如 tasks/prd-task-status.md → tasks/prd-task-status.json
PRD_BASENAME=$(basename "$PRD_FILE" .md)   # prd-task-status
JSON_FILE="$TASKS_DIR/${PRD_BASENAME}.json"

# 双写：
# 1. 主文件：$TASKS_DIR/prd-{feature-name}.json（与 Viewer 对齐）
# 2. 兼容副本：./prd.json（项目根目录，BotoolAgent.sh / CLAUDE.lead.md 读取）

# 同时重置对应的 progress 文件：
# $TASKS_DIR/progress-{feature-name}.txt
```

**Conversion process:**

1. **Parse PRD § 7 (开发计划)** — extract all DT entries from each Phase
2. **Map each DT to its PRD section with line numbers** — 使用 Grep 或 Read 获取 `### 7.X` 标题的行号，计算 Phase 的行号范围，生成 `"7.X (LSTART-LEND)"` 格式的 `prdSection`
3. **Extract automation-only fields** — evals, testCases, dependsOn
4. **Group tasks into sessions** — based on dependencies and file overlap
5. **Embed constitution** — selected rule files as `constitution.rules`
6. **Set `prdFile`** — use `$TASKS_DIR/prd-[feature-name].md`（相对于项目根目录）

**What to extract (put in prd.json):**
- DT id, title, priority
- `prdSection` — the Phase section number (e.g., "7.1")
- `dependsOn` — task dependency analysis
- `evals` — executable verification commands
- `testCases` — test metadata with TDD flags
- `sessions` — task grouping

**What NOT to extract (stays in PRD.md):**
- ~~description~~ → in PRD § 7 Phase description
- ~~acceptanceCriteria~~ → in PRD § 7 DT checklist
- ~~spec (codeExamples, testCases descriptions, filesToModify, relatedFiles)~~ → in PRD § 3-6
- ~~contextHint~~ → in PRD § 7 Phase "对应设计" references
- ~~notes~~ → in progress.txt

---

## Output Format (Slim prd.json Schema)

```json
{
  "project": "[Project Name]",
  "branchName": "botool/[feature-name-kebab-case]",
  "description": "[Feature description from PRD § 1]",
  "prdFile": "tasks/prd-[feature-name].md",
  "constitution": {
    "rules": [
      {
        "id": "rule-001",
        "name": "API设计规范",
        "category": "backend",
        "content": "[Full content of the rule file]"
      }
    ],
    "ruleAuditSummary": ""
  },
  "devTasks": [
    {
      "id": "DT-001",
      "title": "[Task title from PRD § 7]",
      "prdSection": "7.1 (L15-22)",
      "priority": 1,
      "passes": false,
      "dependsOn": [],
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
| `prdFile` | string | Yes | **NEW** Path to the PRD markdown file |
| `constitution` | object | No | Coding standards from `rules/` |
| `devTasks[]` | SlimDevTask[] | Yes | Development tasks (slim version) |
| `devTasks[].id` | string | Yes | Task ID (DT-001, DT-002, ...) |
| `devTasks[].title` | string | Yes | Task title |
| `devTasks[].prdSection` | string | Yes | **NEW** PRD section with line range (e.g., "7.1 (L519-528)") |
| `devTasks[].priority` | number | Yes | Execution order |
| `devTasks[].passes` | boolean | Yes | Always `false` initially |
| `devTasks[].dependsOn` | string[] | No | IDs of tasks this task depends on |
| `devTasks[].evals` | DevTaskEval[] | No | Verification commands |
| `devTasks[].testCases` | TestCase[] | No | Test case metadata with type and tdd flag |
| `sessions[]` | SessionGroup[] | No | Task grouping for batch execution |

### Removed Fields (compared to old schema)

| Removed Field | Where it lives now |
|---------------|-------------------|
| `devTasks[].description` | PRD § 7 Phase description |
| `devTasks[].acceptanceCriteria` | PRD § 7 DT checklist items |
| `devTasks[].contextHint` | PRD § 7 Phase "对应设计: Section X.X" |
| `devTasks[].notes` | progress.txt |
| `devTasks[].spec` | PRD § 3-6 (architecture, data, UI, rules) |
| `devTasks[].spec.codeExamples` | PRD § 4 (data design) and § 5 (UI design) |
| `devTasks[].spec.testCases` | PRD § 8.C (testing strategy) |
| `devTasks[].spec.filesToModify` | PRD § 7 DT entries (file paths in parentheses) |
| `devTasks[].spec.relatedFiles` | PRD § 7 Phase "对应设计" references |

---

## prdSection Mapping Rules

PRD2JSON automatically maps each DT to its corresponding PRD section **with line number ranges**:

```
PRD § 7.1 Phase 1 (lines 519-528) 下的 DT-001 ~ DT-003 → prdSection: "7.1 (L519-528)"
PRD § 7.2 Phase 2 (lines 530-547) 下的 DT-004, DT-005   → prdSection: "7.2 (L530-547)"
PRD § 7.3 Phase 3 (lines 549-559) 下的 DT-006 ~ DT-008  → prdSection: "7.3 (L549-559)"
```

### 行号生成流程

转换 PRD.md 时，PRD2JSON 必须：

1. **读取 PRD.md 全文**，使用 Grep 或 Read 获取 `## 7.X` 标题的行号
2. **计算每个 Phase 的行号范围**：从当前 `## 7.X` 标题到下一个 `## 7.Y` 标题（或文件末尾）
3. **写入 prdSection 格式**：`"7.X (LSTART-LEND)"`

### Coding Agent 如何使用 prdSection

1. 读取 `prdFile` 打开 PRD markdown
2. 使用 `prdSection` 中的行号范围（如 `L519-528`）**精准跳读** Phase 章节
   - 使用 Read 工具的 `offset` 和 `limit` 参数：`offset: 519, limit: 10`
3. 从 Phase 章节中提取：
   - Prerequisites ("前置")
   - Expected output ("产出")
   - Design references ("对应设计: Section 3.X, 4.X, 5.X")
   - Task checklist with file paths and API routes
4. 根据 "对应设计" 引用，跳读 PRD § 3-6 中的设计章节（SQL schemas, UI layouts, business rules）

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

---

## testCases Generation Rules

Every task gets:
```json
{ "type": "typecheck", "desc": "TypeScript 编译通过" }
```

Additional testCases based on task content:
- Tasks with transformation logic → `{ "type": "unit", "desc": "...", "tdd": true }`
- UI/page rendering tasks → `{ "type": "e2e", "desc": "..." }`
- Visual/animation tasks → `{ "type": "manual", "desc": "..." }`

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

## prd.json 输出位置（双写策略）

**双写策略：同时写入 tasks/ 目录和项目根目录。**

```bash
TASKS_DIR="$([ -d BotoolAgent/tasks ] && echo BotoolAgent/tasks || echo tasks)"

# 1. 主文件：$TASKS_DIR/prd-{feature-name}.json（与 Viewer 对齐）
Write prd.json → $TASKS_DIR/prd-{feature-name}.json

# 2. 兼容副本：./prd.json（项目根目录）
#    BotoolAgent.sh 和 CLAUDE.lead.md 从 $PROJECT_DIR/prd.json 读取
Write prd.json → ./prd.json (项目根目录，内容相同)

# 3. 更新 registry：$TASKS_DIR/registry.json
#    格式与 Viewer 的 updateRegistry() 一致
```

**同时重置 progress 文件：**
```bash
# 重置 $TASKS_DIR/progress-{feature-name}.txt（与主文件对应）
# 重置 ./progress.txt（与兼容副本对应）
```

---

## Registry 更新

**写完 JSON 后，更新 `$TASKS_DIR/registry.json`。** 格式与 Viewer 的 `updateRegistry()` 一致。

从 PRD 源文件名派生 `projectId`：`prd-{feature-name}.md` → `projectId = feature-name`

```json
{
  "version": 1,
  "projects": {
    "{feature-name}": {
      "name": "[project name from prd.json]",
      "prdMd": "prd-{feature-name}.md",
      "prdJson": "prd-{feature-name}.json",
      "progress": "progress-{feature-name}.txt",
      "branch": "botool/{feature-name}",
      "status": "coding",
      "createdAt": "[ISO timestamp, preserve if existing]",
      "updatedAt": "[current ISO timestamp]"
    }
  },
  "activeProject": "{feature-name}"
}
```

**更新逻辑：**
1. 读取现有 `$TASKS_DIR/registry.json`（如果存在）
2. 合并/更新当前项目条目（保留 `createdAt`，更新 `updatedAt`）
3. 设置 `activeProject` 为当前项目
4. 写回 `$TASKS_DIR/registry.json`

---

## Archiving Previous Runs

**Before writing a new prd.json, check if there's an existing one from a different feature:**

1. Read current `prd.json` if it exists
2. Check if `branchName` differs from the new feature
3. If different AND `progress.txt` has content:
   - Create archive folder: `archive/YYYY-MM-DD-feature-name/`
   - Copy current `prd.json` and `progress.txt` to archive
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

**Output prd.json (slim):**

```json
{
  "project": "MyApp",
  "branchName": "botool/task-status",
  "description": "Task Status Feature - Track task progress with status indicators",
  "prdFile": "tasks/prd-task-status.md",
  "constitution": {
    "rules": [
      {
        "id": "rule-001",
        "name": "API设计规范",
        "category": "backend",
        "content": "# API 设计规范\n..."
      }
    ],
    "ruleAuditSummary": ""
  },
  "devTasks": [
    {
      "id": "DT-001",
      "title": "添加 status 字段",
      "prdSection": "7.1 (L25-32)",
      "priority": 1,
      "passes": false,
      "dependsOn": [],
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
        { "type": "unit", "desc": "Schema 定义正确", "tdd": true }
      ]
    },
    {
      "id": "DT-002",
      "title": "实现 StatusBadge 组件",
      "prdSection": "7.2 (L34-43)",
      "priority": 2,
      "passes": false,
      "dependsOn": ["DT-001"],
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
        { "type": "e2e", "desc": "页面正确渲染状态标签" }
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

"prd.json created (slim index):
- Main:   $TASKS_DIR/prd-{feature-name}.json
- Compat: ./prd.json (root copy)
- Registry: $TASKS_DIR/registry.json updated

Ready for autonomous execution:

**Option 1: Use the Viewer (Recommended)**
Open http://localhost:3000/stage3 to monitor development visually.

**Option 2: Run from terminal**
```bash
/botoolagent-coding
```

The coding agent will:
1. Read prd.json to find the next task
2. Jump-read PRD.md § 7.X for task context
3. Jump-read PRD.md § 3-6 for design details (ASCII, SQL, UI, rules)
4. Implement, verify, and update passes"

---

## Checklist Before Saving

- [ ] Previous run archived (if prd.json exists with different branchName)
- [ ] `prdFile` points to correct PRD markdown path (portable mode: `BotoolAgent/tasks/prd-xxx.md`; standalone: `tasks/prd-xxx.md`)
- [ ] Each task has `prdSection` with line number range (e.g., "7.1 (L519-528)")
- [ ] Each task completable in one iteration
- [ ] Tasks ordered by dependency
- [ ] Every task has at least one eval (typecheck)
- [ ] No task depends on a later task
- [ ] Sessions have max 8 tasks each
- [ ] `$TASKS_DIR/prd-{feature-name}.json` written (main file)
- [ ] `./prd.json` written (root compat copy)
- [ ] `$TASKS_DIR/registry.json` updated with current project
