# srcmap

**Your AI already knows how to code. It just doesn't know YOUR code.**

srcmap is a code context engine that parses your codebase, builds a knowledge graph of cross-service flows, and serves that context to your AI coding tools (Cursor, Claude Code, Windsurf) via MCP.

- **Zero LLM cost** -- srcmap doesn't call any AI APIs. It uses your existing AI's intelligence.
- **Zero config** -- install the extension, point to your server, done.
- **Zero vendor lock-in** -- works with any MCP-compatible tool. Self-host with Docker.

## Quick start

### Self-hosted (Docker)

```bash
docker compose up -d
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

## Tech stack

- TypeScript + Node.js 22
- SQLite + sqlite-vec (vector search) + FTS5 (text search)
- tree-sitter (code parsing)
- MCP SDK (AI tool integration)
- Local embeddings (all-MiniLM-L6-v2, runs in-process)
- Fastify (HTTP API)

## License

AGPL-3.0
