# Architecture

codeprism's pipeline has four stages: **parse**, **graph + detect**, **generate**, and **search + serve**.

## 1. Parsing

Tree-sitter extracts structured data from source files:

- **Ruby**: classes, methods, module inclusions, ActiveRecord associations (`has_many`, `belongs_to`), route definitions, Pundit policies
- **JavaScript/TypeScript**: classes, functions, imports/exports, React components, API call sites
- **Vue**: SFC components, `<script setup>` bindings, template refs
- **Python**: classes, functions, decorators, imports
- **Go**: structs, functions, interfaces, imports

Each parsed file produces a `ParsedFile` with:
- `path`, `repo`, `language`
- `classes[]` with methods, associations, inheritance
- `imports[]` and `exports[]`
- `routes[]` (for controllers/routers)
- `role` -- classified as `domain`, `test`, `config`, `entry_point`, or `shared_utility`

File classification uses framework-specific skill overrides (e.g., Rails treats `app/services/**` as domain, `spec/**` as test).

## 2. Graph construction

The dependency graph is built with [graphology](https://graphology.github.io/):

**Nodes**: every parsed file.

**Edges** (relation types):
- `import` -- file A imports from file B
- `association` -- ActiveRecord model A references model B (via `has_many`, `belongs_to`, etc.)
- `api_endpoint` -- frontend component calls a backend API endpoint
- `inheritance` -- class A extends class B
- `mixin` -- class A includes module B

The graph is stored in the `graph_edges` table for persistent querying and neighbour expansion during search.

### Flow detection

Community detection finds natural feature clusters:

1. **Seed flows** -- `route-extractor.ts` walks frontend component directories and matches them against nav/sidebar labels to discover page-level flows. Backend files are matched by snake_case name convention.

2. **Louvain communities** -- the undirected projection of the dependency graph is clustered using the Louvain algorithm (resolution tuned to find medium-sized communities). Communities smaller than 3 files are merged with their nearest neighbour.

3. **PageRank** -- identifies hub files (top 10% by PageRank score). Hubs like `ApplicationController` or `router/index.ts` appear in many flows but aren't specific to any single one. They get `hub` cards with a scoring penalty.

4. **Flow naming** -- each community is named by finding the most specific non-generic path segment among its files (excluding names like `common`, `utils`, `api`, `v1`). Standard CRUD action names are also excluded.

## 3. Card generation

Each flow becomes one or more knowledge cards. Card quality is tiered by git thermal heat:

| Tier | Heat | Token budget | LLM call? |
|------|------|-------------|-----------|
| Premium | > 0.6 | 1500 | Yes |
| Standard | 0.3-0.6 | 800 | Yes |
| Structural | < 0.3 | -- | No |

**Card types:**
- `flow` -- describes a feature flow (files, responsibilities, data flow)
- `model` -- describes a domain model with associations and business rules
- `cross_service` -- maps a flow that spans multiple repos
- `hub` -- describes a shared/utility file that many flows depend on
- `dev_insight` -- manually saved by developers via `codeprism_save_insight`
- `conv_insight` -- extracted from conversation transcripts

LLM prompts include:
- The flow's file list with parsed structure
- Project docs (About, Architecture, Code Style) for business context
- Framework-specific best practices from the active skill
- Git branch diff context when on a feature branch

Rate limiting is built in (~14 RPM) to stay within Gemini free tier.

## 4. Search pipeline

When your AI calls `codeprism_search("billing flow")`, the query goes through:

```
Query
  │
  ├─ HyDE (long queries only)
  │   LLM generates hypothetical card → used as semantic query
  │
  ├─ Embedding classification
  │   Query embedding compared against per-repo centroids
  │   → repo-affinity signal (which repo is this query about?)
  │
  ├─ Parallel retrieval
  │   ├─ Semantic: nomic-embed-text-v1.5 → sqlite-vec cosine search
  │   └─ Keyword: FTS5 with porter stemming
  │
  ├─ Reciprocal Rank Fusion (RRF)
  │   Σ 1/(60 + rank_i) across both lists
  │   + card-type boost (hubs penalized at 0.4x)
  │   + usage-count logarithmic boost
  │   + specificity score boost
  │   + blended repo-affinity multiplier (60% text signals, 40% embedding)
  │
  ├─ Graph neighbour expansion
  │   Top-5 results' source files → find cards sharing files via graph edges
  │   Added at 0.3 base score for reranker consideration
  │
  ├─ Cross-encoder reranking
  │   ms-marco-MiniLM-L-6-v2 scores (query, card) pairs
  │   Reorders candidates by neural relevance
  │
  ├─ Hub cap (default 2)
  │   At most 2 hub-type cards per result set
  │
  └─ Result
      Cards with flow, title, content, source files, confidence indicator
```

### Semantic cache

Before running the full pipeline, codeprism checks the `metrics` table for a recent query whose embedding has cosine similarity > 0.92. If found, the same cards are returned instantly (cache hit). This means repeated or paraphrased questions are near-free.

## Database schema

All data lives in a single SQLite file (`codeprism.db`):

| Table | Purpose |
|-------|---------|
| `cards` | Knowledge cards with content, flow, type, source files, staleness |
| `card_embeddings` | 768-d vectors (sqlite-vec virtual table) |
| `cards_fts` | FTS5 full-text index over title, content, flow, tags, identifiers |
| `file_index` | Parsed file data, repo, branch, commit SHA, heat score |
| `graph_edges` | Dependency graph edges with relation type and metadata |
| `project_docs` | AI-generated project documentation per repo |
| `repo_profiles` | Detected stack profile per repo (language, frameworks, skills) |
| `metrics` | Every MCP tool call with query, response, latency, cache hit |
| `card_interactions` | Card view events grouped by session |
| `branch_events` | Git branch switches and commits |
| `search_config` | Tunable search scoring parameters |
| `extracted_insights` | Insights extracted from conversation transcripts |
| `instance_profile` | Company name, plan, instance metadata |

Migrations are auto-applied on startup (`db/migrations.ts`).

## Embedding model

Default: [nomic-embed-text-v1.5](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5) (768 dimensions).

Uses Matryoshka Representation Learning with task-type prefixes:
- Documents: `"search_document: "` + content
- Queries: `"search_query: "` + query

The model (~300 MB) is downloaded to `~/.cache/codeprism/models/` on first use.

Fallback: set `CODEPRISM_EMBEDDING_MODEL=Xenova/all-MiniLM-L6-v2` and `CODEPRISM_EMBEDDING_DIM=384` for a smaller model.

## Cross-encoder reranker

[ms-marco-MiniLM-L-6-v2](https://huggingface.co/cross-encoder/ms-marco-MiniLM-L-6-v2) scores each (query, card) pair for neural relevance. Loaded lazily on first query, warmed eagerly on server start. Runs entirely in-process via Transformers.js.

## Git signals

A single `git log` pass per repo extracts:

- **Thermal map** -- commit counts per file over the last 180 days, normalized to 0-1. Drives card quality tiering and file ordering in LLM prompts.
- **Stale directories** -- top-level dirs with zero commits in the thermal window. Excluded from LLM prompts.
- **Branch context** -- current branch, base branch detection, commits ahead, changed files, ticket ID extraction.
- **Workspace branch signal** -- cross-repo branch correlation, epic detection, behind-repo identification.
