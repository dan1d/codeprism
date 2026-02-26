# Configuration

codeprism works with zero configuration. Everything below is optional.

## `codeprism.config.json`

Place at your workspace root to explicitly configure which repos to index.

```json
{
  "repos": [
    { "path": "../my-backend", "name": "backend" },
    { "path": "../my-frontend", "name": "frontend" },
    { "path": "/absolute/path/to/another-repo" }
  ],
  "exclude": ["**/generated/**", "**/proto/**"],
  "workspaceRoot": ".."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `repos` | `Array<{ path, name? }>` | Explicit repo paths (absolute or relative to config file). `name` defaults to directory basename. |
| `exclude` | `string[]` | Glob patterns to exclude from indexing (additive with `.codeprismignore`). |
| `workspaceRoot` | `string` | Override the workspace root directory (resolved relative to config file). |

Without this file, codeprism auto-discovers repos by scanning sibling directories for `package.json`, `Gemfile`, `go.mod`, `pyproject.toml`, `Cargo.toml`, or `.git`.

## `.codeprismignore`

Gitignore-style file placed at the workspace root. Uses the same syntax as `.gitignore`.

Copy `.codeprismignore.example` as a starting point:

```bash
cp .codeprismignore.example .codeprismignore
```

Built-in defaults always apply (even without a `.codeprismignore` file):
- `node_modules`, `vendor`, `.git`, `dist`, `build`, `.next`, `tmp`, `venv`, `.venv`

Your patterns are additive on top of these defaults.

## Environment variables

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `CODEPRISM_PORT` | `4000` | HTTP port for the Fastify server |
| `CODEPRISM_HOST` | `0.0.0.0` | Bind address |
| `CODEPRISM_DB_PATH` | `./codeprism.db` | Path to the SQLite database file |
| `CODEPRISM_COMPANY_NAME` | `""` | Company name (shown in dashboard, seeded on first boot) |
| `CODEPRISM_PLAN` | `self_hosted` | Instance plan identifier |

### LLM providers

codeprism supports three LLM providers for card enrichment and doc generation. Set one:

| Variable | Description |
|----------|-------------|
| `GOOGLE_API_KEY` | Gemini API key. Free tier (15 RPM) is sufficient. **Recommended for self-hosted.** |
| `OPENAI_API_KEY` | OpenAI API key (GPT-4o-mini recommended) |
| `ANTHROPIC_API_KEY` | Anthropic API key (Claude 3 Haiku recommended) |

Without any key, all cards are structural-only (no LLM prose, but still useful).

### Embeddings

| Variable | Default | Description |
|----------|---------|-------------|
| `CODEPRISM_EMBEDDING_MODEL` | `nomic-ai/nomic-embed-text-v1.5` | HuggingFace model ID for embeddings |
| `CODEPRISM_EMBEDDING_DIM` | `768` | Embedding dimension (must match model) |

To use the smaller model: `CODEPRISM_EMBEDDING_MODEL=Xenova/all-MiniLM-L6-v2` and `CODEPRISM_EMBEDDING_DIM=384`.

## CLI options

### `pnpm codeprism index`

| Flag | Description |
|------|-------------|
| `--force` | Reindex everything regardless of git changes |
| `--repo <name>` | Restrict to a single repo |
| `--branch <name>` | Override git branch detection for all repos |
| `--ticket <id>` | Ticket ID or URL (e.g. `ENG-756`); biases file selection and prompts |
| `--ticket-desc <text>` | Short ticket description injected into LLM prompts |
| `--skip-docs` | Skip doc generation (faster, uses existing docs) |
| `--force-docs` | Force regeneration of all docs even if they exist |
| `--fetch-remote` | Run `git fetch --all` before branch signal collection |

### `pnpm codeprism import-transcripts`

| Flag | Description |
|------|-------------|
| `--dry-run` | Parse and extract but don't write to DB |
| `--force` | Re-extract from already-imported transcripts |

### `pnpm codeprism generate-skills`

| Flag | Description |
|------|-------------|
| `--skill <id>` | Generate only for a specific skill (e.g. `rails`, `react`) |
| `--force` | Overwrite existing knowledge files |

## Search config tuning

Search scoring parameters can be tuned at runtime via the `codeprism_configure` MCP tool or directly in the `search_config` SQLite table:

| Key | Default | Description |
|-----|---------|-------------|
| `max_hub_cards` | `2` | Maximum hub-type cards per result set (set 0 to suppress hubs) |
| `hyde_timeout_ms` | `1500` | Timeout for HyDE hypothetical document generation |

Example via MCP:
```
codeprism_configure({ action: "set", key: "max_hub_cards", value: "3" })
```

## Project docs

codeprism generates structured documentation for each repo before card generation. These docs provide LLM prompts with high-level business context:

| Doc type | Content |
|----------|---------|
| `readme` | Project overview, purpose, key features |
| `about` | Business domain, user types, core workflows |
| `architecture` | Service boundaries, data flow, infrastructure |
| `code_style` | Naming conventions, patterns, framework idioms |
| `rules` | Team coding rules, anti-patterns to avoid |
| `styles` | CSS/UI conventions (for frontend repos) |
| `api_contracts` | API endpoint signatures and payload shapes |
| `pages` | Frontend page inventory with routes and components |
| `memory` | Team memory doc (aggregated from dev insights) |

Docs are regenerated when source files change (staleness detection). Force with `--force-docs`.
