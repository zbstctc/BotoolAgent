# Botool Dev Agent

Botool Dev Agent is an autonomous AI agent loop that runs Claude Code repeatedly until all PRD items are complete. Each iteration is a fresh instance with clean context. Memory persists via git history, `progress.txt`, and `prd.json`.

Based on [Geoffrey Huntley's Ralph pattern](https://ghuntley.com/ralph/).

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed (`npm install -g @anthropic-ai/claude-code`)
- `jq` installed (`brew install jq` on macOS)
- A git repository for your project

## Setup

### Option 1: Copy to your project

Copy the BotoolAgent files into your project:

```bash
# From your project root
mkdir -p scripts/BotoolAgent
cp /path/to/BotoolAgent/BotoolAgent.sh scripts/BotoolAgent/
cp /path/to/BotoolAgent/CLAUDE.md scripts/BotoolAgent/
cp /path/to/BotoolAgent/prd.json.example scripts/BotoolAgent/
chmod +x scripts/BotoolAgent/BotoolAgent.sh
```

### Option 2: Install skills globally

Copy the skills to your Claude Code config for use across all projects:

```bash
mkdir -p ~/.claude/skills
cp -r skills/BotoolAgent ~/.claude/skills/
```

## Workflow

### 1. Create a PRD

Use the PRD skill to generate a detailed requirements document through collaborative dialogue:

```
/BotoolAgent:GeneratePRD or "create a prd for [your feature description]"
```

The skill will ask questions one at a time, explore approaches, and validate the design with you. Output saves to `tasks/prd-[feature-name].md`.

### 2. Convert PRD to JSON format

Use the JSON converter skill:

```
/BotoolAgent:PRD2JSON or "convert tasks/prd-[feature-name].md to prd.json"
```

This creates `prd.json` with dev tasks structured for autonomous execution.

### 3. Run the Agent

```bash
./scripts/BotoolAgent/BotoolAgent.sh [max_iterations]
```

Default is 10 iterations.

The agent will:
1. Create a feature branch (from PRD `branchName`)
2. Pick the highest priority task where `passes: false`
3. Implement that single task
4. Run quality checks (typecheck, tests)
5. Commit if checks pass
6. Update `prd.json` to mark task as `passes: true`
7. Append learnings to `progress.txt`
8. Repeat until all tasks pass or max iterations reached

## Key Files

| File | Purpose |
|------|---------|
| `BotoolAgent.sh` | The bash loop that spawns fresh Claude instances |
| `CLAUDE.md` | Agent instructions |
| `prd.json` | Dev tasks with `passes` status (the task list) |
| `prd.json.example` | Example PRD format for reference |
| `progress.txt` | Append-only learnings for future iterations |
| `skills/BotoolAgent/GeneratePRD/` | Skill for generating PRDs through collaborative dialogue |
| `skills/BotoolAgent/PRD2JSON/` | Skill for converting PRDs to JSON |

## Critical Concepts

### Each Iteration = Fresh Context

Each iteration spawns a **new Claude instance** with clean context. The only memory between iterations is:
- Git history (commits from previous iterations)
- `progress.txt` (learnings and context)
- `prd.json` (which tasks are done)

### Small Tasks

Each PRD item should be small enough to complete in one context window. If a task is too big, the LLM runs out of context before finishing and produces poor code.

Right-sized tasks:
- Add a database column and migration
- Add a UI component to an existing page
- Update a server action with new logic
- Add a filter dropdown to a list

Too big (split these):
- "Build the entire dashboard"
- "Add authentication"
- "Refactor the API"

### CLAUDE.md Updates Are Critical

After each iteration, the agent updates relevant `CLAUDE.md` files with learnings. This is key because Claude Code automatically reads these files, so future iterations benefit from discovered patterns, gotchas, and conventions.

### Feedback Loops

The agent only works if there are feedback loops:
- Typecheck catches type errors
- Tests verify behavior
- CI must stay green (broken code compounds across iterations)

### Browser Verification for UI Tasks

Frontend tasks should include "Verify in browser" in acceptance criteria. If Playwright is configured, the agent will navigate to the page, interact with the UI, and confirm changes work.

**Without Playwright:** The agent will note in `progress.txt` that manual browser verification is needed.

**With Playwright (Optional):** Install the Playwright plugin for automatic browser verification:

```bash
# In Claude Code, run:
/plugin

# Then select and install "playwright"
```

After installation, restart Claude Code. The agent will automatically use Playwright for UI verification.

### Stop Condition

When all tasks have `passes: true`, the agent outputs `<promise>COMPLETE</promise>` and the loop exits.

## Debugging

Check current state:

```bash
# See which tasks are done
cat prd.json | jq '.devTasks[] | {id, title, passes}'

# See learnings from previous iterations
cat progress.txt

# Check git history
git log --oneline -10
```

## Customizing

Edit `CLAUDE.md` for your project:
- Add project-specific quality check commands
- Include codebase conventions
- Add common gotchas for your stack

## Archiving

Botool Dev Agent automatically archives previous runs when you start a new feature (different `branchName`). Archives are saved to `archive/YYYY-MM-DD-feature-name/`.

## References

- [Geoffrey Huntley's Ralph article](https://ghuntley.com/ralph/)
- [Claude Code documentation](https://docs.anthropic.com/en/docs/claude-code)
