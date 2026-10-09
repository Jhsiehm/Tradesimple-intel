#!/usr/bin/env bash
# Installed by bootstrap.sh as /usr/local/sbin/tradesimple-env. Merges KEY=VALUE lines from an uploaded file into
# /etc/tradesimple/env (root:root 600), then deletes the upload and restarts the app. Non-empty values win; empty
# ones never blank out a key already set. Prints key names only, never values.
#   scp .env.local deploy@SERVER:/tmp/intel.env && ssh deploy@SERVER sudo tradesimple-env /tmp/intel.env
set -euo pipefail

SRC=${1:?usage: tradesimple-env FILE}
ENV_FILE=/etc/tradesimple/env
# Local-only settings that must not override the server's (the unit sets PORT, NODE_ENV and INTEL_CACHE).
SKIP='^(PORT|NODE_ENV|INTEL_CACHE|INTEL_API|INTEL_ALLOWED_ORIGINS|INTEL_AUTH|INTEL_SERVE_DIST|VITE_[A-Z0-9_]*)$'

[ -f "$SRC" ] || { echo "No such file: $SRC" >&2; exit 1; }
umask 077
install -d -m 700 /etc/tradesimple
[ -f "$ENV_FILE" ] || : > "$ENV_FILE"
work=$(mktemp)
trap 'rm -f "$work" "$work.next"' EXIT
cp "$ENV_FILE" "$work"

while IFS= read -r line || [ -n "$line" ]; do
  line=${line%$'\r'}
  [[ $line =~ ^[[:space:]]*# ]] && continue
  [[ $line =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
  key=${BASH_REMATCH[2]}
  value=${BASH_REMATCH[3]}
  [ -n "$value" ] || continue
  [[ $key =~ $SKIP ]] && { echo "skipped $key (server sets its own)"; continue; }
  grep -v "^${key}=" "$work" > "$work.next" || true
  printf '%s=%s\n' "$key" "$value" >> "$work.next"
  mv "$work.next" "$work"
  echo "set $key"
done < "$SRC"

install -m 600 -o root -g root "$work" "$ENV_FILE"
shred -u "$SRC" 2>/dev/null || rm -f "$SRC"
echo "updated $ENV_FILE; deleted the upload"

if grep -q '^INTEL_PASSWORD_HASH=.' "$ENV_FILE" && grep -q '^INTEL_SESSION_SECRET=.' "$ENV_FILE"; then
  systemctl enable --quiet tradesimple
  systemctl restart tradesimple
  sleep 2
  if ! systemctl is-active --quiet tradesimple; then
    echo "tradesimple failed to start:" >&2
    journalctl -u tradesimple -n 20 --no-pager >&2
    exit 1
  fi
  echo "tradesimple restarted and running"
else
  echo "Sign-in is not set yet (INTEL_PASSWORD_HASH, INTEL_SESSION_SECRET); the app stays stopped. Run npm run auth:hash on your laptop."
fi
