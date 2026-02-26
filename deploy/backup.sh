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

# We do NOT require sqlite3 on the host. Instead, we create consistent snapshots
# inside the running container using SQLite's online backup via "VACUUM INTO",
# then copy those snapshot files out to BACKUP_DIR.

CONTAINER_DATA="/data"
cd "$SCRIPT_DIR"

CONTAINER_TMP="/tmp/codeprism-backup-$TIMESTAMP-$$"
trap 'docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE_NAME" sh -c "rm -rf '\'''"$CONTAINER_TMP"''\''" >/dev/null 2>&1 || true' EXIT

docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE_NAME" sh -c "mkdir -p '$CONTAINER_TMP'"

DB_LIST="$(
  docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE_NAME" sh -c "find '$CONTAINER_DATA' -type f -name '*.db' -print" \
  | tr -d '\r'
)"

if [ -z "$DB_LIST" ]; then
  echo "No .db files found under $CONTAINER_DATA"
  exit 0
fi

while IFS= read -r dbPath; do
  [ -n "$dbPath" ] || continue

  # Make a stable filename that preserves the original path structure.
  safeName="${dbPath#/}"           # drop leading /
  safeName="${safeName//\//__}"    # replace / with __
  outPath="$CONTAINER_TMP/${safeName}.db"

  echo " - snapshot $dbPath"
  docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE_NAME" node -e '
    const Database = require("better-sqlite3");
    const dbPath = process.argv[1];
    const outPath = process.argv[2];
    const db = new Database(dbPath);
    try {
      // Ensure WAL contents are included in the snapshot.
      db.pragma("wal_checkpoint(FULL)");
      const escaped = outPath.replaceAll("'"'"'", "'"'"''"'"'");
      db.exec(`VACUUM INTO '\''${escaped}'\''`);
    } finally {
      db.close();
    }
  ' "$dbPath" "$outPath"

  docker compose -f "$COMPOSE_FILE" cp \
    "$SERVICE_NAME:$outPath" "$BACKUP_DIR/${safeName}-${TIMESTAMP}.db"
done <<<"$DB_LIST"

# Keep last 7 days of backups
find "$BACKUP_DIR" -name "*.db" -mtime +7 -delete

echo "Backup complete: $BACKUP_DIR"
