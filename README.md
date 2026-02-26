# codeprism

**Your AI forgets what your team learned yesterday. codeprism fixes that.**

codeprism is a shared memory layer for AI coding tools. It builds a knowledge graph from your codebase and serves compact, verifiable context cards to Cursor, Claude Code, Windsurf, Lovable, Zed, or any MCP-compatible tool — instead of dumping raw files.

[![License: BUSL-1.1](https://img.shields.io/badge/License-BUSL%201.1-blue.svg)](LICENSE)
[![Cloud](https://img.shields.io/badge/cloud-codeprism.dev-58a6ff)](https://codeprism.dev)
[![Self-host](https://img.shields.io/badge/self--host-docker%20compose%20up-3fb950)](https://codeprism.dev/docs/deployment)

---

## The problem

Five developers, each paying for their own AI tool, all working on the same codebase. Every new session re-learns what a teammate already figured out yesterday. Your AI reads 15 files to understand a flow it already read last week.

codeprism fixes this. One shared knowledge graph. Every AI tool on your team benefits instantly.

```
Without codeprism   AI reads 15 files ≈ 4,500 tokens  💸
With codeprism      AI reads 1 card   ≈   350 tokens  ✅
```

---

## Quick start

### Cloud (recommended)

No infrastructure. Get started in 60 seconds:

→ **[codeprism.dev](https://codeprism.dev)** — first 100 teams get up to 10 developers free, no credit card

### Self-hosted (5 minutes)

```bash
# 1. Start the server
docker compose up -d
```

Open the dashboard at `http://localhost:4000`, create a workspace, and copy the MCP config shown in onboarding.

Then, in each repo you want indexed, install git hooks and run an initial sync:

```bash
curl -fsSL https://raw.githubusercontent.com/codeprism/codeprism/main/scripts/install-hook.sh \
  | sh -s -- --engine-url http://localhost:4000 --sync-now
```

**Connect your AI tool** — add to your config file:

| Tool | Config file |
|------|------------|
| Cursor | `.cursor/mcp.json` |
| Claude Code | `~/.claude/claude_desktop_config.json` |
| Windsurf | `.windsurf/mcp_config.json` |
| Zed | `~/.config/zed/settings.json` |
| Lovable | Project settings → MCP |

```json
{
  "mcpServers": {
    "codeprism": {
      "url": "http://localhost:4000/mcp/sse"
    }
  }
}
```

That's it. Your AI now has 12 MCP tools that serve codebase context on demand.

---

## How it works

```
Your repos           codeprism engine              Your AI
──────────           ────────────────              ───────
                     ┌─────────────┐
 *.rb  *.ts  *.js    │ tree-sitter │  parse
 *.py  *.go  *.php   │   parsers   │──────┐
 *.vue *.svelte ───> └─────────────┘      │
                                          v
                     ┌─────────────┐  ┌──────────┐
                     │  Louvain    │  │ dep graph │
                     │  community  │<─│(graphology│
                     │  detection  │  │          )│
                     └──────┬──────┘  └──────────┘
                            │ flows
                            v
                     ┌─────────────┐
                     │  LLM card   │  optional
                     │  generator  │  (Gemini free tier)
                     └──────┬──────┘
                            │ knowledge cards
                            v
                     ┌─────────────┐      MCP
                     │   SQLite    │──────────────> codeprism_search()
                     │  + vec0     │──────────────> codeprism_context()
                     │  + FTS5     │──────────────> codeprism_ticket_files()
                     └─────────────┘               ...9 more tools
```

1. **Parse** — tree-sitter extracts classes, methods, routes, associations, and imports from Ruby, JS/TS, Vue, Python, Go, and PHP
2. **Graph** — graphology builds a directed dependency graph; edges represent imports, API calls, and model associations
3. **Detect flows** — Louvain community detection + PageRank finds natural feature clusters across repos
4. **Generate cards** — each flow becomes a knowledge card (structural markdown or LLM-enriched prose)
5. **Embed & index** — nomic-embed-text-v1.5 (768-d, in-process) + sqlite-vec for vector search, FTS5 for keyword search
6. **Serve via MCP** — hybrid search (RRF fusion + cross-encoder reranking) returns the right context in milliseconds
7. **Learn** — developers write discoveries back via `codeprism_save_insight`; conversation transcripts are mined for team knowledge

---

## MCP tools

| Tool | What it does |
|------|-------------|
| `codeprism_context` | Full codebase context for a ticket/task — call this first |
| `codeprism_search` | Hybrid FTS + semantic search across all knowledge cards |
| `codeprism_ticket_files` | Files most likely to need edits for a given task |
| `codeprism_list_flows` | List all detected flows with card counts and heat scores |
| `codeprism_save_insight` | Write architectural discoveries back to the knowledge graph |
| `codeprism_verify_card` | Confirm a card is accurate (builds confidence over time) |
| `codeprism_project_docs` | Retrieve AI-generated project documentation per repo |
| `codeprism_workspace_status` | Knowledge base health: stale cards, stack profiles, cross-repo edges |
| `codeprism_recent_queries` | See what context was previously retrieved (avoid re-asking) |
| `codeprism_configure` | Tune search weights at runtime |
| `codeprism_reindex` | Trigger incremental re-indexing |
| `codeprism_promote_insight` | Promote conversation insights to permanent project docs |

See [docs/mcp-tools.md](docs/mcp-tools.md) for full reference with parameters and examples.

---

## Deployment options

|  | **codeprism.dev** | **VPS / PaaS** | **Local** |
|--|-------------------|----------------|-----------|
| **Setup** | [One-click signup](https://codeprism.dev) | `docker compose up -d` | `docker compose up -d` |
| **Infrastructure** | We manage it | Your Hetzner / DO / Render | Your laptop |
| **Data** | Hosted, tenant-isolated per team | On your server, shared across team | On your machine |
| **Team features** | Invitations, analytics, seat tracking | Shared URL — all devs point to same instance | Single user |
| **LLM key** | Optional (set once in dashboard) | Set in `.env`, shared by all | Set in `.env` |
| **Price** | First 100 teams: up to 10 devs free | VPS cost only (~$10/mo Hetzner) | Free forever |
| **Best for** | Teams who don't want to run infra | Teams who want data on their own server | Solo devs |

All three options run the same engine. Pick what fits your team.

### One-click deploy to a VPS or PaaS

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/dan1d/codeprism)
[![Deploy to DigitalOcean](https://www.deploytodo.com/do-btn-blue.svg)](https://cloud.digitalocean.com/apps/new?repo=https://github.com/dan1d/codeprism/tree/main)

**Hetzner (recommended — best value):**
```bash
# On a fresh Ubuntu 24.04 CPX21 (~$10/mo)
git clone https://github.com/dan1d/codeprism /opt/codeprism
cd /opt/codeprism/deploy && cp .env.example .env
# Edit .env: set CODEPRISM_DOMAIN, CODEPRISM_ADMIN_KEY, LLM keys
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

Once running, every team member points their AI tool to the **same server URL**:
```json
{
  "mcpServers": {
    "codeprism": {
      "url": "https://your-server-ip:4000/mcp/sse"
    }
  }
}
```

---

## Key features

### Token savings
Cards are pre-structured summaries of your codebase flows. Instead of an AI reading 15 files (~4,500 tokens), it reads one card (~350 tokens). Across a team of 5 doing 50 queries/day, that's **$300–$400/month saved** depending on your LLM.

→ [Calculate your savings at codeprism.dev](https://codeprism.dev#calculator)

### Git-aware context
- **Thermal map** — commit frequency over 180 days normalized to a 0–1 heat score. Hot files get richer cards.
- **Branch detection** — extracts ticket IDs from branch names and correlates context across repos.
- **Cross-repo epic detection** — when 2+ repos share the same branch, codeprism maps context across all of them.

### Card quality tiers

| Tier | Heat | What you get |
|------|------|-------------|
| Premium | > 0.6 | LLM-generated card with architectural narrative (1,500 tokens) |
| Standard | 0.3–0.6 | LLM-generated card (800 tokens) |
| Structural | < 0.3 | Markdown from parsed structure — no LLM call needed |

Without `GOOGLE_API_KEY`, all cards are structural. Structural cards still map files, associations, routes, and cross-service edges.

### Conversation intelligence
Extract team knowledge from AI conversation transcripts:

```bash
pnpm codeprism import-transcripts
```

A two-pass LLM pipeline extracts structured insights with hallucination protection. See [docs/conversation-intelligence.md](docs/conversation-intelligence.md).

### Framework support
18 built-in skills improve card generation and search relevance:

Rails · Sinatra · React · Vue · Next.js · Django · Django REST · FastAPI · Go · Gin · Laravel · NestJS · Angular · Svelte · Spring · Lambda · Python · PHP

---

## Benchmarks

Tested on real open-source projects — Caddy, Huginn, Excalidraw, Gogs, Lobsters, and more.

| Project | Language | Token reduction | Flow accuracy |
|---------|----------|----------------|---------------|
| Excalidraw | TypeScript | 96% | 100% |
| Sinatra | Ruby | 97% | 100% |
| Express | Node.js | 91% | 100% |
| Koa | Node.js | 92% | 100% |

→ [View full benchmarks at codeprism.dev/benchmarks](https://codeprism.dev/benchmarks)

---

## Tech stack

- **Runtime**: TypeScript, Node.js 22, Fastify
- **Database**: SQLite + sqlite-vec (vector search) + FTS5 (full-text search)
- **Parsing**: tree-sitter (Ruby, JS/TS, Vue, Python, Go, PHP)
- **Embeddings**: nomic-embed-text-v1.5 (768-d, in-process via Transformers.js)
- **Reranking**: cross-encoder/ms-marco-MiniLM-L-6-v2 (in-process)
- **Graph**: graphology (Louvain community detection, PageRank)
- **AI integration**: MCP SDK (SSE transport)
- **LLM providers**: Gemini, OpenAI, Anthropic, DeepSeek (optional, for card enrichment)

---

## Project structure

```
codeprism/
  packages/
    engine/       Core: indexer, search, MCP server, CLI
    dashboard/    React SPA served by the engine
    extension/    Cursor extension (git watcher, sync client)
  eval/           Evaluation suite (Python)
  docs/           Documentation
  deploy/         Production deployment (Docker, Caddy, Hetzner)
```

---

## Configuration

codeprism works with zero config. For customization:

- **`codeprism.config.json`** — repo paths, workspace root, exclude patterns. See [docs/configuration.md](docs/configuration.md).
- **`.codeprismignore`** — gitignore-style file exclusion.
- **Environment variables** — `GOOGLE_API_KEY`, `CODEPRISM_PORT`, `CODEPRISM_DB_PATH`, and more. See [docs/configuration.md](docs/configuration.md).

---

## Documentation

| Doc | Description |
|-----|-------------|
| [Architecture](docs/architecture.md) | Search pipeline, indexing flow, graph construction |
| [Configuration](docs/configuration.md) | All config files, env vars, and tuning options |
| [MCP Tools](docs/mcp-tools.md) | Full reference for all 12 MCP tools |
| [Deployment](docs/deployment.md) | Docker, Hetzner, production setup |
| [Teams](docs/teams.md) | Workspace creation, inviting developers, seat management |
| [Contributing Skills](docs/contributing-skills.md) | How to add framework-specific skills |
| [Conversation Intelligence](docs/conversation-intelligence.md) | Transcript import and insight extraction |
| [Evaluation](docs/evaluation.md) | Running and extending the eval suite |

---

## Roadmap

See [docs/roadmap.md](docs/roadmap.md) for the full plan.

- **Q1 2026**: API Contracts 2.0 — structured OpenAPI/Swagger ingestion + “contract confidence” when specs disagree with code.
- **Q2 2026**: Index request specs + serializers to infer real request/response shapes (as evidence; code remains the source of truth).
- **Q3 2026**: Stronger “do not do” Team Rules packs + clearer wording and better edge-case handling in checks.
- **Q4 2026**: Service-object pattern detection and flow hygiene improvements across monorepos and versioned APIs.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, PR process, and how to add framework skills.

---

## Support

- **Hosted version**: [codeprism.dev](https://codeprism.dev)
- **GitHub Issues**: [github.com/dan1d/codeprism/issues](https://github.com/dan1d/codeprism/issues)
- **Email**: [support@codeprism.dev](mailto:support@codeprism.dev)

---

## License

This repository is **multi-licensed**. See [`LICENSES.md`](LICENSES.md).

- **Engine**: `BUSL-1.1` (Business Source License 1.1). See [`LICENSE`](LICENSE).
- **Dashboard + Extension**: `MIT`. See `packages/*/LICENSE`.
