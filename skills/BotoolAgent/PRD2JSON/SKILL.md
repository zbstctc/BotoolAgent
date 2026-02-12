---
name: botoolagent-prd2json
description: "Convert PRDs to prd.json format for BotoolAgent autonomous execution. Use when you have an existing PRD and need to convert it to JSON format. Triggers on: convert this prd, turn this into json, create prd.json, prd to json."
user-invocable: true
---

# BotoolAgent PRD to JSON Converter

Converts PRDs to the prd.json format that BotoolAgent uses for autonomous execution.

---

## Overview

This skill supports two modes:
1. **Viewer Mode (Preferred)** - Use the BotoolAgent Viewer web interface for visual PRD selection and conversion
2. **CLI Mode (Fallback)** - Direct conversion in the terminal if Viewer is unavailable

**Announce at start:** "Using BotoolAgent:PRD2JSON to convert a PRD to JSON format."

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

Please create a PRD first using /botoolagent-generateprd or through the Viewer at:
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
# Auto-detect: standalone (viewer/) or portable (BotoolAgent/viewer/)
VIEWER_DIR="$([ -d BotoolAgent/viewer ] && echo BotoolAgent/viewer || echo viewer)"
cd "$VIEWER_DIR" && npm run dev &
# Wait for server to be ready (3-5 seconds)
sleep 3
```

**Open Stage 2 directly:**
```bash
# macOS
open http://localhost:3000/stage2

# Linux
xdg-open http://localhost:3000/stage2
```

**Announce to user:**
```
BotoolAgent Viewer is ready!

Opening PRD Converter at: http://localhost:3000/stage2

The web interface provides:
- Visual PRD selection list
- Full PRD preview before conversion
- Streaming conversion progress
- Task preview and editing
- One-click start development

If you prefer the CLI experience, let me know and we can continue here.
```

**Then stop here.** The user will complete conversion in the browser.

### Step 3: CLI Fallback

If the Viewer fails to start or the user prefers CLI, continue with the CLI process below.

---

## CLI Mode (Fallback)

Use this mode when:
- User explicitly requests CLI mode
- Viewer is unavailable or not installed
- Running in a headless environment

### Step 1: Scan Available Rules

```bash
# Auto-detect project root
RULES_DIR="$([ -d BotoolAgent/rules ] && echo BotoolAgent/rules || echo rules)"

# List all rule files by category
find "$RULES_DIR" -name "*.md" -type f 2>/dev/null | sort
```

Present the discovered rules to the user:

```
Found the following coding standards in rules/:

  [1] backend/API设计规范.md
  [2] frontend/命名规范.md
  [3] frontend/样式规范.md
  [4] testing/测试用例规范.md
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
- If "排除部分规范" → follow up with a multi-select question listing each rule, let user pick which to exclude

After confirmation, **read the content of each selected rule file** so it can be embedded as `constitution.rules` in the output.

### Step 3: One-Step Enriched prd.json Generation

Take the PRD content + selected rules and generate a **complete enriched prd.json in a single pass**.

The prompt to Claude must include **all enrichment requirements inline** so the output contains everything in one step (no separate enrichment pass):

**Inline Enrichment Requirements (embed these in the conversion prompt):**

1. **constitution** — Embed the selected rule files as `constitution.rules` array entries
2. **dependsOn** — Analyze task dependencies:
   - If task B depends on types/components/APIs created by task A → `B.dependsOn = ["A"]`
   - If tasks modify the same file with ordering constraints → mark dependency
   - Tasks with no dependencies → `dependsOn: []`
3. **contextHint** — Brief hint about what context to load for this task (e.g., "Read the auth middleware before implementing")
4. **spec** — Per-task implementation details:
   - `codeExamples`: TypeScript code snippets showing expected interfaces/structures
   - `testCases`: Unit and E2E test case descriptions with steps
   - `filesToModify`: Files this task will change
   - `relatedFiles`: Files to read for context
5. **evals** — Executable verification commands per task:
   - Every task must have at least one `typecheck` eval: `{ type: "code-based", blocking: true, command: "npx tsc --noEmit", expect: "exit-0" }`
   - Add grep/test commands for specific acceptance criteria where applicable
6. **testCases** — Per-task test case metadata:
   - Every task gets `{ type: "typecheck", desc: "TypeScript 编译通过" }`
   - Add `{ type: "unit", desc: "...", tdd: true }` for tasks with transformations/logic
   - Add `{ type: "e2e", desc: "..." }` for UI/page rendering tasks
   - Add `{ type: "manual", desc: "..." }` for visual/animation tasks
7. **sessions** — Group tasks into sessions (max 8 tasks per session):
   - Tasks with dependencies go in the same session
   - Tasks modifying the same files go in the same session
   - Independent tasks fill by priority
   - Each session has a `reason` explaining the grouping

---

## Output Format (EnrichedPrdJson Schema)

The generated `prd.json` must conform to this schema:

```json
{
  "project": "[Project Name]",
  "branchName": "botool/[feature-name-kebab-case]",
  "description": "[Feature description from PRD]",
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
      "title": "[Task title]",
      "description": "As a [user], I want [feature] so that [benefit]",
      "acceptanceCriteria": [
        "Criterion 1",
        "Criterion 2",
        "Typecheck passes"
      ],
      "priority": 1,
      "passes": false,
      "dependsOn": [],
      "contextHint": "",
      "notes": "",
      "spec": {
        "codeExamples": [
          {
            "language": "typescript",
            "description": "Expected interface",
            "code": "export interface Task { id: string; title: string; }"
          }
        ],
        "testCases": [
          {
            "type": "unit",
            "description": "Task mapping returns correct shape",
            "steps": ["Create mock input", "Call mapTask()", "Assert output matches expected"]
          }
        ],
        "filesToModify": ["src/lib/tasks.ts"],
        "relatedFiles": ["src/types/index.ts"]
      },
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
      "reason": "基础 schema 和后端逻辑，有依赖关系"
    },
    {
      "id": "S2",
      "tasks": ["DT-004", "DT-005"],
      "reason": "UI 组件，依赖 S1 的后端实现"
    }
  ]
}
```

### Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `project` | string | Yes | Project name |
| `branchName` | string | Yes | Git branch, prefixed with `botool/` |
| `description` | string | Yes | Feature description |
| `constitution` | object | No | Coding standards from `rules/` |
| `constitution.rules[]` | ConstitutionRule[] | - | Rule entries with `id`, `name`, `category`, `content` |
| `devTasks[]` | EnrichedDevTask[] | Yes | Development tasks |
| `devTasks[].dependsOn` | string[] | No | IDs of tasks this task depends on |
| `devTasks[].contextHint` | string | No | Hint for context loading |
| `devTasks[].spec` | DevTaskSpec | No | Code examples, test cases, files to modify |
| `devTasks[].evals` | DevTaskEval[] | No | Verification commands |
| `devTasks[].testCases` | TestCase[] | No | Test case metadata with type and tdd flag |
| `sessions[]` | SessionGroup[] | No | Task grouping for batch execution |

---

## Task Size: The Number One Rule

**Each task must be completable in ONE iteration (one context window).**

The agent spawns a fresh Claude instance per iteration with no memory of previous work. If a task is too big, the LLM runs out of context before finishing.

### Right-sized tasks:
- Add a database column and migration
- Add a UI component to an existing page
- Update a server action with new logic
- Add a filter dropdown to a list

### Too big (split these):
- "Build the entire dashboard" - Split into: schema, queries, UI components, filters
- "Add authentication" - Split into: schema, middleware, login UI, session handling
- "Refactor the API" - Split into one task per endpoint or pattern

**Rule of thumb:** If you cannot describe the change in 2-3 sentences, it's too big.

---

## Task Ordering: Dependencies First

Tasks execute in priority order. Earlier tasks must not depend on later ones.

**Correct order:**
1. Schema/database changes (migrations)
2. Server actions / backend logic
3. UI components that use the backend
4. Dashboard/summary views that aggregate data

**Wrong order:**
1. UI component (depends on schema that doesn't exist yet)
2. Schema change

---

## Acceptance Criteria: Must Be Verifiable

Each criterion must be something the agent can CHECK, not something vague.

### Good criteria (verifiable):
- "Add `status` column to tasks table with default 'pending'"
- "Filter dropdown has options: All, Active, Completed"
- "Clicking delete shows confirmation dialog"
- "Typecheck passes"
- "Tests pass"

### Bad criteria (vague):
- "Works correctly"
- "User can do X easily"
- "Good UX"
- "Handles edge cases"

### Always include as final criterion:
```
"Typecheck passes"
```

### For UI tasks, also include:
```
"Verify in browser"
```

---

## Conversion Rules

1. **Each dev task becomes one JSON entry**
2. **IDs**: Sequential (DT-001, DT-002, etc.)
3. **Priority**: Based on dependency order, then document order
4. **All tasks**: `passes: false` and empty `notes`
5. **branchName**: Derive from feature name, kebab-case, prefixed with `botool/`
6. **Always add**: "Typecheck passes" to every task's acceptance criteria

---

## Archiving Previous Runs

**Before writing a new prd.json, check if there's an existing one from a different feature:**

1. Read current `prd.json` if it exists
2. Check if `branchName` differs from the new feature
3. If different AND `progress.txt` has content:
   - Create archive folder: `archive/YYYY-MM-DD-feature-name/`
   - Copy current `prd.json` and `progress.txt` to archive
   - Reset `progress.txt` with fresh header

The `BotoolAgent.sh` script handles this automatically, but if manually updating between runs, archive first.

---

## Example

**Input PRD:**
```markdown
# PRD: Task Status Feature

## Introduction
Add ability to mark tasks with different statuses.

## Dev Tasks

### DT-001: Add status field to database
**Description:** As a developer, I need to store task status.
**Acceptance Criteria:**
- [ ] Add status column: 'pending' | 'in_progress' | 'done'
- [ ] Typecheck passes

### DT-002: Display status badge
**Description:** As a user, I want to see status at a glance.
**Acceptance Criteria:**
- [ ] Colored badge on each task
- [ ] Typecheck passes
- [ ] Verify in browser
```

**Selected rules:** `backend/API设计规范.md`

**Output prd.json (enriched):**
```json
{
  "project": "MyApp",
  "branchName": "botool/task-status",
  "description": "Task Status Feature - Track task progress with status indicators",
  "constitution": {
    "rules": [
      {
        "id": "rule-001",
        "name": "API设计规范",
        "category": "backend",
        "content": "# API 设计规范\n\n## URL 设计\n- 使用 RESTful 风格..."
      }
    ],
    "ruleAuditSummary": ""
  },
  "devTasks": [
    {
      "id": "DT-001",
      "title": "Add status field to database",
      "description": "As a developer, I need to store task status.",
      "acceptanceCriteria": [
        "Add status column: 'pending' | 'in_progress' | 'done'",
        "Typecheck passes"
      ],
      "priority": 1,
      "passes": false,
      "dependsOn": [],
      "contextHint": "Read existing schema/migration files first",
      "notes": "",
      "spec": {
        "codeExamples": [
          {
            "language": "typescript",
            "description": "Task status type definition",
            "code": "export type TaskStatus = 'pending' | 'in_progress' | 'done';"
          }
        ],
        "testCases": [
          {
            "type": "unit",
            "description": "Status column has correct default value",
            "steps": ["Insert a new task without status", "Assert status defaults to 'pending'"]
          }
        ],
        "filesToModify": ["src/db/schema.ts", "src/db/migrations/add-status.sql"],
        "relatedFiles": ["src/db/schema.ts"]
      },
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
      "title": "Display status badge",
      "description": "As a user, I want to see status at a glance.",
      "acceptanceCriteria": [
        "Colored badge on each task",
        "Typecheck passes",
        "Verify in browser"
      ],
      "priority": 2,
      "passes": false,
      "dependsOn": ["DT-001"],
      "contextHint": "Read DT-001 type definitions and task list component",
      "notes": "",
      "spec": {
        "codeExamples": [
          {
            "language": "typescript",
            "description": "StatusBadge component props",
            "code": "interface StatusBadgeProps { status: TaskStatus; }"
          }
        ],
        "testCases": [
          {
            "type": "e2e",
            "description": "Status badge renders with correct color",
            "steps": ["Navigate to task list", "Check badge color for 'pending' status"]
          }
        ],
        "filesToModify": ["src/components/StatusBadge.tsx", "src/components/TaskList.tsx"],
        "relatedFiles": ["src/db/schema.ts"]
      },
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
        { "type": "e2e", "desc": "页面正确渲染状态标签" },
        { "type": "manual", "desc": "颜色视觉确认" }
      ]
    }
  ],
  "sessions": [
    {
      "id": "S1",
      "tasks": ["DT-001", "DT-002"],
      "reason": "DT-002 依赖 DT-001 的类型定义，放在同一 session"
    }
  ]
}
```

---

## After Conversion (CLI Mode)

Announce next steps:

"prd.json created. Ready for autonomous execution:

**Option 1: Use the Viewer (Recommended)**
```
/botoolagent-coding
```
Or open http://localhost:3000/stage3 to monitor development visually.

**Option 2: Run from terminal**
```bash
./BotoolAgent.sh 10
```

This will run up to 10 iterations, implementing one task per iteration."

---

## Checklist Before Saving

- [ ] Previous run archived (if prd.json exists with different branchName)
- [ ] Each task completable in one iteration
- [ ] Tasks ordered by dependency
- [ ] Every task has "Typecheck passes"
- [ ] UI tasks have "Verify in browser"
- [ ] Acceptance criteria are verifiable
- [ ] No task depends on a later task
