#!/usr/bin/env bash
# Daily copy of the sqlite cache. Installed by bootstrap.sh as /usr/local/sbin/tradesimple-backup and run from
# /etc/cron.d/tradesimple as the app user. Uses sqlite's online .backup (safe while the server writes), checks the
# copy, gzips it, and keeps the newest $BACKUP_KEEP (default 7) in $BACKUP_DIR (default /var/backups/tradesimple).
set -euo pipefail

# As root (sudo tradesimple-backup), run as the app user so sqlite never leaves root-owned -wal/-shm files behind.
if [ "$(id -u)" -eq 0 ] && id tradesimple >/dev/null 2>&1; then
  exec runuser -u tradesimple -- "$0" "$@"
fi

DB=${INTEL_CACHE:-/var/lib/tradesimple/cache.sqlite}
DIR=${BACKUP_DIR:-/var/backups/tradesimple}
KEEP=${BACKUP_KEEP:-7}

if [ ! -f "$DB" ]; then
  echo "no database at $DB yet"
  exit 0
fi
umask 077
mkdir -p "$DIR"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
tmp="$DIR/.cache-$stamp.sqlite"
trap 'rm -f "$tmp" "$tmp.gz"' EXIT

sqlite3 "$DB" ".timeout 20000" ".backup '$tmp'"
check=$(sqlite3 "$tmp" "PRAGMA quick_check;")
if [ "$check" != "ok" ]; then
  echo "backup copy failed quick_check: $check" >&2
  exit 1
fi
gzip -6 "$tmp"
mv "$tmp.gz" "$DIR/cache-$stamp.sqlite.gz"
echo "saved $DIR/cache-$stamp.sqlite.gz ($(du -h "$DIR/cache-$stamp.sqlite.gz" | cut -f1))"

n=0
while IFS= read -r old; do
  n=$((n + 1))
  [ "$n" -le "$KEEP" ] || rm -f -- "$old"
done < <(ls -1t "$DIR"/cache-*.sqlite.gz 2>/dev/null)
