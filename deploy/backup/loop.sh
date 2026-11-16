#!/bin/sh
# Runs a backup now and then every BACKUP_INTERVAL_HOURS. A failed run is reported (the failure ping) and retried next time.
while true; do
  /backup.sh || echo "backup failed, will retry in ${BACKUP_INTERVAL_HOURS:-24}h" >&2
  sleep $(( ${BACKUP_INTERVAL_HOURS:-24} * 3600 ))
done
