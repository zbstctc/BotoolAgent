#!/bin/bash
# BotoolAgent Setup Script
# Run this once after extracting the package into your project.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Setting up BotoolAgent..."

# Install viewer dependencies
echo "  Installing viewer dependencies (this may take a minute)..."
cd "$SCRIPT_DIR/viewer"

# Ensure optional native deps are installed (required by lightningcss/tailwind on arm64)
if [ -f "package-lock.json" ]; then
  npm ci --include=optional --no-fund --no-audit
else
  npm install --include=optional --no-fund --no-audit
fi

# Verify lightningcss native binding is loadable; attempt one auto-repair if missing
if ! node -e "require('lightningcss')" >/dev/null 2>&1; then
  echo "  ⚠️ lightningcss native binding missing, attempting repair..."
  rm -rf node_modules/lightningcss
  npm install lightningcss --include=optional --no-fund --no-audit
fi

cd "$SCRIPT_DIR"

# Make scripts executable
chmod +x "$SCRIPT_DIR/BotoolAgent.sh"
chmod +x "$SCRIPT_DIR/scripts/BotoolAgent.sh"

# Install skills as symlinks to ~/.claude/skills/
echo "  Installing skills..."
SKILLS_DIR="$HOME/.claude/skills"
mkdir -p "$SKILLS_DIR"

for skill_file in "$SCRIPT_DIR"/skills/BotoolAgent/*/SKILL.md; do
  [ -f "$skill_file" ] || continue

  # Extract skill name from YAML frontmatter
  skill_name=$(grep '^name:' "$skill_file" | head -1 | sed 's/name: *//;s/"//g;s/ *$//')
  [ -z "$skill_name" ] && continue

  target_dir="$SKILLS_DIR/$skill_name"
  target_file="$target_dir/SKILL.md"

  mkdir -p "$target_dir"

  # If target exists and is a regular file, back it up
  if [ -f "$target_file" ] && [ ! -L "$target_file" ]; then
    mv "$target_file" "$target_file.bak"
    echo "    Backed up existing $skill_name/SKILL.md"
  fi

  # Remove existing symlink if present
  [ -L "$target_file" ] && rm "$target_file"

  # Create symlink
  ln -s "$skill_file" "$target_file"
  echo "    Linked: $skill_name"
done

echo ""
echo "BotoolAgent is ready!"
echo ""

# Check for optional Codex CLI
echo "Optional tools status:"
if command -v codex >/dev/null 2>&1; then
  CODEX_VER=$(codex --version 2>/dev/null || echo "unknown")
  echo "  ✅ Codex CLI: installed ($CODEX_VER)"
  echo "     Adversarial review (Testing L5) is available."
else
  echo "  ⚠️  Codex CLI: not installed"
  echo "     Adversarial review (Testing L5) will be skipped."
  echo "     Install: npm install -g @openai/codex"
fi

# Check for optional codex-mcp-server
if command -v npx >/dev/null 2>&1 && npx --yes @anthropic-ai/codex-mcp-server --help >/dev/null 2>&1; then
  echo "  ✅ codex-mcp-server: available"
else
  echo "  ℹ️  codex-mcp-server: not detected (optional)"
  echo "     Enables Codex as MCP tool inside Claude Code."
  echo "     Install: npm install -g @anthropic-ai/codex-mcp-server"
fi
echo ""

echo "Usage:"
echo "  1. Open Claude Code in your project root directory"
echo "  2. Type /botoolagent to launch the Viewer"
echo "  3. Or type /botoolagent-pyramidprd to create a PRD"
echo ""
echo "Installed skills:"
for skill_file in "$SCRIPT_DIR"/skills/BotoolAgent/*/SKILL.md; do
  [ -f "$skill_file" ] || continue
  skill_name=$(grep '^name:' "$skill_file" | head -1 | sed 's/name: *//;s/"//g;s/ *$//')
  echo "  /$(echo "$skill_name")"
done
