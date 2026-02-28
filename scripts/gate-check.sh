#!/bin/bash
set -o pipefail  # Ensure $? reflects pipeline failures
# gate-check.sh — DT deterministic gate verification
# Usage: bash scripts/gate-check.sh <project-dir> <DT-ID>
# Exit: 0=all passed (or no blocking evals), 1=failures, 2=argument/config error

PROJECT_DIR="$1"
DT_ID="$2"

[ -n "$PROJECT_DIR" ] && [ -n "$DT_ID" ] || {
  echo "Usage: gate-check.sh <project-dir> <DT-ID>"
  exit 2
}

# 1. Locate dev.json (fall back to prd.json for backward compat)
DEV_JSON="$PROJECT_DIR/dev.json"
if [ ! -f "$DEV_JSON" ]; then
  DEV_JSON="$PROJECT_DIR/prd.json"
fi
[ -f "$DEV_JSON" ] || { echo "ERROR: No dev.json or prd.json found in $PROJECT_DIR"; exit 2; }

# 2. Require jq (hard dependency — fail-closed without it)
if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required for gate-check but not found."
  echo "  Install: brew install jq (macOS) / apt install jq (Linux)"
  exit 1  # No jq = gate failure, do not allow pass
fi

# 3. Check DT exists (distinguish "not found" from "no blocking evals")
DT_EXISTS=$(jq --arg id "$DT_ID" '[.devTasks[] | select(.id == $id)] | length' "$DEV_JSON" 2>/dev/null)
if [ "$DT_EXISTS" = "0" ] || [ -z "$DT_EXISTS" ]; then
  echo "ERROR: $DT_ID not found in $DEV_JSON"
  exit 2
fi

# 4. Extract blocking evals for this DT
BLOCKING_EVALS=$(jq -r --arg id "$DT_ID" '
  .devTasks[] | select(.id == $id) |
  .evals // [] | map(select(.blocking == true)) |
  .[] | .command' "$DEV_JSON" 2>/dev/null)

# No blocking evals → skip
if [ -z "$BLOCKING_EVALS" ]; then
  echo "SKIP: $DT_ID has no blocking evals"
  exit 0
fi

# 5. Eval command safety whitelist (two-pass validation)
# Pass 1: reject shell metacharacters (prevent injection bypassing whitelist)
SHELL_METACHAR_PATTERN='[;|&`$(){}]|<|>|\\|'
# Pass 2: whitelist patterns (full match, all $ anchored at end)
SAFE_PATTERNS=(
  '^npx tsc --noEmit$'
  '^cd [a-zA-Z0-9_./-]+ && npx tsc --noEmit$'
  '^npm test$'
  '^npm test [a-zA-Z0-9_./ -]+$'
  '^npx vitest run [a-zA-Z0-9_./ -]+$'
  '^npx eslint [a-zA-Z0-9_./ -]+$'
  '^npm run lint$'
  '^npm run build$'
  '^test -[fd] [a-zA-Z0-9_./ -]+$'
  '^grep -q .+ [a-zA-Z0-9_./ -]+$'
  '^! grep -q .+ [a-zA-Z0-9_./ -]+$'
  '^bash -n [a-zA-Z0-9_./ -]+$'
)

validate_command() {
  local cmd="$1"
  # Pass 1: reject shell metacharacters (; | & ` $() {} < >)
  # Special allow: "cd dir && npx tsc" pattern has && explicitly in whitelist
  local stripped_cmd
  stripped_cmd=$(echo "$cmd" | sed 's/^cd [a-zA-Z0-9_.\/-]* && //')
  if echo "$stripped_cmd" | grep -qE "$SHELL_METACHAR_PATTERN"; then
    return 1
  fi
  # Pass 2: whitelist regex match
  for safe in "${SAFE_PATTERNS[@]}"; do
    if echo "$cmd" | grep -qE "$safe"; then
      return 0
    fi
  done
  return 1
}

# Validate all blocking eval commands
while IFS= read -r cmd; do
  [ -z "$cmd" ] && continue
  if ! validate_command "$cmd"; then
    echo "ERROR: eval command not in safety whitelist: $cmd"
    echo "  Allowed patterns: npx tsc, npm test, npx vitest, test -f/-d, grep -q, etc."
    echo "  If this is a legitimate command, add it to SAFE_PATTERNS in gate-check.sh"
    exit 2
  fi
done <<< "$BLOCKING_EVALS"

# 6. Prepare results directory
GATE_DIR="$PROJECT_DIR/.state/gate-results"
mkdir -p "$GATE_DIR"

RESULT_FILE="$GATE_DIR/${DT_ID}.json"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
RESULTS_JSON="[]"
ALL_PASSED=true
FAILED_COUNT=0
TOTAL_COUNT=0

# 7. Portable millisecond timestamp (macOS date lacks %3N)
now_ms() {
  if command -v gdate &>/dev/null; then
    gdate +%s%3N
  elif date +%s%3N 2>/dev/null | grep -qE '^[0-9]+$'; then
    date +%s%3N
  elif command -v python3 &>/dev/null; then
    python3 -c 'import time; print(int(time.time()*1000))'
  else
    # Second-precision * 1000 as last resort
    echo "$(($(date +%s) * 1000))"
  fi
}

# 8. Cross-platform timeout detection (macOS uses gtimeout)
TIMEOUT_CMD="timeout"
if ! command -v timeout &>/dev/null; then
  if command -v gtimeout &>/dev/null; then
    TIMEOUT_CMD="gtimeout"
  else
    echo "WARN: timeout/gtimeout not found, running evals without timeout"
    TIMEOUT_CMD=""
  fi
fi

# 9. Execute each blocking eval
cd "$PROJECT_DIR" || exit 2

while IFS= read -r cmd; do
  [ -z "$cmd" ] && continue
  TOTAL_COUNT=$((TOTAL_COUNT + 1))

  START_MS=$(now_ms)

  # Execute command with 120s timeout
  # Use temp file to preserve exit code (avoid pipe overwriting $?)
  TMPOUT=$(mktemp /tmp/gate-eval-XXXXXX.txt)
  if [ -n "$TIMEOUT_CMD" ]; then
    $TIMEOUT_CMD 120 bash -c "$cmd" > "$TMPOUT" 2>&1
    EXIT_CODE=$?
  else
    bash -c "$cmd" > "$TMPOUT" 2>&1
    EXIT_CODE=$?
  fi
  # Capture first 200 lines for logging
  OUTPUT=$(head -200 "$TMPOUT")
  rm -f "$TMPOUT"

  END_MS=$(now_ms)
  DURATION=$((END_MS - START_MS))

  PASSED=true
  if [ "$EXIT_CODE" -ne 0 ]; then
    PASSED=false
    ALL_PASSED=false
    FAILED_COUNT=$((FAILED_COUNT + 1))
  fi

  # Append to results JSON
  RESULTS_JSON=$(echo "$RESULTS_JSON" | jq \
    --arg cmd "$cmd" \
    --argjson ec "$EXIT_CODE" \
    --argjson dur "$DURATION" \
    --arg out "$OUTPUT" \
    --argjson passed "$PASSED" \
    '. + [{"command":$cmd,"blocking":true,"exitCode":$ec,"durationMs":$dur,"outputHead":$out,"passed":$passed}]')

  if [ "$PASSED" = "true" ]; then
    echo "  ✓ $cmd (${DURATION}ms)"
  else
    echo "  ✗ $cmd (exit $EXIT_CODE, ${DURATION}ms)"
  fi
done <<< "$BLOCKING_EVALS"

# 10. Write result file
jq -n \
  --arg id "$DT_ID" \
  --arg ts "$TIMESTAMP" \
  --arg dir "$PROJECT_DIR" \
  --arg json "$DEV_JSON" \
  --argjson results "$RESULTS_JSON" \
  --argjson allPassed "$ALL_PASSED" \
  --argjson failed "$FAILED_COUNT" \
  --argjson total "$TOTAL_COUNT" \
  '{dtId:$id,timestamp:$ts,projectDir:$dir,devJsonPath:$json,
    results:$results,allPassed:$allPassed,failedCount:$failed,totalCount:$total}' \
  > "$RESULT_FILE"

echo ""
if [ "$ALL_PASSED" = "true" ]; then
  echo "GATE PASSED: $DT_ID ($TOTAL_COUNT/$TOTAL_COUNT evals)"
  exit 0
else
  echo "GATE FAILED: $DT_ID ($FAILED_COUNT/$TOTAL_COUNT evals failed)"
  exit 1
fi
