#!/bin/sh
# Dump the database, encrypt it (the BACKUP_REMOTE is an rclone "crypt" remote) and upload it. Old dumps are pruned.
set -eu
: "${DATABASE_URL:?}" "${BACKUP_REMOTE:?}"
notify() { [ -n "${HEALTHCHECK_URL:-}" ] && curl -fsS -m 10 --retry 3 -o /dev/null "${HEALTHCHECK_URL}$1" || true; }
trap 'notify /fail' EXIT

FILE="/tmp/expenses-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
pg_dump --no-owner --clean --if-exists "$DATABASE_URL" | gzip > "$FILE"
[ "$(wc -c < "$FILE")" -gt 1000 ] # an empty or truncated dump must fail the run, not be uploaded as a "backup"
rclone copyto "$FILE" "${BACKUP_REMOTE%/}/$(basename "$FILE")"
rm -f "$FILE"
rclone delete --min-age "${BACKUP_KEEP_DAYS:-30}d" "$BACKUP_REMOTE"

trap - EXIT
notify ""
echo "backup ok"
