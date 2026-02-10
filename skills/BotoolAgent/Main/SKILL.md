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

1. **Check if Viewer dev server is running** on http://localhost:3000
2. **Start the server** if not running (in background)
3. **Open the Viewer** in the default browser
4. **Output the access address** for the user

---

## Instructions

### Step 1: Check Server Status

```bash
# Check if port 3000 is in use
lsof -i :3000 | grep LISTEN
```

### Step 2: Start Server if Not Running

If the server is not running:

```bash
# Navigate to viewer directory and start dev server in background
# Auto-detect: standalone (viewer/) or portable (BotoolAgent/viewer/)
VIEWER_DIR="$([ -d BotoolAgent/viewer ] && echo BotoolAgent/viewer || echo viewer)"
cd "$VIEWER_DIR" && npm run dev &
```

Wait a few seconds for the server to start.

### Step 3: Open in Browser

```bash
# macOS
open http://localhost:3000

# Linux
xdg-open http://localhost:3000
```

### Step 4: Announce Access

Output to the user:

```
BotoolAgent Viewer is now running!

Access URL: http://localhost:3000

From here you can:
- Create a new PRD: /stage1
- Convert PRD to JSON: /stage2
- Monitor development: /stage3
```

---

## Quick Navigation URLs

| URL | Purpose |
|-----|---------|
| http://localhost:3000 | Dashboard - view all PRDs and sessions |
| http://localhost:3000/stage1 | Stage 1 - Create PRD with AI chat |
| http://localhost:3000/stage2 | Stage 2 - Select PRD and convert to JSON |
| http://localhost:3000/stage3 | Stage 3 - Monitor autonomous development |

---

## Related Skills

- **BotoolAgent:GeneratePRD** (`/botoolagent-generateprd`) - Create a new PRD through dialogue
- **BotoolAgent:PRD2JSON** (`/botoolagent-prd2json`) - Convert PRD to JSON format
- **BotoolAgent:Coding** (`/botoolagent-coding`) - Jump directly to Stage 3

---

## Troubleshooting

### Server won't start
- Check if port 3000 is already in use: `lsof -i :3000`
- Check for errors in viewer directory: `cd viewer && npm run dev`

### Browser doesn't open
- Manually navigate to http://localhost:3000 in your browser

### Page shows error
- Ensure you're in the BotoolAgent project directory
- Run `cd viewer && npm install` if dependencies are missing
