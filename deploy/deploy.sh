#!/usr/bin/env bash
# From your laptop, after `git push`: update the VPS to the pushed branch and restart.
#   deploy/deploy.sh deploy@SERVER [branch]        (or set INTEL_SSH=deploy@SERVER)
# The server pulls from GitHub (it never receives your working tree), builds beside the live copy, swaps, restarts,
# and rolls back on a failed health check. See /usr/local/sbin/tradesimple-update on the server (deploy/update.sh).
set -euo pipefail

HOST=${1:-${INTEL_SSH:-}}
BRANCH=${2:-main}
if [ -z "$HOST" ]; then
  echo "usage: deploy/deploy.sh deploy@SERVER [branch]" >&2
  exit 2
fi

if git rev-parse --git-dir >/dev/null 2>&1; then
  local_sha=$(git rev-parse --verify --quiet "$BRANCH" || true)
  remote_sha=$(git ls-remote origin "refs/heads/$BRANCH" 2>/dev/null | cut -f1)
  if [ -n "$local_sha" ] && [ "$local_sha" != "$remote_sha" ]; then
    echo "note: local $BRANCH (${local_sha:0:7}) differs from origin/$BRANCH (${remote_sha:0:7}); the server deploys origin/$BRANCH. Push first if you meant to ship local commits."
  fi
fi

# shellcheck disable=SC2029  # BRANCH is meant to expand here; update.sh re-validates it.
ssh "$HOST" sudo /usr/local/sbin/tradesimple-update "origin/$BRANCH"
