# Deployment

## Docker (recommended)

```bash
docker compose up -d
```

The `docker-compose.yml` starts a single container exposing port 4000 with a persistent volume for the database.

### With LLM enrichment

```yaml
services:
  srcmap:
    build: .
    ports:
      - "${SRCMAP_PORT:-4000}:4000"
    volumes:
      - srcmap-data:/data
    environment:
      - SRCMAP_PORT=4000
      - SRCMAP_DB_PATH=/data/srcmap.db
      - GOOGLE_API_KEY=your-gemini-api-key  # optional, enables premium cards
    restart: unless-stopped

volumes:
  srcmap-data:
```

### Docker build details

The Dockerfile uses a multi-stage build:

1. **deps** -- installs native dependencies (python3, make, g++ for tree-sitter/better-sqlite3) and runs `pnpm install`
2. **build** -- compiles the engine (TypeScript) and dashboard (Vite)
3. **runtime** -- copies only the compiled output + node_modules; no dev dependencies or source

The final image runs `node packages/engine/dist/index.js` which:
- Starts the Fastify HTTP server on port 4000
- Serves the dashboard SPA at `/`
- Exposes the MCP endpoint at `/mcp/sse`
- Auto-runs database migrations on startup
- Pre-warms the cross-encoder reranker model

### Persistent storage

The database (`srcmap.db`) must persist across container restarts. The Docker volume `srcmap-data` is mounted at `/data`.

Embedding models (~300 MB) are cached inside the container at `~/.cache/srcmap/models/`. To persist across rebuilds, add a second volume:

```yaml
volumes:
  - srcmap-data:/data
  - srcmap-models:/root/.cache/srcmap/models
```

## Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/yourusername/srcmap)

The `render.yaml` configures:
- Web service with Docker runtime
- 1 GB persistent disk at `/data`
- Starter plan

After deploying, set `GOOGLE_API_KEY` in the Render dashboard environment variables if you want LLM-enriched cards.

Update your MCP config to point at the Render URL:

```json
{
  "mcpServers": {
    "srcmap": {
      "url": "https://your-srcmap.onrender.com/mcp"
    }
  }
}
```

## Local development

```bash
# Install dependencies
pnpm install

# Start the engine in watch mode
pnpm dev

# In a separate terminal, start the dashboard dev server (optional)
pnpm dev:dashboard

# Index your repos
pnpm srcmap index
```

### Build from source

```bash
pnpm build          # builds both engine and dashboard
pnpm start          # runs the compiled engine
```

## Indexing your codebase

After the server is running, index your code:

```bash
# Auto-discover repos in sibling directories
pnpm srcmap index

# Or index a specific repo
pnpm srcmap index --repo my-backend

# Force full reindex (ignores git change detection)
pnpm srcmap index --force

# Skip doc generation for faster indexing
pnpm srcmap index --skip-docs
```

The first index downloads the embedding model (~300 MB) and reranker model. Subsequent runs are incremental (only changed files).

## System requirements

- **Node.js 22+** (required for Transformers.js ONNX runtime)
- **~1 GB RAM** for models (embedding + reranker loaded in-process)
- **~500 MB disk** for model cache (one-time download)
- **SQLite** (bundled via better-sqlite3, no external database needed)

## Health check

```bash
curl http://localhost:4000/api/health
```

Returns:
```json
{
  "status": "ok",
  "cards": 142,
  "flows": 23
}
```

## Connecting AI tools

### Cursor

Add to `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "srcmap": {
      "url": "http://localhost:4000/mcp"
    }
  }
}
```

### Claude Code

Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "srcmap": {
      "url": "http://localhost:4000/mcp"
    }
  }
}
```

### Windsurf

Add to your MCP configuration following Windsurf's documentation, pointing at `http://localhost:4000/mcp`.

### Any MCP-compatible tool

srcmap uses the standard MCP SSE transport. Any tool that supports `GET /mcp/sse` + `POST /mcp/messages` will work.
