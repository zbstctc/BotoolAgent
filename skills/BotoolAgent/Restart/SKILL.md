---
name: botoolagent-restart
description: "Restart BotoolAgent Viewer dev server. Use when the viewer is unresponsive, page won't load, or you need a fresh server restart. Triggers on: restart botool, restart viewer, server stuck, can't open viewer."
user-invocable: true
---

# BotoolAgent Viewer Restart

Force-kills any stuck Node process and restarts the Viewer dev server.

**Announce at start:** "Restarting BotoolAgent Viewer..."

---

## Instructions

### Step 1: Detect port and kill existing process

```bash
# Auto-detect port: BotoolAgent repo = 3100, other project = 3101
VIEWER_PORT="$([ -d BotoolAgent/viewer ] && echo 3101 || echo 3100)"
PID=$(lsof -ti :"$VIEWER_PORT")
if [ -n "$PID" ]; then
  kill -9 $PID
  sleep 1
  echo "Killed PID $PID on port $VIEWER_PORT"
else
  echo "No process on port $VIEWER_PORT"
fi
```

### Step 2: Verify port is free

```bash
VIEWER_PORT="$([ -d BotoolAgent/viewer ] && echo 3101 || echo 3100)"
lsof -i :"$VIEWER_PORT" | grep LISTEN
```

If still occupied, retry `kill -9` or report to user.

### Step 3: Start dev server

```bash
VIEWER_DIR="$([ -d BotoolAgent/viewer ] && echo BotoolAgent/viewer || echo viewer)"
VIEWER_PORT="$([ -d BotoolAgent/viewer ] && echo 3101 || echo 3100)"
cd "$VIEWER_DIR" && npx next dev --port "$VIEWER_PORT" &
```

### Step 4: Verify server is responding

```bash
VIEWER_PORT="$([ -d BotoolAgent/viewer ] && echo 3101 || echo 3100)"
sleep 5
curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:$VIEWER_PORT
```

Expected: `200`. If not, check `npm run dev` output for errors.

### Step 5: Open in browser

```bash
VIEWER_PORT="$([ -d BotoolAgent/viewer ] && echo 3101 || echo 3100)"
open http://localhost:$VIEWER_PORT
```

### Step 6: Announce

```
BotoolAgent Viewer restarted!
Access URL: http://localhost:<VIEWER_PORT>
```
