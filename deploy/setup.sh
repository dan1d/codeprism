#!/usr/bin/env bash
set -euo pipefail

# srcmap.ai VPS Setup Script
# Tested on: Ubuntu 24.04 (Hetzner CX23)
# Usage: curl -sSL https://raw.githubusercontent.com/.../setup.sh | bash

echo "=== srcmap.ai VPS setup ==="

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
APP_DIR=/opt/srcmap
mkdir -p "$APP_DIR"

# 5. Clone or update repo
if [ -d "$APP_DIR/repo" ]; then
  echo "Updating srcmap..."
  cd "$APP_DIR/repo" && git pull
else
  echo "Cloning srcmap..."
  git clone https://github.com/yourusername/srcmap.git "$APP_DIR/repo"
fi

# 6. Create .env if not exists
ENV_FILE="$APP_DIR/repo/deploy/.env"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<'ENVEOF'
# srcmap.ai configuration
SRCMAP_DOMAIN=srcmap.ai
SRCMAP_MULTI_TENANT=true
SRCMAP_COMPANY_NAME=srcmap
GOOGLE_API_KEY=
# SRCMAP_TELEMETRY=true
# CF_API_TOKEN=  # Only needed for wildcard SSL with Cloudflare DNS
ENVEOF
  echo "Created $ENV_FILE -- edit it with your domain and API keys"
fi

# 7. Build and start
cd "$APP_DIR/repo/deploy"
docker compose -f docker-compose.prod.yml --env-file .env up -d --build

echo ""
echo "=== srcmap.ai is running ==="
echo "Dashboard: https://$(grep SRCMAP_DOMAIN .env | cut -d= -f2)"
echo "MCP endpoint: https://$(grep SRCMAP_DOMAIN .env | cut -d= -f2)/mcp"
echo ""
echo "Next steps:"
echo "  1. Point your domain's A record to this server's IP"
echo "  2. Edit $ENV_FILE with your domain and API keys"
echo "  3. Run: cd $APP_DIR/repo/deploy && docker compose -f docker-compose.prod.yml --env-file .env up -d"
