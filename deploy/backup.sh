#!/usr/bin/env bash
set -euo pipefail

# srcmap.ai daily backup
# Add to crontab: 0 3 * * * /opt/srcmap/repo/deploy/backup.sh

BACKUP_DIR="/opt/srcmap/backups"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
COMPOSE_FILE="${COMPOSE_FILE:-/opt/srcmap/repo/deploy/docker-compose.prod.yml}"
SERVICE_NAME="srcmap"

mkdir -p "$BACKUP_DIR"

echo "Backing up srcmap databases..."

# Use docker compose cp to safely extract DB files from the running container
CONTAINER_DATA="/data"
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE_NAME" \
  sh -c "find $CONTAINER_DATA -name '*.db' -print0" | \
  xargs -0 -I{} docker compose -f "$COMPOSE_FILE" cp \
    "$SERVICE_NAME:{}" "$TEMP_DIR/"

for db in "$TEMP_DIR"/*.db; do
  [ -f "$db" ] || continue
  BASENAME=$(basename "$db")
  sqlite3 "$db" ".backup '$BACKUP_DIR/${BASENAME%.db}-$TIMESTAMP.db'"
done

# Keep last 7 days of backups
find "$BACKUP_DIR" -name "*.db" -mtime +7 -delete

echo "Backup complete: $BACKUP_DIR"
