# srcmap

**Your AI already knows how to code. It just doesn't know YOUR code.**

srcmap is a shared context layer for AI coding tools. It parses your codebase, builds a knowledge graph of cross-service flows, and serves pre-digested context to Cursor, Claude Code, Windsurf, or any MCP-compatible tool.

**Ask once, everyone benefits.** When one developer discovers how the billing flow works, that knowledge is available to every AI tool on the team -- instantly, at zero token cost.

## The problem

Five developers, each paying for their own AI tool, all working on the same multi-repo codebase. Every time someone starts a new session, their AI spends the first few minutes re-learning what the billing service does, how the frontend talks to the backend, which models have which associations -- things a teammate already asked about yesterday in a different tool.

srcmap fixes this. It builds a persistent knowledge graph of your codebase and serves it via MCP. Instead of your AI reading 10-15 files to understand a flow (~7,000 tokens), it calls `srcmap_search("billing flow")` and gets a 200-token card mapping the entire flow.

- **Shared across tools** -- works with Cursor, Claude Code, Windsurf, and any MCP-compatible AI
- **Team knowledge compounds** -- insights saved by one developer are available to everyone
- **Near-zero query cost** -- after indexing, serving a cached card is a SQLite read, no LLM call
- **Fully local** -- embeddings, cross-encoder reranking, and vector search all run in-process
- **Zero vendor lock-in** -- self-host with Docker, or use srcmap Cloud

## Quick start

```bash
# 1. Run the server
docker compose up -d

# 2. Index your code
pnpm srcmap index

# 3. Connect your AI tool
```

Add to `.cursor/mcp.json`, `claude_desktop_config.json`, or equivalent:

```json
{
  "mcpServers": {
    "srcmap": {
      "url": "http://localhost:4000/mcp/sse"
    }
  }
}
```

That's it. Your AI now has access to 12 MCP tools that serve codebase context on demand.

## srcmap OSS vs srcmap Cloud

|  | **OSS (self-hosted)** | **Cloud** |
|--|----------------------|-----------|
| **Setup** | `docker compose up -d` | One-click at [codeprism.dev) |
| **Infrastructure** | Your server | We handle it |
| **Data** | Stays on your machine | Hosted, tenant-isolated |
| **Team features** | Single user | Invitations, seat tracking, per-dev analytics |
| **Price** | Free forever | First 100 teams free (unlimited devs) |
| **Best for** | Solo devs, air-gapped envs | Teams of 2-20 who don't want to run infra |

Both run the same engine. The Cloud version adds multi-tenancy, team management, and a managed dashboard.

## How it works

```
Your repos         srcmap engine                 Your AI
───────────        ──────────────                ───────
                   ┌─────────────┐
  *.rb *.ts *.vue  │ tree-sitter │  parse
  ────────────────>│   parsers   │──────┐
                   └─────────────┘      │
                                        v
                   ┌─────────────┐  ┌──────────┐
                   │  Louvain    │  │ dep graph │
                   │  community  │<─│ (grapho-  │
                   │  detection  │  │  logy)    │
                   └──────┬──────┘  └──────────┘
                          │ flows
                          v
                   ┌─────────────┐
                   │  LLM card   │  optional
                   │  generator  │  (Gemini free tier)
                   └──────┬──────┘
                          │ knowledge cards
                          v
                   ┌─────────────┐     MCP
                   │   SQLite    │────────────> srcmap_search()
                   │  + vec0     │────────────> srcmap_context()
                   │  + FTS5     │────────────> srcmap_ticket_files()
                   └─────────────┘             ...9 more tools
```

1. **Parse** -- tree-sitter extracts classes, methods, routes, associations, and imports from Ruby, JS/TS, Vue, Python, and Go
2. **Graph** -- graphology builds a directed dependency graph; edges represent imports, API calls, and model associations
3. **Detect flows** -- Louvain community detection + PageRank finds natural feature clusters across repos
4. **Generate cards** -- each flow becomes a knowledge card (structural markdown or LLM-enriched prose)
5. **Embed & index** -- nomic-embed-text-v1.5 (768-d, in-process) + sqlite-vec for vector search, FTS5 for keyword search
6. **Serve via MCP** -- hybrid search (RRF fusion + cross-encoder reranking) serves context to any MCP-compatible AI tool
7. **Learn** -- developers write discoveries back via `srcmap_save_insight`; conversation transcripts are mined for team knowledge

## MCP tools

| Tool | What it does |
|------|-------------|
| `srcmap_context` | Get full codebase context for a ticket/task -- call this first |
| `srcmap_search` | Hybrid FTS + semantic search across all knowledge cards |
| `srcmap_ticket_files` | Files most likely to need edits for a given task |
| `srcmap_list_flows` | List all detected flows with card counts and heat scores |
| `srcmap_save_insight` | Write architectural discoveries back to the knowledge graph |
| `srcmap_verify_card` | Confirm a card is accurate (builds confidence over time) |
| `srcmap_project_docs` | Retrieve AI-generated project documentation per repo |
| `srcmap_workspace_status` | Knowledge base health: stale cards, stack profiles, cross-repo edges |
| `srcmap_recent_queries` | See what context was previously retrieved (avoid re-asking) |
| `srcmap_configure` | Tune search weights at runtime |
| `srcmap_reindex` | Trigger incremental re-indexing |
| `srcmap_promote_insight` | Promote conversation insights to permanent project docs |

See [docs/mcp-tools.md](docs/mcp-tools.md) for the full reference with parameters and examples.

## Key features

### Git-aware context

- **Thermal map** -- commit frequency over the last 180 days normalized to a 0-1 heat score. Hot files get richer cards.
- **Branch detection** -- extracts ticket IDs from branch names, classifies branches, and correlates across repos.
- **Cross-repo epic detection** -- when 2+ repos share the same branch name, srcmap maps context across all of them.

### Card quality tiers

| Tier | Heat | What you get |
|------|------|-------------|
| Premium | > 0.6 | Full LLM-generated card with architectural narrative (1500 tokens) |
| Standard | 0.3 - 0.6 | LLM-generated card (800 tokens) |
| Structural | < 0.3 | Markdown assembled from parsed structure -- no LLM call needed |

Without a `GOOGLE_API_KEY`, all cards are structural. Structural cards still map files, associations, routes, and cross-service edges.

### Conversation intelligence

Extract team knowledge from AI conversation transcripts:

```bash
pnpm srcmap import-transcripts
```

A two-pass LLM pipeline gates each transcript, then extracts structured insights with hallucination protection. See [docs/conversation-intelligence.md](docs/conversation-intelligence.md).

### Framework skills

16 built-in skills improve card generation, search relevance, and file classification:

Rails, React, Vue, Next.js, Django, Django REST, FastAPI, Go, Gin, Laravel, NestJS, Angular, Svelte, Spring, Lambda, Python

See [docs/contributing-skills.md](docs/contributing-skills.md) to add your own.

## Configuration

srcmap works with zero config. For customization:

- **`srcmap.config.json`** -- repo paths, workspace root, exclude patterns. See [docs/configuration.md](docs/configuration.md).
- **`.srcmapignore`** -- gitignore-style file exclusion.
- **Environment variables** -- `GOOGLE_API_KEY`, `CODEPRISM_PORT`, `CODEPRISM_DB_PATH`, and more. See [docs/configuration.md](docs/configuration.md).

## Deployment

```bash
# Docker (recommended)
docker compose up -d

# Production (Hetzner/VPS)
cd deploy && bash setup.sh
```

See [docs/deployment.md](docs/deployment.md) for production configuration, HTTPS setup, and cloud options.

## Tech stack

- **Runtime**: TypeScript, Node.js 22, Fastify
- **Database**: SQLite + sqlite-vec (vector search) + FTS5 (full-text search)
- **Parsing**: tree-sitter (Ruby, JS/TS, Vue, Python, Go)
- **Embeddings**: nomic-embed-text-v1.5 (768-d, in-process via Transformers.js)
- **Reranking**: cross-encoder/ms-marco-MiniLM-L-6-v2 (in-process)
- **Graph**: graphology (Louvain community detection, PageRank)
- **AI integration**: MCP SDK (SSE transport)
- **LLM providers**: Gemini, OpenAI, Anthropic (optional, for card enrichment)

## Project structure

```
srcmap/
  packages/
    engine/         Core: indexer, search, MCP server, CLI
    dashboard/      React SPA served by the engine
    extension/      Cursor extension (git watcher, sync client)
  eval/             Evaluation suite (Python)
  docs/             Documentation
  deploy/           Production deployment (Docker, Caddy, Hetzner)
```

## Documentation

| Doc | Description |
|-----|-------------|
| [Architecture](docs/architecture.md) | Search pipeline, indexing flow, graph construction |
| [Configuration](docs/configuration.md) | All config files, env vars, and tuning options |
| [MCP Tools](docs/mcp-tools.md) | Full reference for all 12 MCP tools |
| [Deployment](docs/deployment.md) | Docker, Render, production setup |
| [Teams](docs/teams.md) | Workspace creation, inviting developers, seat management |
| [Contributing Skills](docs/contributing-skills.md) | How to add framework-specific skills |
| [Conversation Intelligence](docs/conversation-intelligence.md) | Transcript import and insight extraction |
| [Evaluation](docs/evaluation.md) | Running and extending the eval suite |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, PR process, and how to add framework skills.

## Support

- GitHub Issues: [github.com/srcmap/srcmap/issues](https://github.com/srcmap/srcmap/issues)
- Email: danielfromarg@gmail.com

## License

AGPL-3.0
