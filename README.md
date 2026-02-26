# codeprism

**Cut AI coding costs by 90%. Without changing how you work.**

codeprism is a shared context layer for AI coding tools. It indexes your codebase into a knowledge graph and serves pre-digested context cards to Cursor, Claude Code, Windsurf, or any MCP-compatible tool — instead of dumping raw files.

**200 tokens instead of 4,500. Same answer. A fraction of the cost.**

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%203.0-blue.svg)](LICENSE)
[![Cloud](https://img.shields.io/badge/cloud-codeprism.dev-58a6ff)](https://codeprism.dev)
[![Self-host](https://img.shields.io/badge/self--host-docker%20compose%20up-3fb950)](https://codeprism.dev/docs/deployment)

---

## The problem

Five developers, each paying for their own AI tool, all working on the same codebase. Every new session re-learns what a teammate already figured out yesterday. Your AI reads 15 files to understand a flow it already read last week.

codeprism fixes this. One shared knowledge graph. Every AI tool on your team benefits instantly.

```
Without codeprism   AI reads 15 files ≈ 4,500 tokens  💸
With codeprism      AI reads 1 card   ≈   200 tokens  ✅
```

---

## Quick start

### Cloud (recommended)

No infrastructure. Get started in 60 seconds:

→ **[codeprism.dev](https://codeprism.dev)** — first 100 teams free, unlimited developers

### Self-hosted

```bash
# 1. Start the server
docker compose up -d

# 2. Index your code
pnpm codeprism index

# 3. Add to your AI tool (.cursor/mcp.json or claude_desktop_config.json)
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
 *.rb *.ts *.vue     │ tree-sitter │  parse
 ───────────────────>│   parsers   │──────┐
                     └─────────────┘      │
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

1. **Parse** — tree-sitter extracts classes, methods, routes, associations, and imports from Ruby, JS/TS, Vue, Python, and Go
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

## Cloud vs Self-hosted

|  | **Cloud** | **Self-hosted** |
|--|-----------|-----------------|
| **Setup** | [One-click at codeprism.dev](https://codeprism.dev) | `docker compose up -d` |
| **Infrastructure** | We handle it | Your server |
| **Data** | Hosted, tenant-isolated | Stays on your machine |
| **Team features** | Invitations, analytics, seat tracking | Single user |
| **Price** | First 100 teams free | Free forever (AGPL-3.0) |
| **Best for** | Teams of 2–20 | Solo devs, air-gapped envs |

Both run the same engine. The Cloud version adds multi-tenancy, team management, and a hosted dashboard.

---

## Key features

### Token savings
Cards are pre-structured summaries of your codebase flows. Instead of an AI reading 15 files (~4,500 tokens), it reads one card (~200 tokens). Across a team of 5 doing 50 queries/day, that's **$300–$400/month saved** depending on your LLM.

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
16 built-in skills improve card generation and search relevance:

Rails · React · Vue · Next.js · Django · FastAPI · Go · Gin · Laravel · NestJS · Angular · Svelte · Spring · Lambda · Python · Django REST

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
- **Parsing**: tree-sitter (Ruby, JS/TS, Vue, Python, Go)
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
- **`.codeprismi gnore`** — gitignore-style file exclusion.
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

## Self-hosting in production

```bash
# On a fresh Ubuntu 24.04 VPS (Hetzner CPX21 recommended, ~$10/mo)
git clone https://github.com/dan1d/codeprism /opt/codeprism
cd /opt/codeprism/deploy

# Create your .env
cp .env.example .env
# Edit .env with your domain, admin key, and Resend API key

# Start
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

Caddy handles HTTPS automatically. See [docs/deployment.md](docs/deployment.md) for the full production guide.

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

AGPL-3.0 — free to self-host forever. See [LICENSE](LICENSE).
