#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   AUTOPUSH_REMOTE_URL="git@github.com:org/repo.git" scripts/auto-commit-push.sh "feat: update"
#
# Optional env vars:
#   AUTOPUSH_REMOTE_NAME   (default: origin)
#   AUTOPUSH_BRANCH        (default: current branch)
#   AUTOPUSH_REMOTE_URL    (required only when remote does not exist yet)

REMOTE_NAME="${AUTOPUSH_REMOTE_NAME:-origin}"
REMOTE_URL="${AUTOPUSH_REMOTE_URL:-}"
CURRENT_BRANCH="$(git branch --show-current)"
TARGET_BRANCH="${AUTOPUSH_BRANCH:-$CURRENT_BRANCH}"
COMMIT_MSG="${1:-chore: automated update $(date -u +%Y-%m-%dT%H:%M:%SZ)}"

if [[ -z "$CURRENT_BRANCH" ]]; then
  echo "[auto-commit-push] Cannot detect current git branch." >&2
  exit 1
fi

if ! git remote get-url "$REMOTE_NAME" >/dev/null 2>&1; then
  if [[ -z "$REMOTE_URL" ]]; then
    echo "[auto-commit-push] Remote '$REMOTE_NAME' is missing. Set AUTOPUSH_REMOTE_URL." >&2
    exit 1
  fi
  git remote add "$REMOTE_NAME" "$REMOTE_URL"
fi

if git diff --quiet && git diff --cached --quiet; then
  echo "[auto-commit-push] No changes to commit."
  exit 0
fi

git add -A
git commit -m "$COMMIT_MSG"
git push -u "$REMOTE_NAME" "HEAD:$TARGET_BRANCH"

echo "[auto-commit-push] Done: commit + push to $REMOTE_NAME/$TARGET_BRANCH"
