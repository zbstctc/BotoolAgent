#!/bin/bash
# BotoolAgent Packaging Script
# Creates a portable distribution package for use in other projects.
#
# Usage: ./pack.sh [output-name]
# Output: BotoolAgent.tar.gz (or custom name)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Normalize to BotoolAgent root when running from scripts/ subdirectory
if [ "$(basename "$SCRIPT_DIR")" = "scripts" ]; then
  SCRIPT_DIR="$(dirname "$SCRIPT_DIR")"
fi
OUTPUT_NAME="${1:-BotoolAgent}"
OUTPUT_FILE="${OUTPUT_NAME}.tar.gz"

echo "📦 Packaging BotoolAgent for distribution..."

# Create a temporary directory for the package
TMP_DIR=$(mktemp -d)
PACKAGE_DIR="$TMP_DIR/BotoolAgent"
mkdir -p "$PACKAGE_DIR"

# Copy essential files
echo "  Copying core files..."
cp "$SCRIPT_DIR/scripts/BotoolAgent.sh" "$PACKAGE_DIR/"
cp "$SCRIPT_DIR/CLAUDE.md" "$PACKAGE_DIR/"
cp "$SCRIPT_DIR/CLAUDE.lead.md" "$PACKAGE_DIR/"
cp "$SCRIPT_DIR/README.md" "$PACKAGE_DIR/"
cp "$SCRIPT_DIR/LICENSE" "$PACKAGE_DIR/" 2>/dev/null || true
cp "$SCRIPT_DIR/docs/examples/prd.json.example" "$PACKAGE_DIR/" 2>/dev/null || true
cp "$SCRIPT_DIR/docs/examples/patterns.json.example" "$PACKAGE_DIR/" 2>/dev/null || true
cp "$SCRIPT_DIR/docs/examples/botoolrc.example" "$PACKAGE_DIR/.botoolrc.example" 2>/dev/null || true

# Copy viewer source (without node_modules and .next)
echo "  Copying viewer source..."
rsync -a --exclude='node_modules' --exclude='.next' --exclude='.turbo' \
  "$SCRIPT_DIR/viewer/" "$PACKAGE_DIR/viewer/"

# Copy skills
echo "  Copying skills..."
cp -r "$SCRIPT_DIR/skills" "$PACKAGE_DIR/"

# Copy rules (template)
echo "  Copying rules templates..."
mkdir -p "$PACKAGE_DIR/rules"
cp -r "$SCRIPT_DIR/rules/"* "$PACKAGE_DIR/rules/" 2>/dev/null || true

# Create empty directories
mkdir -p "$PACKAGE_DIR/tasks"
mkdir -p "$PACKAGE_DIR/logs"
mkdir -p "$PACKAGE_DIR/archive"

# Copy .gitignore template for the BotoolAgent directory
cp "$SCRIPT_DIR/.gitignore" "$PACKAGE_DIR/.gitignore"

# Copy plugin config
mkdir -p "$PACKAGE_DIR/.claude-plugin"
cp "$SCRIPT_DIR/.claude-plugin/plugin.json" "$PACKAGE_DIR/.claude-plugin/" 2>/dev/null || true

# Create setup script
cat > "$PACKAGE_DIR/setup.sh" << 'SETUP_EOF'
#!/bin/bash
# BotoolAgent Setup Script
# Run this once after extracting the package into your project.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Setting up BotoolAgent..."

# Install viewer dependencies
echo "  Installing viewer dependencies (this may take a minute)..."
cd "$SCRIPT_DIR/viewer" && npm install --silent
cd "$SCRIPT_DIR"

# Make scripts executable
chmod +x "$SCRIPT_DIR/BotoolAgent.sh"

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
SETUP_EOF
chmod +x "$PACKAGE_DIR/setup.sh"

# Create the tar.gz
echo "  Creating archive..."
cd "$TMP_DIR"
tar -czf "$SCRIPT_DIR/$OUTPUT_FILE" BotoolAgent/

# Cleanup
rm -rf "$TMP_DIR"

# Show result
SIZE=$(du -sh "$SCRIPT_DIR/$OUTPUT_FILE" | cut -f1)
echo ""
echo "✅ Package created: $OUTPUT_FILE ($SIZE)"
echo ""
echo "Distribution instructions:"
echo "  1. Share $OUTPUT_FILE with your team"
echo "  2. They extract it into their project: tar -xzf $OUTPUT_FILE"
echo "  3. Run the setup script: cd BotoolAgent && ./setup.sh"
echo "  4. Skills are auto-installed by setup.sh (symlinked to ~/.claude/skills/)"
