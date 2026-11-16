#!/bin/sh
# Update the running site: back up first (a schema change is never applied without a fresh backup), then rebuild and restart.
# Migrations run by themselves when the app container starts.
set -eu
cd "$(dirname "$0")/.."
docker compose run --rm --entrypoint /backup.sh backup
docker compose up -d --build
docker compose ps
