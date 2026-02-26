# Contributing to srcmap

Thanks for considering contributing to srcmap. This guide covers the development setup, how to submit changes, and how to add framework skills.

## Development setup

```bash
# Clone and install
git clone https://github.com/dan1d/codeprism.git
cd srcmap
pnpm install

# Start the engine in dev mode (hot-reload)
pnpm dev

# In a second terminal, start the dashboard
pnpm dev:dashboard
```

The engine runs on `http://localhost:4000`. The dashboard dev server proxies API requests to it.

### Prerequisites

- Node.js 22+
- pnpm 9+
- A codebase to index (point `srcmap.config.json` at your repos)

### Running tests

```bash
pnpm test                    # run all tests
pnpm test -- --watch         # watch mode
pnpm test -- path/to/test    # run specific test
```

Tests use in-memory SQLite databases. No external services needed.

### Building

```bash
pnpm build          # build both engine and dashboard
pnpm build:engine   # engine only
pnpm build:dashboard # dashboard only
```

## Submitting changes

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes
4. Run `pnpm test` and ensure all tests pass
5. Submit a pull request

### PR guidelines

- Keep changes focused -- one feature or fix per PR
- Add tests for new service-layer functions
- Match the existing code style (the project uses Biome for formatting)
- Update documentation if your change affects user-facing behavior

## Adding framework skills

srcmap ships with 16 framework skills. Adding a new one is one of the easiest ways to contribute.

Each skill is a JSON file in `packages/engine/src/skills/definitions/` with this structure:

```json
{
  "id": "my-framework",
  "name": "My Framework",
  "language": "javascript",
  "patterns": ["**/my-framework.config.*"],
  "context_prefix": "This project uses My Framework...",
  "classifier_overrides": {
    "patterns": {
      "**/*.widget.ts": "widget"
    }
  },
  "best_practices": [
    "Use the widget pattern for reusable UI components"
  ]
}
```

See [docs/contributing-skills.md](docs/contributing-skills.md) for the full reference, including how to test skill detection and card generation.

## Project structure

```
packages/
  engine/          Core: indexer, search, MCP server, CLI, services
  dashboard/       React SPA (Tremor, Tailwind, dark GitHub theme)
  extension/       Cursor extension (git watcher)
eval/              Python evaluation suite
docs/              Documentation
deploy/            Production deployment configs
```

### Key directories in the engine

- `src/services/` -- Business logic (testable, uses `getDb()`)
- `src/mcp/tools/` -- MCP tool handlers (thin wrappers around services)
- `src/metrics/` -- Dashboard API routes
- `src/search/` -- Hybrid search pipeline
- `src/indexer/` -- Code parsing and card generation
- `src/__tests__/` -- Test files mirroring the source structure

## Code of conduct

Be respectful, constructive, and helpful. We're building tools that make developers more productive -- let's extend that spirit to how we collaborate.

## Questions?

Open a GitHub issue or email support@codeprism.dev.
