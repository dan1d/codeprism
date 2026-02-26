#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

COMPOSE_FILE="${COMPOSE_FILE:-$SCRIPT_DIR/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/.env}"

MODE="${MODE:-build}" # build | pull
NO_BACKUP="false"

usage() {
  cat <<'EOF'
Usage: deploy/update.sh [--build|--pull] [--no-backup]

Safe update script (preserves Docker volumes/DB).

Examples:
  ./deploy/update.sh --build
  ./deploy/update.sh --pull
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --build) MODE="build"; shift ;;
    --pull) MODE="pull"; shift ;;
    --no-backup) NO_BACKUP="true"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Missing compose file: $COMPOSE_FILE" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE" >&2
  echo "Create it: cp '$SCRIPT_DIR/.env.example' '$ENV_FILE' && edit values" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose plugin not found" >&2
  exit 1
fi

cd "$SCRIPT_DIR"

if command -v flock >/dev/null 2>&1; then
  exec 9>/var/lock/codeprism-deploy.lock
  flock -n 9 || { echo "Another deploy is running; aborting." >&2; exit 1; }
fi

echo "Validating compose config..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" config -q

if [ "$NO_BACKUP" != "true" ]; then
  echo "Creating backup..."
  COMPOSE_FILE="$COMPOSE_FILE" ENV_FILE="$ENV_FILE" "$SCRIPT_DIR/backup.sh" || {
    echo "Backup failed; aborting update." >&2
    exit 1
  }
fi

if [ "$MODE" = "pull" ]; then
  echo "Pulling updated image..."
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" pull codeprism
  echo "Restarting services (no build)..."
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --no-build codeprism caddy
elif [ "$MODE" = "build" ]; then
  echo "Building from source..."
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build codeprism caddy
  echo "Restarting services..."
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d codeprism caddy
else
  echo "Unknown MODE: $MODE" >&2
  exit 2
fi

echo "Pruning old images..."
docker image prune -f >/dev/null 2>&1 || true

echo "✅ Update complete"
