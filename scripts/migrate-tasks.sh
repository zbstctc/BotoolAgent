#!/usr/bin/env bash
# migrate-tasks.sh — Migrate flat tasks/ files to per-project directory structure
#
# Old format:
#   tasks/prd-{id}.md
#   tasks/prd-{id}.json
#   tasks/progress-{id}.txt
#   tasks/DRAFT-{id}[-date].md
#   tasks/.prd-sessions.json   (global sessions map)
#   .state/agent-status
#   .state/agent-pid
#
# New format:
#   tasks/{id}/prd.md
#   tasks/{id}/prd.json
#   tasks/{id}/progress.txt
#   tasks/{id}/DRAFT.md
#   tasks/{id}/prd-session.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOTOOL_DIR="$(dirname "$SCRIPT_DIR")"
TASKS_DIR="$BOTOOL_DIR/tasks"

echo "=== BotoolAgent Task Migration ==="
echo "Source: $TASKS_DIR"
echo ""

if [ ! -d "$TASKS_DIR" ]; then
  echo "ERROR: tasks/ directory not found at $TASKS_DIR"
  exit 1
fi

migrate_count=0
skip_count=0

# Migrate prd-{id}.md → tasks/{id}/prd.md
echo "--- Migrating prd-*.md files ---"
for src in "$TASKS_DIR"/prd-*.md; do
  [ -f "$src" ] || continue
  filename=$(basename "$src")
  id="${filename#prd-}"
  id="${id%.md}"
  dest_dir="$TASKS_DIR/$id"
  dest="$dest_dir/prd.md"
  if [ -f "$dest" ]; then
    echo "  SKIP: $dest already exists"
    ((skip_count++)) || true
    continue
  fi
  mkdir -p "$dest_dir"
  mv "$src" "$dest"
  echo "  MOVED: $filename → $id/prd.md"
  ((migrate_count++)) || true
done

# Migrate prd-{id}.json → tasks/{id}/prd.json
echo "--- Migrating prd-*.json files ---"
for src in "$TASKS_DIR"/prd-*.json; do
  [ -f "$src" ] || continue
  filename=$(basename "$src")
  id="${filename#prd-}"
  id="${id%.json}"
  dest_dir="$TASKS_DIR/$id"
  dest="$dest_dir/prd.json"
  if [ -f "$dest" ]; then
    echo "  SKIP: $dest already exists"
    ((skip_count++)) || true
    continue
  fi
  mkdir -p "$dest_dir"
  mv "$src" "$dest"
  echo "  MOVED: $filename → $id/prd.json"
  ((migrate_count++)) || true
done

# Migrate progress-{id}.txt → tasks/{id}/progress.txt
echo "--- Migrating progress-*.txt files ---"
for src in "$TASKS_DIR"/progress-*.txt; do
  [ -f "$src" ] || continue
  filename=$(basename "$src")
  id="${filename#progress-}"
  id="${id%.txt}"
  dest_dir="$TASKS_DIR/$id"
  dest="$dest_dir/progress.txt"
  if [ -f "$dest" ]; then
    echo "  SKIP: $dest already exists"
    ((skip_count++)) || true
    continue
  fi
  mkdir -p "$dest_dir"
  mv "$src" "$dest"
  echo "  MOVED: $filename → $id/progress.txt"
  ((migrate_count++)) || true
done

# Migrate DRAFT-{id}[-date].md → tasks/{id}/DRAFT.md
# Extract id by stripping DRAFT- prefix and optional trailing -YYYYMMDD suffix
echo "--- Migrating DRAFT-*.md files ---"
for src in "$TASKS_DIR"/DRAFT-*.md; do
  [ -f "$src" ] || continue
  filename=$(basename "$src")
  id="${filename#DRAFT-}"
  id="${id%.md}"
  # Strip optional trailing date suffix like -20260218
  id="${id%-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]}"
  dest_dir="$TASKS_DIR/$id"
  dest="$dest_dir/DRAFT.md"
  if [ -f "$dest" ]; then
    echo "  SKIP: $dest already exists"
    ((skip_count++)) || true
    continue
  fi
  mkdir -p "$dest_dir"
  mv "$src" "$dest"
  echo "  MOVED: $filename → $id/DRAFT.md"
  ((migrate_count++)) || true
done

# Migrate .state/agent-status → tasks/{active-project}/agent-status
# We look up the active project from registry.json
echo "--- Migrating .state/agent-status ---"
STATE_DIR="$BOTOOL_DIR/.state"
if [ -f "$STATE_DIR/agent-status" ]; then
  REGISTRY="$TASKS_DIR/registry.json"
  if [ -f "$REGISTRY" ]; then
    active_id=$(python3 -c "
import json, sys
with open('$REGISTRY') as f:
    r = json.load(f)
print(r.get('activeProject', ''))
" 2>/dev/null || echo "")
    if [ -n "$active_id" ]; then
      dest_dir="$TASKS_DIR/$active_id"
      dest="$dest_dir/agent-status"
      if [ ! -f "$dest" ]; then
        mkdir -p "$dest_dir"
        cp "$STATE_DIR/agent-status" "$dest"
        echo "  COPIED: .state/agent-status → $active_id/agent-status"
        ((migrate_count++)) || true
      else
        echo "  SKIP: $dest already exists"
        ((skip_count++)) || true
      fi
    fi
  fi
fi

if [ -f "$STATE_DIR/agent-pid" ]; then
  REGISTRY="$TASKS_DIR/registry.json"
  if [ -f "$REGISTRY" ]; then
    active_id=$(python3 -c "
import json, sys
with open('$REGISTRY') as f:
    r = json.load(f)
print(r.get('activeProject', ''))
" 2>/dev/null || echo "")
    if [ -n "$active_id" ]; then
      dest_dir="$TASKS_DIR/$active_id"
      dest="$dest_dir/agent-pid"
      if [ ! -f "$dest" ]; then
        mkdir -p "$dest_dir"
        cp "$STATE_DIR/agent-pid" "$dest"
        echo "  COPIED: .state/agent-pid → $active_id/agent-pid"
        ((migrate_count++)) || true
      else
        echo "  SKIP: $dest already exists"
        ((skip_count++)) || true
      fi
    fi
  fi
fi

# Migrate .prd-sessions.json → per-project prd-session.json
echo "--- Migrating .prd-sessions.json ---"
SESSIONS_FILE="$TASKS_DIR/.prd-sessions.json"
if [ -f "$SESSIONS_FILE" ]; then
  python3 -c "
import json, os

sessions_file = '$SESSIONS_FILE'
tasks_dir = '$TASKS_DIR'

with open(sessions_file) as f:
    sessions = json.load(f)

for project_id, entry in sessions.items():
    dest_dir = os.path.join(tasks_dir, project_id)
    dest = os.path.join(dest_dir, 'prd-session.json')
    if os.path.exists(dest):
        print(f'  SKIP: {dest} already exists')
        continue
    os.makedirs(dest_dir, exist_ok=True)
    with open(dest, 'w') as f:
        json.dump(entry, f, indent=2)
    print(f'  CREATED: {project_id}/prd-session.json')
" 2>/dev/null || echo "  WARNING: Could not migrate .prd-sessions.json (python3 not available?)"
fi

# Update registry.json path format
echo "--- Updating registry.json paths ---"
REGISTRY="$TASKS_DIR/registry.json"
if [ -f "$REGISTRY" ]; then
  python3 -c "
import json, re

registry_file = '$REGISTRY'
with open(registry_file) as f:
    registry = json.load(f)

changed = False
for pid, project in registry.get('projects', {}).items():
    # Update prdMd: prd-{id}.md → {id}/prd.md
    old_prd_md = project.get('prdMd', '')
    if old_prd_md.startswith('prd-') and old_prd_md.endswith('.md'):
        project['prdMd'] = f'{pid}/prd.md'
        changed = True
    # Update prdJson: prd-{id}.json → {id}/prd.json
    old_prd_json = project.get('prdJson', '')
    if old_prd_json.startswith('prd-') and old_prd_json.endswith('.json'):
        project['prdJson'] = f'{pid}/prd.json'
        changed = True
    # Update progress: progress-{id}.txt → {id}/progress.txt
    old_progress = project.get('progress', '')
    if old_progress.startswith('progress-') and old_progress.endswith('.txt'):
        project['progress'] = f'{pid}/progress.txt'
        changed = True

if changed:
    with open(registry_file, 'w') as f:
        json.dump(registry, f, indent=2)
    print('  UPDATED: registry.json paths to new format')
else:
    print('  OK: registry.json already up to date')
" 2>/dev/null || echo "  WARNING: Could not update registry.json (python3 not available?)"
fi

echo ""
echo "=== Migration complete ==="
echo "  Migrated: $migrate_count files"
echo "  Skipped:  $skip_count files (already in new format)"
echo ""
echo "NOTE: Original .state/agent-status and .prd-sessions.json are preserved."
echo "They can be deleted manually after verification."
