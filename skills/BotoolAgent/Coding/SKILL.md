---
name: botoolagent-coding
description: "Start and monitor autonomous development with BotoolAgent. Use when you have a prd.json ready and want to start coding. Triggers on: start coding, run botool, start development, begin implementing."
user-invocable: true
---

# BotoolAgent Coding Monitor

Start and monitor autonomous development in the BotoolAgent Viewer.

---

## Overview

This skill launches the BotoolAgent development monitor (Stage 3) where you can:
- View real-time task progress
- Monitor the agent's flowchart execution
- Watch file changes and commits
- See the live progress log

**Announce at start:** "Launching BotoolAgent Coding Monitor..."

---

## Prerequisites

Before using this skill, you need:
1. A `prd.json` file in the project root (created via `/botoolagent-prd2json` or Stage 2)
2. The Viewer server running (will be started automatically if not)

---

## Instructions

### Step 1: Check for prd.json

```bash
# Check if prd.json exists
ls prd.json 2>/dev/null
```

**If prd.json does NOT exist:**
```
No prd.json found in project root.

Please complete the following steps first:
1. Create a PRD: /botoolagent-generateprd or http://localhost:3000/stage1
2. Convert to JSON: /botoolagent-prd2json or http://localhost:3000/stage2

Then run /botoolagent-coding again.
```
Then stop here.

### Step 2: Check and Start Viewer Server

```bash
# Check if port 3000 is in use
lsof -i :3000 | grep LISTEN
```

**If server is NOT running:**
```bash
# Start the Viewer dev server in background
cd viewer && npm run dev &
# Wait for server to be ready (3-5 seconds)
sleep 3
```

### Step 3: Open Stage 3 in Browser

```bash
# macOS
open http://localhost:3000/stage3

# Linux
xdg-open http://localhost:3000/stage3
```

### Step 4: Announce to User

```
BotoolAgent Coding Monitor is ready!

Opening Stage 3 at: http://localhost:3000/stage3

The monitor shows:
- Task progress sidebar with status indicators
- Flowchart visualization of agent execution
- Real-time progress log
- File changes with diff stats
- Git commit history

To start the autonomous agent, click "Start Development" in the UI
or run from terminal:
  ./BotoolAgent.sh 10

The agent will implement tasks one by one until complete.
```

---

## Stage 3 Features

| Feature | Description |
|---------|-------------|
| Task Sidebar | View all dev tasks with completion status |
| Flowchart | Visual representation of agent execution flow |
| Progress Log | Real-time streaming of progress.txt updates |
| File Changes | Git diff showing modified files with +/- stats |
| Commits | List of commits made during development |

---

## Manual Development (Alternative)

If you prefer not to use the Viewer:

```bash
# Run the agent from terminal
./BotoolAgent.sh 10

# Or run a single iteration
./BotoolAgent.sh 1
```

The agent will:
1. Read prd.json and progress.txt
2. Pick the highest priority unfinished task
3. Implement the task
4. Run quality checks
5. Commit if successful
6. Update prd.json with passes: true
7. Append to progress.txt

---

## Related Skills

- **BotoolAgent** (`/botoolagent`) - Open the main dashboard
- **BotoolAgent:GeneratePRD** (`/botoolagent-generateprd`) - Create a new PRD
- **BotoolAgent:PRD2JSON** (`/botoolagent-prd2json`) - Convert PRD to JSON

---

## Troubleshooting

### "No prd.json found"
Complete Stage 1 and Stage 2 first, or create prd.json manually following the format in `/botoolagent-prd2json`.

### Agent not making progress
Check the progress.txt log for errors. The agent may be stuck on a task that's too large to complete in one iteration.

### Server won't start
```bash
cd viewer && npm install
cd viewer && npm run dev
```

### Browser doesn't open
Navigate manually to http://localhost:3000/stage3
