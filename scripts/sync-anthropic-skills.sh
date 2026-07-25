#!/usr/bin/env bash
set -euo pipefail

# Sync selected skills from anthropics/skills repository into OpenAWork reference skills.
#
# Usage:
#   ./scripts/sync-anthropic-skills.sh              # sync from main branch
#   ./scripts/sync-anthropic-skills.sh <commit_sha>  # sync from specific commit

REPO_URL="https://github.com/anthropics/skills.git"
BRANCH="main"
TARGET_COMMIT="${1:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REFERENCE_DIR="$PROJECT_ROOT/packages/resources/resources/skills/reference"
SYNC_MANIFEST="$REFERENCE_DIR/.anthropic-sync.json"
TMP_DIR=$(mktemp -d)

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# Skills to sync (add/remove entries here to change the set)
SYNC_SKILLS=(
  "docx"
  "pdf"
  "pptx"
  "xlsx"
  "frontend-design"
  "canvas-design"
  "theme-factory"
  "brand-guidelines"
  "algorithmic-art"
  "slack-gif-creator"
  "webapp-testing"
  "web-artifacts-builder"
  "skill-creator"
  "doc-coauthoring"
)

echo "==> Cloning anthropics/skills (shallow)..."
if [ -n "$TARGET_COMMIT" ]; then
  git clone --depth 1 "$REPO_URL" "$TMP_DIR/skills"
  cd "$TMP_DIR/skills"
  git fetch --depth 1 origin "$TARGET_COMMIT"
  git checkout "$TARGET_COMMIT"
  COMMIT_SHA="$TARGET_COMMIT"
else
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$TMP_DIR/skills"
  cd "$TMP_DIR/skills"
  COMMIT_SHA=$(git rev-parse HEAD)
fi

# Skip if already up to date
if [ -f "$SYNC_MANIFEST" ]; then
  PREV_COMMIT=$(jq -r '.commit // ""' "$SYNC_MANIFEST" 2>/dev/null || true)
  if [ "$PREV_COMMIT" = "$COMMIT_SHA" ]; then
    echo "==> Already up to date (commit: ${COMMIT_SHA:0:12}). Skipping."
    exit 0
  fi
  echo "==> Upstream changed: ${PREV_COMMIT:0:12} → ${COMMIT_SHA:0:12}"
fi

echo "==> Syncing ${#SYNC_SKILLS[@]} skills (commit: ${COMMIT_SHA:0:12})..."

synced=()
skipped=()

for skill in "${SYNC_SKILLS[@]}"; do
  src="$TMP_DIR/skills/skills/$skill"
  dest="$REFERENCE_DIR/$skill"

  if [ ! -d "$src" ]; then
    echo "  SKIP: $skill (not found in upstream)"
    skipped+=("$skill")
    continue
  fi

  # Remove old directory if it exists
  if [ -d "$dest" ]; then
    rm -rf "$dest"
  fi

  # Copy entire skill directory
  cp -r "$src" "$dest"

  # Remove LICENSE.txt (we track the upstream commit instead)
  rm -f "$dest/LICENSE.txt"

  echo "  OK:   $skill"
  synced+=("$skill")
done

# Write sync manifest
SYNC_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
cat > "$SYNC_MANIFEST" <<EOF
{
  "upstream": "$REPO_URL",
  "branch": "$BRANCH",
  "commit": "$COMMIT_SHA",
  "syncedAt": "$SYNC_TIME",
  "skills": [
$(printf '    "%s",\n' ${synced[@]+"${synced[@]}"} | sed '$ s/,$//')
  ],
  "skipped": [$(if [ ${#skipped[@]} -gt 0 ]; then echo ""; printf '    "%s",\n' "${skipped[@]}"; echo "  "; fi])
}
EOF

echo ""
echo "==> Done! Synced ${#synced[@]} skills, skipped ${#skipped[@]}"
echo "    Manifest: $SYNC_MANIFEST"
echo "    Commit:   $COMMIT_SHA"
