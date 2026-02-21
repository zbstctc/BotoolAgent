---
name: botoolagent-update
description: "Update BotoolAgent to the latest version from GitHub. Downloads the latest release, replaces core files while preserving project data (tasks, rules, logs). Triggers on: update botool, upgrade botool, botool update, check for updates."
user-invocable: true
---

# BotoolAgent Update

Checks for and installs the latest BotoolAgent version from GitHub.

---

**Announce at start:** "Checking for BotoolAgent updates..."

---

## Prerequisites

This skill requires `curl` and internet access. No GitHub account or authentication needed (public repo).

Run this check first:

```bash
curl -s --head https://api.github.com/repos/zbstctc/BotoolAgent/releases/latest | head -1
```

If the response is not `HTTP/2 200`, tell the user:
> "Could not reach GitHub API. Check your network connection."

Then stop.

---

## Step 0: Skill Symlink 健康检查（自动修复）

**无条件执行，不询问用户。**

```bash
# 检测 BotoolAgent 安装根目录
BOTOOL_ROOT="$([ -d "BotoolAgent" ] && echo "BotoolAgent" || echo ".")"
SKILLS_SRC="$BOTOOL_ROOT/skills/BotoolAgent"

FIXED_COUNT=0

for skill_dir in "$SKILLS_SRC"/*/; do
  [ -d "$skill_dir" ] || continue
  skill_name=$(basename "$skill_dir" | tr '[:upper:]' '[:lower:]')
  skill_key="botoolagent-${skill_name}"
  [ "$skill_name" = "main" ] && skill_key="botoolagent"

  SOURCE="$(cd "$skill_dir" && pwd)/SKILL.md"
  LINK="$HOME/.claude/skills/${skill_key}/SKILL.md"

  # 跳过不存在的 skill 目录（可能用户未安装该 skill）
  [ -d "$HOME/.claude/skills/${skill_key}" ] || continue

  CURRENT=$(readlink "$LINK" 2>/dev/null)
  if [ "$CURRENT" != "$SOURCE" ]; then
    ln -sf "$SOURCE" "$LINK"
    echo "✓ Fixed symlink: $skill_key"
    FIXED_COUNT=$((FIXED_COUNT + 1))
  fi
done

if [ "$FIXED_COUNT" -eq 0 ]; then
  echo "Symlinks OK — all skills pointing to correct location."
else
  echo "$FIXED_COUNT symlink(s) repaired."
fi
```

---

## Step 1: Read Current Version

```bash
cat .botoolagent-version 2>/dev/null || echo "unknown"
```

Save as `CURRENT_VERSION`.

If `.botoolagent-version` doesn't exist, warn the user this installation may predate the version system, and set `CURRENT_VERSION="v0.0.0"`.

---

## Step 2: Check Latest Version on GitHub

```bash
curl -s https://api.github.com/repos/zbstctc/BotoolAgent/releases/latest | grep '"tag_name"' | sed 's/.*: "//;s/".*//'
```

Save as `LATEST_VERSION`.

If the API call fails or returns empty, tell the user:
> "Could not fetch latest version from GitHub. Check your network connection."

Then stop.

---

## Step 3: Compare Versions

If `CURRENT_VERSION` == `LATEST_VERSION`:
> "BotoolAgent is already up to date (CURRENT_VERSION). Symlinks verified in Step 0."

Then stop. No further action needed.

If different, show the user:
> "Update available: CURRENT_VERSION -> LATEST_VERSION"

And show the release notes:
```bash
curl -s https://api.github.com/repos/zbstctc/BotoolAgent/releases/latest | python3 -c "import sys,json; print(json.load(sys.stdin).get('body','No release notes.'))"
```

Ask the user to confirm before proceeding.

---

## Step 4: Download and Extract

```bash
# Create temp directory
TMPDIR=$(mktemp -d)

# Get the download URL for the distribution tarball (BotoolAgent-vX.Y.Z.tar.gz)
DOWNLOAD_URL=$(curl -s https://api.github.com/repos/zbstctc/BotoolAgent/releases/latest | python3 -c "
import sys, json
assets = json.load(sys.stdin).get('assets', [])
for a in assets:
    if a['name'].startswith('BotoolAgent-') and a['name'].endswith('.tar.gz'):
        print(a['browser_download_url'])
        break
")

# Download
curl -L -o "$TMPDIR/botool-release.tar.gz" "$DOWNLOAD_URL"

# Extract
cd "$TMPDIR"
tar -xzf botool-release.tar.gz
EXTRACTED_DIR=$(ls -d */ | head -1)
```

If `DOWNLOAD_URL` is empty, fall back to the source tarball:
```bash
DOWNLOAD_URL="https://github.com/zbstctc/BotoolAgent/archive/refs/tags/LATEST_VERSION.tar.gz"
```

---

## Step 5: Replace Core Files

Read `.botoolagent-manifest.json` from the **downloaded** version (not the local one) to get the `core` list.

For each path in `core`:
- If it ends with `/`, it's a directory — delete the local one and copy the new one
- If it's a file — overwrite with the new version

**CRITICAL**: Never touch paths listed in `preserve`. Before replacing, verify none of the core paths overlap with preserve paths.

```bash
# Example replacement logic (run for each core path):

# For directories:
rm -rf ./scripts/
cp -r "$TMPDIR/$EXTRACTED_DIR/scripts/" ./scripts/

# For files:
cp "$TMPDIR/$EXTRACTED_DIR/viewer/package.json" ./viewer/package.json
```

---

## Step 6: Post-Update

1. **Update version file**:
```bash
echo "LATEST_VERSION" > .botoolagent-version
```

2. **Reinstall dependencies** (if viewer/package.json changed):
```bash
cd viewer && npm ci --include=optional --no-fund --no-audit
```

3. **Re-run setup** to update skill symlinks:
```bash
./setup.sh
```

4. **Cleanup**:
```bash
rm -rf "$TMPDIR"
```

---

## Step 7: Confirm Success

Tell the user:
> "BotoolAgent updated successfully: CURRENT_VERSION -> LATEST_VERSION"
> "Please restart the Viewer dev server to apply changes."

---

## Error Handling

- If any step fails, **do not leave the project in a broken state**
- Before replacing core files, back up the current versions to a temp directory
- If replacement fails midway, restore from backup
- Always clean up temp directories

---

## Safety Rules

1. **NEVER** modify files in `preserve` list
2. **NEVER** delete the entire project directory
3. **ALWAYS** confirm with user before applying updates
4. **ALWAYS** show what version is being installed and what changed
5. If `.botoolagent-manifest.json` is missing locally, treat ALL non-core directories as preserved
