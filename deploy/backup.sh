#!/usr/bin/env bash
set -euo pipefail

# codeprism.dev daily backup
# Add to crontab: 0 3 * * * /path/to/codeprism/deploy/backup.sh

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/codeprism}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
COMPOSE_FILE="${COMPOSE_FILE:-$SCRIPT_DIR/docker-compose.prod.yml}"
SERVICE_NAME="codeprism"

mkdir -p "$BACKUP_DIR"

echo "Backing up codeprism databases..."

# Use docker compose cp to safely extract DB files from the running container
CONTAINER_DATA="/data"
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

cd "$SCRIPT_DIR"

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
