#!/bin/bash
# Watch progress.txt and prd.json for changes and report immediately

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRD_FILE="$SCRIPT_DIR/prd.json"
PROGRESS_FILE="$SCRIPT_DIR/progress.txt"

LAST_PRD_MTIME=""
LAST_PROGRESS_MTIME=""

echo "Watching for progress updates... (Ctrl+C to stop)"
echo ""

while true; do
  PRD_MTIME=$(stat -f "%m" "$PRD_FILE" 2>/dev/null || echo "0")
  PROGRESS_MTIME=$(stat -f "%m" "$PROGRESS_FILE" 2>/dev/null || echo "0")

  if [ "$PRD_MTIME" != "$LAST_PRD_MTIME" ] || [ "$PROGRESS_MTIME" != "$LAST_PROGRESS_MTIME" ]; then
    if [ -n "$LAST_PRD_MTIME" ]; then
      # Not first run, show update
      COMPLETED=$(grep -c '"passes": true' "$PRD_FILE" 2>/dev/null || echo "?")
      TOTAL=$(grep -c '"id": "DT-' "$PRD_FILE" 2>/dev/null || echo "?")
      LAST_TASK=$(grep -o '## [0-9-]* - DT-[0-9]*' "$PROGRESS_FILE" | tail -1 | grep -o 'DT-[0-9]*' || echo "?")

      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo "📊 Progress Update @ $(date '+%H:%M:%S')"
      echo "   Completed: $COMPLETED / $TOTAL tasks"
      echo "   Last task: $LAST_TASK"
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo ""
    fi

    LAST_PRD_MTIME="$PRD_MTIME"
    LAST_PROGRESS_MTIME="$PROGRESS_MTIME"
  fi

  sleep 2
done
