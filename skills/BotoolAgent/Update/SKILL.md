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

This skill requires `gh` CLI to be installed and authenticated (the repo is private).

Run this check first:

```bash
gh auth status 2>&1
```

If `gh` is not authenticated, tell the user:
> "You need to authenticate with GitHub first. Run `gh auth login` and follow the prompts."

Then stop.

---

## Step 1: Read Current Version

```bash
cat .botool-version 2>/dev/null || echo "unknown"
```

Save as `CURRENT_VERSION`.

If `.botool-version` doesn't exist, warn the user this installation may predate the version system, and set `CURRENT_VERSION="v0.0.0"`.

---

## Step 2: Check Latest Version on GitHub

```bash
gh api repos/zbstctc/BotoolAgent/releases/latest --jq '.tag_name' 2>/dev/null
```

Save as `LATEST_VERSION`.

If the API call fails, tell the user:
> "Could not reach GitHub. Check your network and `gh auth status`."

Then stop.

---

## Step 3: Compare Versions

If `CURRENT_VERSION` == `LATEST_VERSION`:
> "BotoolAgent is already up to date (CURRENT_VERSION)."

Then stop. No action needed.

If different, show the user:
> "Update available: CURRENT_VERSION -> LATEST_VERSION"

And show the release notes:
```bash
gh api repos/zbstctc/BotoolAgent/releases/latest --jq '.body'
```

Ask the user to confirm before proceeding.

---

## Step 4: Download and Extract

```bash
# Create temp directory
TMPDIR=$(mktemp -d)

# Download the release tarball
gh release download LATEST_VERSION --repo zbstctc/BotoolAgent --archive tar.gz --dir "$TMPDIR"

# Extract
cd "$TMPDIR"
tar -xzf *.tar.gz
EXTRACTED_DIR=$(ls -d */ | head -1)
```

---

## Step 5: Replace Core Files

Read `.botool-manifest.json` from the **downloaded** version (not the local one) to get the `core` list.

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
echo "LATEST_VERSION" > .botool-version
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
5. If `.botool-manifest.json` is missing locally, treat ALL non-core directories as preserved
