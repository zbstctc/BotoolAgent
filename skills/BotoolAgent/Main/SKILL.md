---
name: botoolagent
description: "Launch BotoolAgent Viewer - the visual interface for autonomous development. Use to open the dashboard, monitor progress, or start a development workflow. Triggers on: open botool, launch viewer, start botool, show dashboard."
user-invocable: true
---

# BotoolAgent Viewer Launcher

Opens the BotoolAgent Viewer web interface for visual project management and monitoring.

---

## Overview

The BotoolAgent Viewer provides a modern web interface for:
- Creating and managing PRDs (Product Requirements Documents)
- Converting PRDs to JSON for autonomous execution
- Monitoring real-time development progress
- Viewing file changes and commit history

**Announce at start:** "Launching BotoolAgent Viewer..."

---

## What This Skill Does

1. **Detect context** and determine the correct port
2. **Check if Viewer dev server is running**
3. **Start the server** if not running (in background)
4. **Open the Viewer** in the default browser
5. **Output the access address** for the user

---

## Port Convention

- **BotoolAgent repo** (standalone dev): port **3100** — `viewer/` directory exists at project root
- **Other project** (portable mode): port **3101** — BotoolAgent installed as `BotoolAgent/` subdirectory

Detection logic used throughout this skill:

```bash
# Auto-detect viewer directory and port
VIEWER_DIR="$([ -d BotoolAgent/viewer ] && echo BotoolAgent/viewer || echo viewer)"
VIEWER_PORT="$([ -d BotoolAgent/viewer ] && echo 3101 || echo 3100)"
```

---

## Instructions

### Step 1: Detect Context and Check Server Status

```bash
VIEWER_PORT="$([ -d BotoolAgent/viewer ] && echo 3101 || echo 3100)"
lsof -i :"$VIEWER_PORT" | grep LISTEN
```

### Step 2: Start Server if Not Running

If the server is not running:

```bash
VIEWER_DIR="$([ -d BotoolAgent/viewer ] && echo BotoolAgent/viewer || echo viewer)"
VIEWER_PORT="$([ -d BotoolAgent/viewer ] && echo 3101 || echo 3100)"
cd "$VIEWER_DIR" && npx next dev --port "$VIEWER_PORT" &
```

Wait a few seconds for the server to start.

### Step 3: Open in Browser

```bash
VIEWER_PORT="$([ -d BotoolAgent/viewer ] && echo 3101 || echo 3100)"
# macOS
open http://localhost:$VIEWER_PORT

# Linux
xdg-open http://localhost:$VIEWER_PORT
```

### Step 4: Announce Access

Output to the user (use the detected port):

```
BotoolAgent Viewer is now running!

Access URL: http://localhost:<VIEWER_PORT>

From here you can:
- Create a new PRD: /stage1
- Convert PRD to JSON: /stage2
- Monitor development: /stage3
```

---

## Quick Navigation URLs

Use the detected `VIEWER_PORT` (3100 or 3101):

| Path | Purpose |
|------|---------|
| `/` | Dashboard - view all PRDs and sessions |
| `/stage1` | Stage 1 - Create PRD with AI chat |
| `/stage2` | Stage 2 - Select PRD and convert to JSON |
| `/stage3` | Stage 3 - Monitor autonomous development |
| `/stage4` | Stage 4 - Testing & verification |
| `/stage5` | Stage 5 - Finalize, PR & merge |

---

## Related Skills

- **BotoolAgent:PyramidPRD** (`/botoolagent-pyramidprd`) - Create PRD via structured Q&A (supports Quick Fix / Feature Build / Full Planning / PRD Import modes)
- **BotoolAgent:PRD2JSON** (`/botoolagent-prd2json`) - Convert PRD to JSON format
- **BotoolAgent:Coding** (`/botoolagent-coding`) - Jump directly to Stage 3
- **BotoolAgent:Testing** (`/botoolagent-testing`) - Run 4-layer verification pipeline
- **BotoolAgent:Finalize** (`/botoolagent-finalize`) - Create PR, review & merge

---

## Troubleshooting

### Server won't start
- Check if port is already in use: `lsof -i :$VIEWER_PORT`
- Check for errors in viewer directory: `cd BotoolAgent/viewer 2>/dev/null || cd viewer && npm run dev`

### Browser doesn't open
- Manually navigate to `http://localhost:<VIEWER_PORT>` in your browser

### Page shows error
- Ensure you're in the correct project directory
- Run `cd BotoolAgent/viewer 2>/dev/null || cd viewer && npm install` if dependencies are missing
