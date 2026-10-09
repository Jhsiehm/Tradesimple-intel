#!/usr/bin/env bash
# Installed by bootstrap.sh as /usr/local/sbin/tradesimple-update (root-owned; the app user cannot change it).
# deploy.sh runs it over ssh: fetch, npm ci when the lockfile changed, build into dist.next beside the live copy,
# keep the previous build's hashed assets (open tabs can still lazy-load them), swap, restart, health check.
# A failed health check rolls back to the previous commit and build.
#   sudo tradesimple-update [origin/main | <branch> | <commit>]
set -euo pipefail

APP=/srv/tradesimple/app
REF=${1:-origin/main}
if [[ ! $REF =~ ^[A-Za-z0-9._/-]+$ ]]; then
  echo "Bad ref: $REF" >&2
  exit 2
fi
as_app() { runuser -u tradesimple -- env HOME=/srv/tradesimple NODE_OPTIONS=--max-old-space-size=768 "$@"; }
healthy() {
  for _ in $(seq 1 40); do
    curl -fsS -o /dev/null --max-time 2 http://127.0.0.1:8787/healthz && return 0
    sleep 1
  done
  return 1
}

cd "$APP"
before=$(as_app git rev-parse HEAD)
as_app git fetch --prune --quiet origin
target=$(as_app git rev-parse --verify --quiet "${REF}^{commit}" || as_app git rev-parse --verify "origin/${REF}^{commit}")
echo "deploying $(as_app git log -1 --format='%h %s' "$target" | cut -c1-100)"
as_app git reset --hard --quiet "$target"

if [ ! -d node_modules ] || ! as_app git diff --quiet "$before" "$target" -- package.json package-lock.json; then
  echo "installing dependencies (npm ci)"
  as_app npm ci --no-audit --no-fund --loglevel=error
fi

echo "building"
rm -rf dist.next
as_app npx vite build --outDir dist.next --emptyOutDir --logLevel warn
if [ -d dist/assets ]; then
  as_app cp -pRn dist/assets/. dist.next/assets/ 2>/dev/null || true
  find dist.next/assets -type f -mtime +14 -delete
fi
rm -rf dist.prev
[ -d dist ] && mv dist dist.prev
mv dist.next dist

if ! grep -q '^INTEL_PASSWORD_HASH=.' /etc/tradesimple/env 2>/dev/null; then
  echo "built; not started because sign-in is not set yet (see README: Hosting on a VPS)"
  exit 0
fi
systemctl restart tradesimple
if healthy; then
  echo "up: $(as_app git log -1 --format='%h %s' | cut -c1-100)"
  if ! as_app git diff --quiet "$before" "$target" -- deploy/; then
    echo "note: deploy/ changed in this update. Re-run bootstrap.sh (from a fresh copy of deploy/) to install the new unit, Caddyfile or helpers."
  fi
  exit 0
fi

echo "health check failed; rolling back to ${before:0:7}" >&2
journalctl -u tradesimple -n 30 --no-pager >&2 || true
as_app git reset --hard --quiet "$before"
if ! as_app git diff --quiet "$target" "$before" -- package.json package-lock.json; then
  as_app npm ci --no-audit --no-fund --loglevel=error
fi
if [ -d dist.prev ]; then
  rm -rf dist
  mv dist.prev dist
fi
systemctl restart tradesimple
healthy && echo "rolled back; the previous version is serving" >&2
exit 1
