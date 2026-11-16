#!/bin/sh
# Proves the backups are usable: restores the newest dump into a scratch database and counts rows. Run it monthly:
#   docker compose run --rm --entrypoint /restore-check.sh backup
set -eu
: "${DATABASE_URL:?}" "${BACKUP_REMOTE:?}"
LATEST=$(rclone lsf "$BACKUP_REMOTE" | sort | tail -n 1)
[ -n "$LATEST" ] || { echo "no backups found in $BACKUP_REMOTE" >&2; exit 1; }
echo "restoring $LATEST into a scratch database"
ADMIN="${DATABASE_URL%/*}/postgres"
SCRATCH="${DATABASE_URL%/*}/restore_check"
psql "$ADMIN" -v ON_ERROR_STOP=1 -c 'drop database if exists restore_check' -c 'create database restore_check'
trap 'psql "$ADMIN" -c "drop database if exists restore_check" >/dev/null' EXIT
rclone cat "${BACKUP_REMOTE%/}/$LATEST" | gunzip | psql "$SCRATCH" -v ON_ERROR_STOP=1 -q
psql "$SCRATCH" -At -c "select 'transactions: ' || count(*) from transactions" -c "select 'categories: ' || count(*) from categories"
echo "restore check ok"
