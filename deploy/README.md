# Deploying codeprism.dev

## Quick start (Hetzner CX23, $3.49/mo)

1. Create a Hetzner CX23 server (Ubuntu 24.04)
2. Point your domain's A record to the server IP
3. SSH in and run:

```bash
curl -sSL https://raw.githubusercontent.com/codeprism/codeprism/main/deploy/setup.sh | bash
```

4. Edit `/opt/codeprism/repo/deploy/.env` with your domain
5. Restart: `cd /opt/codeprism/repo/deploy && docker compose -f docker-compose.prod.yml --env-file .env up -d`

## Manual setup

```bash
cp .env.example .env
# Edit .env with your values
docker compose -f docker-compose.prod.yml --env-file .env up -d
```

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

The CX23 (4GB RAM) handles ~10-30 tenants. To upgrade:
- CX33 ($5.39/mo, 8GB RAM) -- ~50 tenants
- CX43 ($8.49/mo, 16GB RAM) -- 100+ tenants

Hetzner supports live server resizing with no data loss.
