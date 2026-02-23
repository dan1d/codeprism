# srcmap

**Your AI already knows how to code. It just doesn't know YOUR code.**

srcmap is a code context engine that parses your codebase, builds a knowledge graph of cross-service flows, and serves pre-digested context to your AI coding tools (Cursor, Claude Code, Windsurf) via [MCP](https://modelcontextprotocol.io/).

Instead of your AI reading 10-15 files to understand a flow (~7,000 tokens), it calls `srcmap_search("billing flow")` and gets a 200-token card mapping the entire flow across all your repos.

- **Near-zero LLM cost** -- optional Gemini free tier enrichment; works fully without any API key
- **Zero config** -- point to your server, done
- **Zero vendor lock-in** -- works with any MCP-compatible tool; self-host with Docker
- **Fully local** -- embeddings, cross-encoder reranking, and vector search all run in-process

## Quick start

### 1. Run the server

```bash
docker compose up -d
```

The engine starts on port 4000 with a built-in dashboard at `http://localhost:4000`.

### 2. Connect your AI tool

Add to `.cursor/mcp.json` (Cursor), `claude_desktop_config.json` (Claude Code), or equivalent:

```json
{
  "mcpServers": {
    "srcmap": {
      "url": "http://localhost:4000/mcp"
    }
  }
}
```

### 3. Index your code

```bash
pnpm srcmap index
```

That's it. Your AI now has access to 12 MCP tools that serve codebase context on demand.

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

1. **Parse** -- tree-sitter extracts classes, methods, routes, associations, and imports from Ruby, JS/TS, Vue, Python, and Go files
2. **Graph** -- graphology builds a directed dependency graph; edges represent imports, API calls, and model associations
3. **Detect flows** -- Louvain community detection + PageRank finds natural feature clusters; frontend nav labels name them
4. **Generate cards** -- each flow becomes a knowledge card (structural markdown or LLM-enriched prose)
5. **Embed & index** -- nomic-embed-text-v1.5 (768-d, in-process) + sqlite-vec for vector search, FTS5 for keyword search
6. **Serve via MCP** -- hybrid search (RRF fusion + cross-encoder reranking) serves context to any MCP-compatible AI tool
7. **Learn** -- your AI writes discoveries back via `srcmap_save_insight`, and srcmap extracts team knowledge from conversation transcripts

## MCP tools

Your AI gets 12 tools via MCP. The most important ones:

| Tool | What it does |
|------|-------------|
| `srcmap_context` | Get full codebase context for a ticket/task. Call this first. |
| `srcmap_search` | Hybrid FTS + semantic search across all knowledge cards |
| `srcmap_ticket_files` | Files most likely to need edits for a given task |
| `srcmap_list_flows` | List all detected flows with card counts and heat scores |
| `srcmap_save_insight` | Write architectural discoveries back to the knowledge graph |
| `srcmap_verify_card` | Confirm a card is accurate (builds confidence over time) |
| `srcmap_project_docs` | Retrieve AI-generated project documentation per repo |
| `srcmap_workspace_status` | Knowledge base health: stale cards, stack profiles, cross-repo edges |

See [docs/mcp-tools.md](docs/mcp-tools.md) for the full reference with parameters and examples.

## Key features

### Git-aware context

srcmap reads your git history to decide what matters. This is what separates it from plain RAG-over-files tools.

- **Thermal map** -- commit frequency over the last 180 days normalized to a 0-1 heat score per file. Hot files get richer cards.
- **Branch detection** -- extracts ticket IDs from branch names (e.g. `ENG-756`), classifies branches as `base`/`environment`/`feature`, and correlates across repos.
- **Cross-repo epic detection** -- when 2+ repos share the same branch name, srcmap identifies it as an epic and maps context across all participating repos.
- **Stale directory filtering** -- directories with zero recent commits are deprioritized from LLM prompts.

### Card quality tiers

Knowledge cards are generated at three quality levels driven by git thermal heat:

| Tier | Heat | What you get |
|------|------|-------------|
| Premium | > 0.6 | Full LLM-generated card with architectural narrative (1500 tokens) |
| Standard | 0.3 - 0.6 | LLM-generated card (800 tokens) |
| Structural | < 0.3 | Markdown assembled from parsed structure -- no LLM call needed |

Without a `GOOGLE_API_KEY`, all cards are structural. Structural cards still map files, associations, routes, and cross-service edges -- they just lack LLM-written prose.

### Conversation intelligence

srcmap can extract team knowledge from your AI conversation transcripts (Cursor, Claude Code):

```bash
pnpm srcmap import-transcripts
```

A two-pass LLM pipeline gates each transcript ("does this contain explicit corrections or stated preferences?"), then extracts structured insights with hallucination protection (evidence quotes must appear verbatim in the transcript). See [docs/conversation-intelligence.md](docs/conversation-intelligence.md).

### Search pipeline

Queries go through a multi-stage pipeline: HyDE (hypothetical document embeddings) for long queries, hybrid FTS + semantic retrieval, graph-neighbour expansion, cross-encoder reranking, and repo-affinity scoring. See [docs/architecture.md](docs/architecture.md) for the full breakdown.

### Framework skills

srcmap ships with 16 framework-specific skills that improve card generation, search relevance, and file classification:

Rails, React, Vue, Next.js, Django, Django REST, FastAPI, Go, Gin, Laravel, NestJS, Angular, Svelte, Spring, Lambda, Python

Each skill includes curated best practices, classifier overrides, and search context prefixes. See [docs/contributing-skills.md](docs/contributing-skills.md) to add your own.

## Configuration

srcmap works with zero config. For customization:

- **`srcmap.config.json`** -- explicit repo paths, workspace root override, exclude patterns. See [docs/configuration.md](docs/configuration.md).
- **`.srcmapignore`** -- gitignore-style file exclusion. Copy `.srcmapignore.example` as a starting point.
- **Environment variables** -- `GOOGLE_API_KEY`, `SRCMAP_PORT`, `SRCMAP_DB_PATH`, `SRCMAP_EMBEDDING_MODEL`, and more. See [docs/configuration.md](docs/configuration.md).

## Dashboard

The engine serves a built-in dashboard at `http://localhost:4000`:

- **Analytics** -- token savings, query volume, cache hit rates
- **Knowledge Base** -- browse and search all generated cards
- **Repositories** -- indexed repos, stack profiles, sync status
- **Settings** -- search config tuning, instance profile

The dashboard is a React SPA built from `packages/dashboard/` and served by the Fastify server. No separate process needed.

## Deployment

```bash
# Docker (recommended)
docker compose up -d

# Cloud
# Deploy to Render with one click:
```
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/yourusername/srcmap)

See [docs/deployment.md](docs/deployment.md) for production configuration, persistent storage, and cloud options.

## Evaluation

srcmap includes an evaluation suite with deterministic and LLM-judged (Ragas) metrics:

```bash
cd eval
python evaluate.py           # deterministic (free)
python evaluate.py --ragas   # + context precision/recall (needs Gemini key)
python generate_dataset.py   # auto-generate golden dataset from your indexed data
```

See [docs/evaluation.md](docs/evaluation.md) for details.

## Tech stack

- **Runtime**: TypeScript, Node.js 22, Fastify
- **Database**: SQLite + sqlite-vec (vector search) + FTS5 (full-text search)
- **Parsing**: tree-sitter (Ruby, JS/TS, Vue)
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
  docker-compose.yml
  Dockerfile
```

## Documentation

| Doc | Description |
|-----|-------------|
| [Architecture](docs/architecture.md) | Search pipeline, indexing flow, graph construction |
| [Configuration](docs/configuration.md) | All config files, env vars, and tuning options |
| [MCP Tools](docs/mcp-tools.md) | Full reference for all 12 MCP tools |
| [Deployment](docs/deployment.md) | Docker, Render, production setup |
| [Contributing Skills](docs/contributing-skills.md) | How to add framework-specific skills |
| [Conversation Intelligence](docs/conversation-intelligence.md) | Transcript import and insight extraction |
| [Evaluation](docs/evaluation.md) | Running and extending the eval suite |

## License

AGPL-3.0
