#!/usr/bin/env bash
set -euo pipefail

# codeprism.dev VPS Setup Script
# Tested on: Ubuntu 24.04 (Hetzner CX23)
#
# Set CODEPRISM_REPO_URL before running:
#   export CODEPRISM_REPO_URL=https://github.com/YOUR_ORG/codeprism.git
#   curl -sSL https://raw.githubusercontent.com/.../setup.sh | bash

CODEPRISM_REPO_URL="${CODEPRISM_REPO_URL:?Error: set CODEPRISM_REPO_URL to your codeprism git repository URL}"
APP_DIR="${APP_DIR:-/opt/codeprism}"
REPO_DIR="${REPO_DIR:-$APP_DIR/repo}"

echo "=== codeprism.dev VPS setup ==="

# 1. Install Docker (official method)
if ! command -v docker &>/dev/null; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
fi

# 2. Install Docker Compose plugin (if not bundled)
if ! docker compose version &>/dev/null; then
  echo "Installing Docker Compose..."
  apt-get update && apt-get install -y docker-compose-plugin
fi

# 3. Configure firewall (UFW)
echo "Configuring firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw allow 443/udp   # HTTP/3 (QUIC)
ufw --force enable

# 4. Create app directory
mkdir -p "$APP_DIR"

# 5. Clone or update repo
# Support both layouts:
# - /opt/codeprism/repo (default)
# - /root/codeprism (repo directly in APP_DIR)
if [ -d "$APP_DIR/.git" ]; then
  REPO_DIR="$APP_DIR"
fi

mkdir -p "$(dirname -- "$REPO_DIR")"

if [ -d "$REPO_DIR/.git" ]; then
  echo "Updating codeprism..."
  cd "$REPO_DIR" && git pull --ff-only
else
  echo "Cloning codeprism..."
  git clone "$CODEPRISM_REPO_URL" "$REPO_DIR"
fi

# 6. Create .env if not exists
ENV_FILE="$REPO_DIR/deploy/.env"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<'ENVEOF'
# codeprism.dev configuration
CODEPRISM_DOMAIN=codeprism.dev
CODEPRISM_MULTI_TENANT=true
CODEPRISM_COMPANY_NAME=codeprism
GOOGLE_API_KEY=
# CODEPRISM_TELEMETRY=true
# CF_API_TOKEN=  # Only needed for wildcard SSL with Cloudflare DNS
ENVEOF
  echo "Created $ENV_FILE -- edit it with your domain and API keys"
fi

# 7. Build and start
cd "$REPO_DIR"
chmod +x ./deploy/update.sh ./deploy/backup.sh
./deploy/update.sh --build

echo ""
echo "=== codeprism.dev is running ==="
echo "Dashboard: https://$(grep CODEPRISM_DOMAIN ./deploy/.env | cut -d= -f2)"
echo "MCP endpoint: https://$(grep CODEPRISM_DOMAIN ./deploy/.env | cut -d= -f2)/mcp"
echo ""
echo "Next steps:"
echo "  1. Point your domain's A record to this server's IP"
echo "  2. Edit $ENV_FILE with your domain and API keys"
echo "  3. Run: cd $REPO_DIR && ./deploy/update.sh --build"
