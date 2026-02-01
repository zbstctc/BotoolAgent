#!/bin/bash
# Botool Dev Agent - Long-running AI agent loop for Botool project
# Usage: ./BotoolAgent.sh [max_iterations]
# Based on Ralph pattern by Geoffrey Huntley

set -e

# Parse arguments
MAX_ITERATIONS=10

while [[ $# -gt 0 ]]; do
  case $1 in
    *)
      # Assume it's max_iterations if it's a number
      if [[ "$1" =~ ^[0-9]+$ ]]; then
        MAX_ITERATIONS="$1"
      fi
      shift
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRD_FILE="$SCRIPT_DIR/prd.json"
PROGRESS_FILE="$SCRIPT_DIR/progress.txt"
ARCHIVE_DIR="$SCRIPT_DIR/archive"
LAST_BRANCH_FILE="$SCRIPT_DIR/.last-branch"

# Archive previous run if branch changed
if [ -f "$PRD_FILE" ] && [ -f "$LAST_BRANCH_FILE" ]; then
  CURRENT_BRANCH=$(grep -o '"branchName": "[^"]*"' "$PRD_FILE" 2>/dev/null | sed 's/"branchName": "//;s/"$//' || echo "")
  LAST_BRANCH=$(cat "$LAST_BRANCH_FILE" 2>/dev/null || echo "")

  if [ -n "$CURRENT_BRANCH" ] && [ -n "$LAST_BRANCH" ] && [ "$CURRENT_BRANCH" != "$LAST_BRANCH" ]; then
    # Archive the previous run
    DATE=$(date +%Y-%m-%d)
    # Strip "botool-dev/" prefix from branch name for folder
    FOLDER_NAME=$(echo "$LAST_BRANCH" | sed 's|^botool-dev/||')
    ARCHIVE_FOLDER="$ARCHIVE_DIR/$DATE-$FOLDER_NAME"

    echo "Archiving previous run: $LAST_BRANCH"
    mkdir -p "$ARCHIVE_FOLDER"
    [ -f "$PRD_FILE" ] && cp "$PRD_FILE" "$ARCHIVE_FOLDER/"
    [ -f "$PROGRESS_FILE" ] && cp "$PROGRESS_FILE" "$ARCHIVE_FOLDER/"
    echo "   Archived to: $ARCHIVE_FOLDER"

    # Reset progress file for new run
    echo "# Botool Dev Agent Progress Log" > "$PROGRESS_FILE"
    echo "Started: $(date)" >> "$PROGRESS_FILE"
    echo "---" >> "$PROGRESS_FILE"
  fi
fi

# Track current branch
if [ -f "$PRD_FILE" ]; then
  CURRENT_BRANCH=$(grep -o '"branchName": "[^"]*"' "$PRD_FILE" 2>/dev/null | sed 's/"branchName": "//;s/"$//' || echo "")
  if [ -n "$CURRENT_BRANCH" ]; then
    echo "$CURRENT_BRANCH" > "$LAST_BRANCH_FILE"
  fi
fi

# Initialize progress file if it doesn't exist
if [ ! -f "$PROGRESS_FILE" ]; then
  echo "# Botool Dev Agent Progress Log" > "$PROGRESS_FILE"
  echo "Started: $(date)" >> "$PROGRESS_FILE"
  echo "---" >> "$PROGRESS_FILE"
fi

echo "Starting Botool Dev Agent - Max iterations: $MAX_ITERATIONS"

for i in $(seq 1 $MAX_ITERATIONS); do
  echo ""
  echo "==============================================================="
  echo "  Botool Dev Agent - Iteration $i of $MAX_ITERATIONS"
  echo "==============================================================="

  # Run Claude Code with the agent prompt
  OUTPUT_FILE=$(mktemp)
  # Run claude directly (no tee to avoid pipe blocking issues)
  claude --dangerously-skip-permissions --print < "$SCRIPT_DIR/CLAUDE.md" > "$OUTPUT_FILE" 2>&1 || true
  # Show output after completion
  cat "$OUTPUT_FILE"

  # Check for completion by verifying all tasks pass in prd.json
  # This is more reliable than pattern matching output
  INCOMPLETE_TASKS=$(grep -c '"passes": false' "$PRD_FILE" 2>/dev/null || echo "1")
  if [ "$INCOMPLETE_TASKS" = "0" ]; then
    rm -f "$OUTPUT_FILE"
    echo ""
    echo "Botool Dev Agent completed all tasks!"
    echo "Completed at iteration $i of $MAX_ITERATIONS"
    exit 0
  fi

  rm -f "$OUTPUT_FILE"

  # Report progress after each iteration (using grep instead of jq for compatibility)
  COMPLETED=$(grep -c '"passes": true' "$PRD_FILE" 2>/dev/null || echo "?")
  TOTAL=$(grep -c '"id": "DT-' "$PRD_FILE" 2>/dev/null || echo "?")
  LAST_TASK=$(grep -o '## [0-9-]* - DT-[0-9]*' "$PROGRESS_FILE" 2>/dev/null | tail -1 | grep -o 'DT-[0-9]*' || echo "?")
  echo ""
  echo ">>> Progress: $COMPLETED/$TOTAL tasks completed (last: $LAST_TASK)"
  echo ">>> $(date '+%H:%M:%S')"
  echo ""

  echo "Iteration $i complete. Continuing..."
  sleep 2
done

echo ""
echo "Botool Dev Agent reached max iterations ($MAX_ITERATIONS) without completing all tasks."
echo "Check $PROGRESS_FILE for status."
exit 1
