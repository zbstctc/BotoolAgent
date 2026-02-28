#!/bin/bash
# sandbox-guard.sh — Claude Code preToolUse hook
# Intercepts dangerous Bash commands via blacklist pattern matching.
# Exit: 0=allow, 2=block
#
# Claude Code hook protocol:
#   stdin: JSON with tool_name and tool_input
#   stdout: JSON {"decision":"block","reason":"..."} when blocking
#   exit 0 = allow, exit 2 = block
#
# Zero external dependencies — uses pure bash/grep (no jq required).

INPUT=$(cat)

# Extract tool_name using grep/sed (no jq needed — hook JSON is simple structured)
TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:.*"\([^"]*\)"/\1/')

# Only inspect Bash tool calls
[ "$TOOL_NAME" = "Bash" ] || exit 0

# Extract command value from tool_input.command
# Handle multiline JSON: join lines, then extract the command field
COMMAND=$(echo "$INPUT" | tr '\n' ' ' | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:.*"\(.*\)"/\1/')
[ -n "$COMMAND" ] || exit 0

# Dangerous pattern blacklist (token-level matching with \b word boundaries)
DENY_PATTERNS=(
  # Filesystem destruction (rm with -r or -f in any flag combo)
  '\brm\b.*-[a-zA-Z]*r'
  '\brm\b.*-[a-zA-Z]*f'

  # Database destruction
  '\bprisma\b.*\bdb\b.*\bpush\b'
  '\bDROP\s+DATABASE\b'
  '\bDROP\s+TABLE\b'
  '\bTRUNCATE\s+TABLE\b'

  # Git dangerous operations
  '\bgit\b.*\bpush\b.*--force'
  '\bgit\b.*\bpush\b.*\s-f\b'
  '\bgit\b.*\bpush\b.*--force-with-lease'
  '\bgit\b.*\bpush\b.*\s\+[a-zA-Z]'
  '\bgit\b.*\breset\b.*--hard'
  '\bgit\b.*\bclean\b.*-[a-zA-Z]*f'

  # System-level danger
  '\bmkfs\.'
  '\bdd\b.*\bif=.*\bof=/dev/'
  '>\s*/dev/sd[a-z]'
  '\bchmod\b.*-R.*\b777\b.*/'
  '\bcurl\b.*\|\s*(ba)?sh'
  '\bwget\b.*\|\s*(ba)?sh'

  # Environment destruction
  '\bnpm\b.*\bcache\b.*\bclean\b.*--force'
)

for pattern in "${DENY_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qEi "$pattern"; then
    # Escape pattern for JSON (replace backslashes and quotes)
    ESCAPED_PATTERN=$(echo "$pattern" | sed 's/\\/\\\\/g; s/"/\\"/g')
    echo "{\"decision\":\"block\",\"reason\":\"sandbox-guard: command matches dangerous pattern [$ESCAPED_PATTERN]\"}"
    exit 2
  fi
done

# No dangerous pattern matched → allow
exit 0
