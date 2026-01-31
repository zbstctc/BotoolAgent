---
name: botoolagent-prd2json
description: "Convert PRDs to prd.json format for BotoolAgent autonomous execution. Use when you have an existing PRD and need to convert it to JSON format. Triggers on: convert this prd, turn this into json, create prd.json, prd to json."
user-invocable: true
---

# BotoolAgent PRD to JSON Converter

Converts PRDs to the prd.json format that BotoolAgent uses for autonomous execution.

---

## Overview

Take a PRD (from `tasks/prd-xxx.md` or provided text) and convert it to `prd.json` in your project root.

**Announce at start:** "Using BotoolAgent:PRD2JSON to convert the PRD to JSON format."

---

## Output Format

```json
{
  "project": "[Project Name]",
  "branchName": "botool/[feature-name-kebab-case]",
  "description": "[Feature description from PRD]",
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
      "notes": ""
    }
  ]
}
```

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

**Output prd.json:**
```json
{
  "project": "MyApp",
  "branchName": "botool/task-status",
  "description": "Task Status Feature - Track task progress with status indicators",
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
      "notes": ""
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
      "notes": ""
    }
  ]
}
```

---

## After Conversion

Announce next steps:

"prd.json created. Ready for autonomous execution:

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
