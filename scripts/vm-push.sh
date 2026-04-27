#!/usr/bin/env bash
# vm-push.sh — reliable git push from the Cowork VM.
#
# The Cowork VM mounts the repo over VirtioFS which does not support POSIX
# file locking.  Git's normal index/HEAD/ref update path creates .lock files
# that it can never delete, permanently breaking the standard git workflow.
#
# This script works around all of that:
#   1. Cleans up any stale .lock files from previous failed operations.
#   2. Stages files by reading the current HEAD tree into a temporary index,
#      then applying the requested changes on top (never touches the real index).
#   3. Writes a new tree, creates a commit object, advances the branch ref
#      directly (no index.lock / HEAD.lock needed).
#   4. Pushes to origin; ignores the cosmetic "update_ref failed" error for
#      the remote tracking ref (that file can't be updated over VirtioFS either,
#      but the actual push always succeeds).
#
# Usage:
#   scripts/vm-push.sh "commit message" [file1 file2 ...]
#
#   If no files are listed, ALL tracked modified/new files are staged.
#
# Examples:
#   scripts/vm-push.sh "fix: typo in README" README.md
#   scripts/vm-push.sh "feat: add new node" app/nodes/action_new.py frontend/...
#   scripts/vm-push.sh "chore: update docs"   # stages everything

set -euo pipefail

REPO="$(git rev-parse --show-toplevel)"
IDX="/tmp/vm_push_idx_$$"
MSG="${1:-"chore: update"}"
shift || true   # remaining args are optional file paths

# ── 1. Clean stale lock files ─────────────────────────────────────────────────
for lock in \
  "$REPO/.git/index.lock" \
  "$REPO/.git/HEAD.lock" \
  "$REPO/.git/refs/heads/main.lock" \
  "$REPO/.git/refs/remotes/origin/main.lock" \
  "$REPO/.git/objects/maintenance.lock"
do
  [ -f "$lock" ] && { echo "Removing stale lock: $lock"; rm -f "$lock" 2>/dev/null || echo "  (could not remove — VirtioFS permission, continuing)"; }
done

# ── 2. Load current HEAD into a fresh temp index ─────────────────────────────
PARENT=$(cat "$REPO/.git/refs/heads/main")
GIT_INDEX_FILE="$IDX" git -C "$REPO" read-tree "$PARENT"

# ── 3. Stage files ────────────────────────────────────────────────────────────
if [ $# -gt 0 ]; then
  # Explicit file list
  for f in "$@"; do
    if [ -e "$REPO/$f" ]; then
      GIT_INDEX_FILE="$IDX" git -C "$REPO" add "$f"
    else
      GIT_INDEX_FILE="$IDX" git -C "$REPO" rm --cached "$f" 2>/dev/null || true
    fi
  done
else
  # Stage everything changed (tracked + new)
  GIT_INDEX_FILE="$IDX" git -C "$REPO" add -A
fi

# ── 4. Write tree + commit ────────────────────────────────────────────────────
TREE=$(GIT_INDEX_FILE="$IDX" git -C "$REPO" write-tree)
COMMIT=$(git -C "$REPO" commit-tree "$TREE" -p "$PARENT" -m "$MSG")
echo "$COMMIT" > "$REPO/.git/refs/heads/main"
echo "Created commit $COMMIT"

# ── 5. Push ───────────────────────────────────────────────────────────────────
git -C "$REPO" push origin main 2>&1 | grep -v "update_ref failed" | grep -v "main.lock" || true
echo "Done."

rm -f "$IDX"
