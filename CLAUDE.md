# CLAUDE.md — codeprism

> **For AI coding assistants and new contributors.** Read this before touching any code.

---

## Project Overview

**codeprism** is a shared memory layer for AI coding tools. It solves a fundamental problem: every AI session re-learns what your team already figured out yesterday, reading 15 files when 1 pre-digested card would do.

codeprism:
1. Parses your codebase with tree-sitter to extract classes, methods, routes, associations, and imports
2. Builds a directed dependency graph using graphology
3. Runs Louvain community detection to find natural feature clusters ("flows")
4. Generates compact knowledge cards (structural or LLM-enriched) per flow
5. Embeds cards with nomic-embed-text-v1.5 (768-d, in-process) and indexes them in SQLite (vec0 + FTS5)
6. Serves cards to any MCP-compatible AI tool (Cursor, Claude Code, Windsurf, Zed, Lovable) via 12 MCP tools
7. Learns from developer interactions — insights written back via `codeprism_save_insight` persist for the whole team

**Token savings:** One card ≈ 200 tokens vs. reading 15 files ≈ 4,500 tokens. Across a team of 5 doing 50 queries/day, that's ~$300–400/month saved.

**Deployment options:**
- `codeprism.dev` — hosted SaaS, first 100 teams up to 10 devs free
- Self-hosted via `docker compose up -d` — all options run the same engine

---

## Architecture

### Monorepo Structure

```
codeprism/
├── packages/
│   ├── engine/        @codeprism/engine  — core server (BUSL-1.1)
│   ├── dashboard/     @codeprism/dashboard — React SPA (MIT)
│   └── extension/     codeprism (VS Code) — git watcher sync client (MIT)
├── eval/              Python evaluation suite (RAGAS-based)
├── docs/              Documentation
├── deploy/            Production Docker + Caddy configs (Hetzner)
├── docker-compose.yml Dev/self-hosted compose file
└── package.json       pnpm workspace root
```

### How the Three Packages Relate

```
┌─────────────────────────────────────────────────────┐
│                 packages/engine                      │
│  Fastify server on :4000                             │
│  ├── Serves dashboard static files (SPA fallback)   │
│  ├── POST /api/sync  ← receives git change payloads │
│  ├── GET/POST /mcp/* ← MCP SSE endpoint for AI tools│
│  ├── GET /api/*      ← dashboard REST API           │
│  └── SQLite DB: cards, embeddings, graph, metrics   │
└──────────┬──────────────────────┬───────────────────┘
           │                      │
           │ static files         │ REST API
           ▼                      ▼
┌──────────────────┐   ┌──────────────────────────────┐
│packages/dashboard│   │    packages/extension         │
│React 19 SPA      │   │VS Code/Cursor extension       │
│Vite + Tailwind   │   │Watches .git/ for changes      │
│TanStack Table    │   │POST /api/sync on file save    │
│Tremor charts     │   │Commands: syncNow, reindex     │
└──────────────────┘   └──────────────────────────────┘
```

### Indexing Data Flow

```
Developer saves file
        │
        ▼
VS Code extension (debounce 2s)
        │  POST /api/sync  { repo, branch, diff, commitSha }
        ▼
engine/src/sync/receiver.ts
        │  extract changed files
        ▼
engine/src/indexer/tree-sitter.ts   ← parse: classes, methods, routes, imports
        │
        ▼
engine/src/indexer/graph-builder.ts ← build dependency graph (graphology)
        │  Louvain community detection
        ▼
engine/src/indexer/doc-generator.ts ← assign flows, tier cards by heat score
        │  (heat < 0.3 → structural markdown, ≥ 0.3 → LLM-enriched via Gemini/OpenAI/Anthropic)
        ▼
engine/src/embeddings/local-embedder.ts ← nomic-embed-text-v1.5, 768-d ONNX in-process
        │
        ▼
SQLite: cards table + cards_fts (FTS5) + card_embeddings (vec0)
        │
        ▼
MCP tools serve cards to AI tools on demand
```

### Search / Query Flow

```
AI tool calls codeprism_search("how does auth work")
        │
        ▼
engine/src/search/hybrid.ts
  ├── FTS5 BM25 keyword search  (cards_fts)
  ├── Vector cosine search      (card_embeddings via sqlite-vec)
  └── RRF fusion + cross-encoder reranking
        │  (cross-encoder/ms-marco-MiniLM-L-6-v2, in-process ONNX)
        ▼
Top-K cards returned as MCP tool result (~200 tokens each)
```

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | 22 |
| Language | TypeScript | latest |
| Web framework | Fastify | latest |
| Database | better-sqlite3 | latest |
| Vector search | sqlite-vec (vec0 extension) | latest |
| Full-text search | SQLite FTS5 | built-in |
| Code parsing | tree-sitter | latest |
| Parsers | tree-sitter-ruby, -javascript, -typescript, -vue | latest |
| Embeddings | @huggingface/transformers (ONNX, in-process) | latest |
| Graph | graphology + graphology-communities-louvain | ^0.26 / ^2.0 |
| MCP protocol | @modelcontextprotocol/sdk | latest |
| LLM providers | Gemini / OpenAI / Anthropic / DeepSeek | optional |
| Dashboard | React 19, Vite 6, Tailwind 3, TanStack Table, Tremor | see package.json |
| Extension | VS Code extension API, esbuild | vscode ^1.85 |
| Validation | Zod | ^4 |
| Test runner | Vitest | ^4 |
| Package manager | pnpm workspaces | — |

**Key native binaries** (compiled on install via `onlyBuiltDependencies`):
`better-sqlite3`, `tree-sitter-*`, `onnxruntime-node`, `esbuild`, `sharp`, `protobufjs`

---

## Development Commands

### Initial Setup

```bash
# Install all dependencies (runs native builds automatically)
pnpm install

# Build dashboard first (engine serves its dist/ at runtime)
pnpm build:dashboard

# Start engine in watch mode (dev)
pnpm dev
# → http://localhost:4000  (engine + dashboard)
# → http://localhost:4000/mcp/sse  (MCP SSE endpoint)
```

### Per-Package Commands

```bash
# Engine
pnpm --filter @codeprism/engine dev          # tsx watch (hot-reload)
pnpm --filter @codeprism/engine build        # tsc compile → dist/
pnpm --filter @codeprism/engine start        # node dist/index.js (production)
pnpm --filter @codeprism/engine test         # vitest run
pnpm --filter @codeprism/engine test:watch   # vitest watch
pnpm --filter @codeprism/engine test:coverage
pnpm --filter @codeprism/engine lint         # tsc --noEmit

# Dashboard
pnpm --filter @codeprism/dashboard dev       # vite dev server
pnpm --filter @codeprism/dashboard build     # tsc + vite build → dist/
pnpm --filter @codeprism/dashboard preview   # preview built SPA

# Extension
pnpm --filter codeprism build                # esbuild bundle
pnpm --filter codeprism watch                # esbuild watch
pnpm --filter codeprism package              # vsce package → .vsix
```

### Root-Level Shortcuts

```bash
pnpm dev              # alias: engine dev
pnpm dev:dashboard    # alias: dashboard dev
pnpm build            # dashboard build + engine build (correct order)
pnpm build:engine     # engine only
pnpm build:dashboard  # dashboard only
pnpm start            # engine start (production)
pnpm test             # engine vitest run
pnpm lint             # tsc --noEmit across all packages
pnpm ci               # pnpm build && pnpm test
```

### Indexing & CLI

```bash
# Index repos defined in codeprism.config.json
pnpm index

# CLI entrypoint (all subcommands)
pnpm codeprism --help

# Import AI conversation transcripts for insight extraction
pnpm codeprism import-transcripts

# Install git sync hook in a repo
curl -fsSL https://raw.githubusercontent.com/codeprism/codeprism/main/scripts/install-hook.sh \
  | sh -s -- --engine-url http://localhost:4000 --sync-now
```

### Docker (Self-Hosted)

```bash
docker compose up -d          # start engine on :4000
docker compose logs -f        # tail logs
docker compose down           # stop
```

---

## Key Concepts

### Knowledge Card
A compact, pre-digested summary of a feature cluster (flow). Stored in the `cards` table. Contains: title, markdown content, source files list, flow name, card type, heat score, and a 768-d embedding. One card ≈ 200 tokens.

**Card tiers by heat score (git commit frequency, 0–1):**
| Tier | Heat | Content |
|------|------|---------|
| Premium | > 0.6 | LLM-generated narrative, ~1,500 tokens |
| Standard | 0.3–0.6 | LLM-generated, ~800 tokens |
| Structural | < 0.3 | Markdown from parsed structure, no LLM call |

Without `GOOGLE_API_KEY` (or other LLM keys), all cards are structural. Structural cards still cover files, associations, routes, and cross-service edges.

### Flow
A named cluster of related files detected by Louvain community detection on the dependency graph. Each flow becomes one or more cards. `codeprism_list_flows` returns all flows with card counts and heat scores.

### Tenant
In multi-tenant mode (`CODEPRISM_MULTI_TENANT=true`), each team gets an isolated SQLite database at `data/tenants/<slug>.db`. Single-tenant (self-hosted) uses a single `codeprism.db`. Tenant routing is handled by `src/tenant/middleware.ts`.

### Hybrid Search
Combines BM25 (FTS5) keyword ranking and cosine vector similarity, fused with Reciprocal Rank Fusion (RRF), then reranked by a cross-encoder model (`ms-marco-MiniLM-L-6-v2`). Configured at runtime via `codeprism_configure`.

### Heat Score
Normalized git commit frequency over the last 180 days (0.0 = cold, 1.0 = hot). Stored on `file_index.heat_score`. Drives card tier selection — hot files get richer LLM cards.

### MCP (Model Context Protocol)
The transport layer connecting AI tools to codeprism. Engine exposes an SSE endpoint at `/mcp/sse`. AI tools register it as an MCP server and call the 12 tools on demand.

### Project Docs
LLM-generated per-repo documentation (README, architecture, code style, API contracts, etc.) stored in `project_docs`. Served by `codeprism_project_docs`. Written to disk under `/ai-codeprism/` in the repo.

### Conversation Intelligence
A two-pass LLM pipeline (`src/conversations/`) that imports AI chat transcripts (Cursor, Claude Code, markdown) and extracts structured insights (coding rules, anti-patterns, architectural decisions, domain knowledge, gotchas). Hallucination-protected by a verifier pass. Stored in `extracted_insights`.

### Team Rules
Org-level coding rules stored in `team_rules`. Checked against new code via `src/services/rules.ts`. Violations recorded in `rule_checks`.

### Branch-Aware Context
Engine tracks branch events (`branch_events` table). Cards can be scoped to specific branches (`valid_branches`). Cross-repo epic detection links context when 2+ repos share a branch name (ticket ID).

---

## Important Files

| File | Purpose |
|------|---------|
| `packages/engine/src/index.ts` | Fastify server entry point — all routes, startup sequence, graceful shutdown |
| `packages/engine/src/db/schema.ts` | Canonical SQLite schema + all TypeScript domain types |
| `packages/engine/src/db/migrations.ts` | Incremental schema migrations (versioned) |
| `packages/engine/src/db/connection.ts` | DB connection pool, multi-tenant DB routing |
| `packages/engine/src/mcp/server.ts` | MCP server creation + SSE route registration |
| `packages/engine/src/mcp/tools.ts` | All 12 MCP tool definitions (routing to tool handlers) |
| `packages/engine/src/mcp/tools/search.ts` | `codeprism_search`, `codeprism_context`, `codeprism_ticket_files` |
| `packages/engine/src/mcp/tools/knowledge.ts` | `codeprism_save_insight`, `codeprism_verify_card`, `codeprism_promote_insight` |
| `packages/engine/src/mcp/tools/operations.ts` | `codeprism_list_flows`, `codeprism_workspace_status`, `codeprism_project_docs`, `codeprism_recent_queries`, `codeprism_configure`, `codeprism_reindex` |
| `packages/engine/src/search/hybrid.ts` | Hybrid search: FTS5 + vec0 + RRF + cross-encoder reranking |
| `packages/engine/src/embeddings/local-embedder.ts` | nomic-embed-text-v1.5 via @huggingface/transformers (ONNX in-process) |
| `packages/engine/src/indexer/tree-sitter.ts` | Tree-sitter parsing for all supported languages |
| `packages/engine/src/indexer/graph-builder.ts` | Graphology dependency graph + Louvain community detection |
| `packages/engine/src/indexer/doc-generator.ts` | Card generation: heat-based tiering, LLM prompts, structural fallback |
| `packages/engine/src/indexer/git-signals.ts` | Git commit frequency → heat score calculation |
| `packages/engine/src/sync/receiver.ts` | Handles `POST /api/sync` — orchestrates parse → graph → card pipeline |
| `packages/engine/src/sync/branch-gc.ts` | Garbage-collects stale cards for deleted branches |
| `packages/engine/src/tenant/registry.ts` | Multi-tenant CRUD: create/list/delete tenants, API key rotation |
| `packages/engine/src/tenant/middleware.ts` | Per-request tenant DB selection from `X-API-Key` header |
| `packages/engine/src/services/auth.ts` | Magic-link auth, sessions (multi-tenant only) |
| `packages/engine/src/services/members.ts` | Team seat management, invitations |
| `packages/engine/src/skills/knowledge-loader.ts` | Framework skills loader (16 built-in skills) |
| `packages/engine/src/conversations/verifier.ts` | Hallucination protection for extracted insights |
| `packages/engine/src/config/workspace-config.ts` | Parses `codeprism.config.json` |
| `packages/engine/src/watcher/index.ts` | File system + git watcher (auto-sync without CLI) |
| `packages/engine/src/telemetry/reporter.ts` | Opt-in anonymous usage telemetry |
| `packages/dashboard/src/` | React 19 SPA — workspace management, analytics, card browser |
| `packages/extension/src/extension.ts` | VS Code extension: git watcher, debounced sync, status bar |
| `codeprism.config.json` | Workspace config: repo paths, exclude patterns (optional) |
| `.codeprismignore` | gitignore-style file exclusions |
| `docker-compose.yml` | Self-hosted single-container dev/prod setup |
| `deploy/docker-compose.prod.yml` | Production multi-container setup with Caddy reverse proxy |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CODEPRISM_PORT` | `4000` | HTTP server port |
| `CODEPRISM_HOST` | `0.0.0.0` | HTTP bind address |
| `CODEPRISM_DB_PATH` | `./codeprism.db` | Path to the main SQLite database |
| `CODEPRISM_WORKSPACE` | `process.cwd()` | Root dir scanned for `codeprism.config.json` and repos |
| `CODEPRISM_MULTI_TENANT` | `false` | Set to `true` for SaaS/hosted mode with per-team DBs |
| `CODEPRISM_DOMAIN` | — | Public domain (e.g. `codeprism.dev`); used for CORS in multi-tenant mode |
| `CODEPRISM_ADMIN_KEY` | — | Admin API key for tenant management endpoints |
| `CODEPRISM_COMPANY_NAME` | `""` | Seeded into `instance_profile` on first boot |
| `CODEPRISM_PLAN` | `self_hosted` | Instance plan (`self_hosted`, `cloud`, etc.) |
| `GOOGLE_API_KEY` | — | Gemini API key for LLM card enrichment (recommended: free tier sufficient) |
| `OPENAI_API_KEY` | — | OpenAI API key (alternative LLM provider) |
| `ANTHROPIC_API_KEY` | — | Anthropic API key (alternative LLM provider) |
| `DEEPSEEK_API_KEY` | — | DeepSeek API key (alternative LLM provider) |
| `SMTP_HOST` | — | SMTP server for magic-link and invitation emails |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASS` | — | SMTP password |
| `SMTP_FROM` | — | From address for outgoing emails |

**Note:** codeprism works with zero config. Only set env vars for customization or LLM enrichment.

---

## Database Schema

All tables live in SQLite. In multi-tenant mode, each tenant gets its own `.db` file at `data/tenants/<slug>.db`.

| Table | Purpose |
|-------|---------|
| `cards` | Primary knowledge store. One row per knowledge card. Has `flow`, `content` (markdown), `source_files` (JSON array), `heat_score`, `stale` flag, `usage_count`, `specificity_score`, `card_type`, `valid_branches`. |
| `cards_fts` | FTS5 virtual table mirroring `cards` for BM25 keyword search. Porter stemmer + unicode61. |
| `card_embeddings` | vec0 virtual table: `card_id TEXT`, `embedding FLOAT[768]`. Cosine vector search. |
| `card_title_embeddings` | vec0 virtual table for title-only embeddings (used for specificity ranking). |
| `file_index` | Parsed AST data per file+repo+branch. `parsed_data` JSON contains extracted symbols. `heat_score` (0.0–1.0) from git commit frequency. PK: `(path, repo, branch)`. |
| `graph_edges` | Dependency graph edges. `source_file → target_file` with `relation` (import/call/association) and `repo`. |
| `metrics` | Query telemetry: who asked what, which cards returned, token count, latency, cache hit. |
| `branch_events` | Git branch lifecycle events (checkout, merge, push). Used for branch-aware card scoping. |
| `card_interactions` | Per-card interaction log: `viewed` or `insight_saved`. Drives usage-based ranking. |
| `project_docs` | LLM-generated per-repo docs (readme, architecture, code_style, api_contracts, rules, etc.). One row per `(repo, doc_type)`. |
| `repo_profiles` | Auto-detected stack per repo: primary language, frameworks, skill_ids. |
| `repo_signals` | Curated signals for LLM card generation (framework-specific context). |
| `search_config` | Runtime-tunable search weights (FTS vs vector vs reranker). Key/value store. |
| `instance_profile` | Single-row instance metadata: company_name, plan, instance_id. |
| `transcript_imports` | Deduplicated AI chat transcript files. Keyed by content_hash. |
| `extracted_insights` | Structured insights from transcripts: category, statement, evidence_quote, confidence, trust_score. |
| `team_rules` | Org-level coding rules: name, description, severity, scope, enabled flag. |
| `rule_checks` | Per-sync rule violation results: violations JSON, files_checked, passed flag. |
| `eval_cases` | Evaluation ground truth: query → expected_card_id pairs. |
| `schema_version` | Migration version tracking. |

**Virtual tables** (`card_embeddings`, `card_title_embeddings`, `cards_fts`) are created outside transactions since SQLite doesn't allow virtual table creation inside a transaction block.

---

## MCP Tools

The engine exposes 12 tools at `/mcp/sse`. Configure in your AI tool:

```json
{
  "mcpServers": {
    "codeprism": {
      "url": "http://localhost:4000/mcp/sse"
    }
  }
}
```

| Tool | File | Purpose |
|------|------|---------|
| `codeprism_context` | `tools/search.ts` | **Call this first.** Full codebase context for a ticket/task description. Returns top cards + file list. |
| `codeprism_search` | `tools/search.ts` | Hybrid FTS + semantic search across all knowledge cards. Supports query, flow filter, repo filter. |
| `codeprism_ticket_files` | `tools/search.ts` | Files most likely to need edits for a given task. Cross-references branch name for ticket ID. |
| `codeprism_list_flows` | `tools/operations.ts` | List all detected flows with card counts, heat scores, and source repos. |
| `codeprism_save_insight` | `tools/knowledge.ts` | Write an architectural discovery back to the knowledge graph as a new card. |
| `codeprism_verify_card` | `tools/knowledge.ts` | Confirm a card is accurate. Increments `verification_count`, builds team confidence. |
| `codeprism_project_docs` | `tools/operations.ts` | Retrieve AI-generated documentation (architecture, code style, API contracts) for a repo. |
| `codeprism_workspace_status` | `tools/operations.ts` | Knowledge base health: stale cards, stack profiles, cross-repo edges, total card count. |
| `codeprism_recent_queries` | `tools/operations.ts` | See what context was previously retrieved in this session — avoid redundant calls. |
| `codeprism_configure` | `tools/operations.ts` | Tune search weights (FTS vs vector vs reranker) at runtime. Persisted in `search_config`. |
| `codeprism_reindex` | `tools/operations.ts` | Trigger incremental re-indexing for a repo or the full workspace. |
| `codeprism_promote_insight` | `tools/knowledge.ts` | Promote a conversation-extracted insight to a permanent project doc. |

**Recommended call order for a new task:**
1. `codeprism_context` — broad context for the ticket
2. `codeprism_ticket_files` — specific files to edit
3. `codeprism_search` — follow-up targeted queries
4. `codeprism_save_insight` — after discovering something non-obvious

---

## API Endpoints (Non-MCP)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/sync` | Receive git change payload from extension/hook |
| `GET` | `/api/health` | Health check: card count, flow count |
| `GET` | `/api/public-stats` | Aggregate anonymous stats |
| `GET` | `/api/founding-status` | Founding team availability (multi-tenant) |
| `POST` | `/api/tenants` | Create tenant (multi-tenant, rate-limited) |
| `GET` | `/api/tenants` | List tenants (admin) |
| `DELETE` | `/api/tenants/:slug` | Delete tenant + DB (admin) |
| `POST` | `/api/tenants/:slug/rotate-key` | Rotate API key |
| `POST` | `/api/auth/magic-link` | Send magic link email (multi-tenant) |
| `POST` | `/api/auth/verify` | Verify magic link token → session |
| `POST` | `/api/auth/logout` | Destroy session |
| `GET` | `/api/auth/me` | Current session info |
| `GET` | `/api/members` | List team members + seat count |
| `POST` | `/api/members/invite` | Invite members by email |
| `DELETE` | `/api/members/:userId` | Deactivate member |
| `POST` | `/api/benchmarks/submit` | Queue GitHub repo for benchmarking |
| `GET` | `/api/benchmarks/queue` | Benchmark queue status |
| `POST` | `/api/benchmarks/sandbox` | Live search against a benchmarked repo |
| `GET` | `/api/benchmarks/:slug` | Benchmark results for a project |
| `GET` | `/api/benchmarks` | All benchmark results |
| `POST` | `/api/telemetry` | Receive anonymous usage telemetry |
| `GET` | `/*` | Serve dashboard SPA (with SPA fallback to index.html) |

---

## Agent Dispatch Protocol

**For complex tasks, use the `agent-organizer` subagent to assemble a specialist team before writing any code.**

### When to Invoke agent-organizer

Invoke `agent-organizer` when the task spans multiple packages, requires cross-cutting architectural decisions, or involves more than 3 interconnected files. Examples:

- Adding a new MCP tool end-to-end (schema → service → MCP handler → dashboard UI)
- Designing a new indexer parser for a new language
- Migrating the search pipeline (changes to `hybrid.ts`, embeddings, reranker)
- Adding a new multi-tenant feature (middleware → registry → auth → dashboard)
- Implementing conversation intelligence improvements (extractor → verifier → dedup → UI)

### How to Dispatch

```
Use the agent-organizer subagent. Provide:
1. Task description (what needs to be built/changed)
2. Relevant packages (engine / dashboard / extension)
3. Known constraints (BUSL-1.1 for engine, no new native deps without justification)
4. Success criteria (tests, API shape, UI behavior)
```

### Specialist Agents Available

| Agent | Use For |
|-------|---------|
| `typescript-pro` | Engine TypeScript, type system, async patterns |
| `react-pro` | Dashboard React 19 components, TanStack Table, Tremor |
| `database-optimizer` | SQLite query optimization, schema changes, migrations |
| `python-pro` | eval/ Python evaluation suite |
| `security-auditor` | Auth flows, API key handling, multi-tenant isolation |
| `performance-engineer` | Embedding latency, search pipeline, cross-encoder cold-start |
| `documentation-expert` | docs/ updates, MCP tool reference |
| `test-automator` | Vitest test coverage for engine services |

### Single-Package Tasks — No Dispatch Needed

For focused, single-file changes (e.g., fixing a bug in one service, adding a field to an existing MCP tool, tweaking a dashboard component), work directly without invoking agent-organizer.

---

## Common Gotchas

1. **Dashboard must be built before the engine serves it.** In dev, run `pnpm build:dashboard` at least once. The engine serves `packages/dashboard/dist/` at the catch-all `/*` route.

2. **sqlite-vec native binary.** `card_embeddings` and `card_title_embeddings` vec0 tables fail silently if sqlite-vec isn't loaded. `initSchema` wraps the virtual table creation in a try/catch — FTS and regular tables still work. Always run `pnpm install` (not `npm install`) to ensure native builds.

3. **ONNX models download on first use.** `warmReranker()` is called at server startup to pre-load the cross-encoder. First cold start takes 10–30s while models download to the HuggingFace cache. Subsequent starts are fast.

4. **Multi-tenant mode is opt-in.** `CODEPRISM_MULTI_TENANT=true` enables tenant routing, auth routes, and per-slug DBs. Without it, the engine is single-tenant and needs no API key.

5. **Tree-sitter grammars are native.** Adding a new language parser requires a new `tree-sitter-<lang>` npm package in `pnpm.onlyBuiltDependencies` and a parser entry in `src/indexer/parser-registry.ts`.

6. **LLM card enrichment is optional.** Without any `*_API_KEY`, all cards are structural (no LLM calls). Structural cards are still useful — they map files, routes, associations, and cross-service edges from tree-sitter output alone.

7. **Branch GC runs at startup.** `runAllBranchGC` is called async after server start to purge cards scoped to deleted branches. It does not block startup.

8. **pnpm workspace** — always run commands from the repo root with `pnpm --filter <pkg>` or use the root shortcuts. Running `npm install` in a sub-package will break workspace linking.

---

## Contributing

- Engine (`packages/engine`) is **BUSL-1.1** — no commercial forks without a license.
- Dashboard + Extension are **MIT** — freely usable.
- All new engine features need Vitest unit tests in `src/__tests__/`.
- Run `pnpm ci` (build + test) before opening a PR.
- See `docs/contributing-skills.md` for adding framework skills.
- See `CONTRIBUTING.md` for the full PR process.
