#!/usr/bin/env bash
set -euo pipefail

# srcmap.ai daily backup
# Add to crontab: 0 3 * * * /opt/srcmap/repo/deploy/backup.sh

BACKUP_DIR="/opt/srcmap/backups"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
DATA_DIR="/var/lib/docker/volumes/deploy_srcmap-data/_data"

mkdir -p "$BACKUP_DIR"

# SQLite safe backup using .backup command
echo "Backing up srcmap databases..."
for db in "$DATA_DIR"/*.db "$DATA_DIR"/tenants/*.db; do
  [ -f "$db" ] || continue
  BASENAME=$(basename "$db")
  sqlite3 "$db" ".backup '$BACKUP_DIR/${BASENAME%.db}-$TIMESTAMP.db'"
done

# Keep last 7 days of backups
find "$BACKUP_DIR" -name "*.db" -mtime +7 -delete

echo "Backup complete: $BACKUP_DIR"
