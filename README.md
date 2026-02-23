# srcmap

**Your AI already knows how to code. It just doesn't know YOUR code.**

srcmap is a code context engine that parses your codebase, builds a knowledge graph of cross-service flows, and serves that context to your AI coding tools (Cursor, Claude Code, Windsurf) via MCP.

- **Near-zero LLM cost** -- optional Gemini free tier enrichment; works fully without any API key.
- **Zero config** -- install the extension, point to your server, done.
- **Zero vendor lock-in** -- works with any MCP-compatible tool. Self-host with Docker.

## Quick start

### Self-hosted (Docker)

```bash
docker compose up -d
```

To enable LLM-enriched cards, set your API key in `docker-compose.yml`:

```yaml
environment:
  - SRCMAP_PORT=4000
  - SRCMAP_DB_PATH=/data/srcmap.db
  - GOOGLE_API_KEY=your-gemini-api-key   # optional, enables premium cards
```

Then add to your `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "srcmap": {
      "url": "http://localhost:4000/mcp"
    }
  }
}
```

### Cloud deploy

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/yourusername/srcmap)

## How it works

1. **Parses** your code with tree-sitter (Ruby, JS/TS, Vue)
2. **Builds** a dependency graph across all your repos
3. **Detects** cross-service flows (billing, auth, patient-device, etc.)
4. **Generates** knowledge cards from the structural analysis
5. **Serves** context to your AI via MCP when it asks questions
6. **Caches** similar queries so the same question is instant the second time
7. **Tracks** how much time and tokens you're saving

## What your AI gets

Without srcmap, your AI reads 10-15 files to understand a flow (~7,000 tokens).

With srcmap, your AI calls `srcmap_search("billing flow")` and gets a 200-token card that maps the entire flow across all your repos, including which branches it's valid in.

## Card quality tiers

srcmap generates knowledge cards at three quality levels, driven by git commit frequency (the "thermal map"). Files changed more often get richer cards.

| Tier | Heat score | What you get |
|------|-----------|--------------|
| **Premium** | > 0.6 | Full LLM-generated card (up to 1500 tokens) with architectural narrative |
| **Standard** | 0.3 -- 0.6 | LLM-generated card (up to 800 tokens) |
| **Structural** | < 0.3 | Markdown assembled from parsed structure -- no LLM call needed |

Without a `GOOGLE_API_KEY`, all cards are structural. Structural cards still map files, associations, routes, and cross-service edges -- they just lack the LLM-written prose that explains *why* things are connected.

Set `GOOGLE_API_KEY` to use Google Gemini's free tier (15 RPM, enough for most codebases). srcmap rate-limits itself to ~14 RPM automatically.

## Git-aware context

srcmap reads your git history to decide what matters. This is what separates it from plain RAG-over-files tools.

- **Thermal map**: commit frequency over the last 180 days is normalized to a 0--1 heat score per file. Hot files get premium LLM cards; cold files get structural-only cards.
- **Branch detection**: the current branch name is extracted per repo. Ticket IDs (e.g. `ENG-756`) are parsed from branch names and attached to context. When 2+ repos share the same branch name, srcmap identifies it as an "epic branch" and correlates context across repos.
- **Cross-repo branch correlation**: `buildWorkspaceBranchSignal` inspects all repos in parallel, classifying each branch as `base`, `environment`, or `feature`. Repos still on `main` while others are on a feature branch are flagged as "behind repos."
- **Stale directory filtering**: top-level directories with zero commits in the thermal window are deprioritized and excluded from LLM prompts, keeping cards focused on actively maintained code.

## Dashboard

The engine serves a built-in dashboard at the root URL (default `http://localhost:4000`). It provides:

- **Analytics** -- token savings, query volume, cache hit rates
- **Knowledge Base** -- browse and search all generated cards
- **Repositories** -- indexed repos and their sync status
- **Settings** -- instance configuration

The dashboard is a static SPA built from `packages/dashboard/` and served by the Fastify server. No separate process needed.

## Teaching srcmap

Your AI can write discoveries back to the knowledge graph using the `srcmap_save_insight` MCP tool. Good insights capture things that aren't obvious from code structure alone:

```
srcmap_save_insight({
  flow: "billing",
  title: "Billing uses a saga pattern across 3 services",
  content: "The billing flow spans backend (BillingOrder), Cuba (charge processing), and frontend (status polling). Failures at any stage trigger compensating transactions via Sidekiq retry.",
  files: ["app/services/billing/charge_service.rb", "app/jobs/billing_retry_job.rb"]
})
```

```
srcmap_save_insight({
  flow: "patient_devices",
  title: "Patient device sync requires MQTT broker",
  content: "Real-time device data flows through an MQTT broker before hitting the API. The DeviceSync service subscribes to topic 'devices/{id}/telemetry'. Without the broker running, sync silently fails.",
  files: ["app/services/device_sync_service.rb"]
})
```

```
srcmap_save_insight({
  flow: "conventions",
  title: "All API controllers inherit BaseApiController with JWT auth",
  content: "Every controller under Api::V1 inherits from BaseApiController, which enforces JWT authentication via before_action :authenticate_user!. Public endpoints must explicitly skip this filter.",
  files: ["app/controllers/api/v1/base_api_controller.rb"]
})
```

Saved insights are stored as `dev_insight` cards and appear in search results alongside auto-generated cards.

## Contributing framework knowledge

srcmap ships with framework-specific skills that improve card generation, search relevance, and file classification. Each skill has a knowledge file with curated best practices.

**Knowledge files** live in `packages/engine/src/skills/knowledge/` as `.md` files (one per framework). They contain architecture, code style, testing, performance, and security conventions. Currently supported: Rails, React, Vue, Next.js, Django, FastAPI, Laravel, NestJS, Go, Gin, Angular, Svelte, Spring, and more.

**To add a new framework:**

1. Create `packages/engine/src/skills/knowledge/<framework>.md` following the existing format (sections: Architecture, Code Style, Testing, Performance, Security)
2. Create `packages/engine/src/skills/<framework>.ts` exporting a `Skill` object with `id`, `searchTag`, `searchContextPrefix`, `cardPromptHints`, `classifierOverrides`, `bestPractices`, and `verificationHints`
3. Register it in `packages/engine/src/skills/registry.ts` by importing and adding to `ALL_SKILLS`

The `Skill` interface is defined in `packages/engine/src/skills/types.ts`.

## Tech stack

- TypeScript + Node.js 22
- SQLite + sqlite-vec (vector search) + FTS5 (text search)
- tree-sitter (code parsing)
- MCP SDK (AI tool integration)
- Local embeddings (all-MiniLM-L6-v2, runs in-process)
- Fastify (HTTP API)

## License

AGPL-3.0
