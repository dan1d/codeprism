# Deploying codeprism.dev

## Quick start (Hetzner CPX21 / CX23, ~$5–10/mo)

1. Create a Hetzner CPX21 or CX23 server (Ubuntu 24.04)
2. Point your domain's A record to the server IP
3. SSH in and run:

```bash
curl -sSL https://raw.githubusercontent.com/dan1d/codeprism/main/deploy/setup.sh | bash
```

### What the script does automatically

- **Installs Docker** and the Docker Compose plugin (if not already present)
- **Installs git** (needed to clone the repo)
- **Creates a 4 GB swap file** (prevents OOM kills during benchmark indexing on low-RAM servers)
- **Configures UFW firewall** (allows SSH, HTTP, HTTPS only)
- **Clones the codeprism repo** to `/opt/codeprism/repo`
- **Interactively prompts** for:
  - Your domain (e.g. `codeprism.example.com`)
  - LLM provider (`gemini`, `anthropic`, `openai`, or `deepseek`)
  - API key for the selected provider (input is hidden)
- **Auto-generates `CODEPRISM_ADMIN_KEY`** (64-char hex via `openssl rand`)
- **Writes a complete `.env` file** with all four LLM key slots and your admin key
- **Builds and starts** the stack via `docker compose`

After the script finishes you'll see the dashboard URL and MCP endpoint.

### Updating

```bash
cd /opt/codeprism/repo && ./deploy/update.sh --build
```

If you keep the repo in home (e.g. `/root/codeprism`), use:
- `.env`: `/root/codeprism/deploy/.env`
- update: `cd /root/codeprism && ./deploy/update.sh --build`

## Manual setup

```bash
git clone https://github.com/dan1d/codeprism.git /opt/codeprism/repo
cd /opt/codeprism/repo/deploy
cp .env.example .env
# Edit .env: set CODEPRISM_DOMAIN, CODEPRISM_ADMIN_KEY, and at least one LLM key
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `CODEPRISM_DOMAIN` | Yes | Your domain (e.g. `codeprism.example.com`) |
| `CODEPRISM_ADMIN_KEY` | Yes | Admin secret for tenant management. Generate: `openssl rand -hex 32` |
| `CODEPRISM_MULTI_TENANT` | No | Set `true` for SaaS / multi-team mode (default: `false`) |
| `GOOGLE_API_KEY` | One of four | Google Gemini API key |
| `ANTHROPIC_API_KEY` | One of four | Anthropic (Claude) API key |
| `OPENAI_API_KEY` | One of four | OpenAI API key |
| `DEEPSEEK_API_KEY` | One of four | DeepSeek API key |
| `CF_API_TOKEN` | No | Cloudflare API token (only for wildcard subdomain SSL) |

At least one LLM API key is required for LLM-enriched knowledge cards.

## Backups

Add to crontab for daily 3am backups:

```bash
crontab -e
# Add: 0 3 * * * /opt/codeprism/repo/deploy/backup.sh
```

## Monitoring

```bash
# Check health
curl https://yourdomain.com/api/health

# View logs
docker compose -f docker-compose.prod.yml logs -f

# Check disk usage
du -sh /var/lib/docker/volumes/deploy_codeprism-data/
```

## Scaling

The CPX21 (4GB RAM) handles ~10-30 tenants. To upgrade:
- CX23 ($3.49/mo, 4GB RAM) — ~10-30 tenants
- CX33 ($5.39/mo, 8GB RAM) — ~50 tenants
- CX43 ($8.49/mo, 16GB RAM) — 100+ tenants

Hetzner supports live server resizing with no data loss.
