# Changelog

All notable changes to srcmap are documented here.

## [0.1.0] - 2026-02-23

Initial release.

### Core engine

- Tree-sitter parsing for Ruby, JavaScript/TypeScript, Vue, Python, Go
- Dependency graph construction with graphology
- Louvain community detection for automatic flow discovery
- Knowledge card generation (structural + LLM-enriched via Gemini/OpenAI/Anthropic)
- Git thermal map for commit-frequency-based card prioritization
- Branch detection with ticket ID extraction and cross-repo epic correlation
- Hybrid search pipeline: FTS5 + semantic vector search with RRF fusion
- Cross-encoder reranking (ms-marco-MiniLM-L-6-v2, in-process)
- In-process embeddings (nomic-embed-text-v1.5, 768-d via Transformers.js)
- sqlite-vec for vector search, FTS5 for full-text search
- Semantic query cache to avoid duplicate LLM/embedding calls
- Graph-neighbour expansion for related card discovery
- Conversation intelligence: transcript import with hallucination-protected insight extraction

### MCP integration

- 12 MCP tools: srcmap_context, srcmap_search, srcmap_ticket_files, srcmap_list_flows, srcmap_save_insight, srcmap_verify_card, srcmap_project_docs, srcmap_workspace_status, srcmap_recent_queries, srcmap_configure, srcmap_reindex, srcmap_promote_insight
- SSE transport for streaming connections
- Proactive usage instructions in server manifest

### Multi-tenancy (srcmap Cloud)

- Tenant isolation with per-tenant SQLite databases via AsyncLocalStorage
- API key authentication with SHA-256 hashing (keys never stored in plaintext)
- Magic link authentication for dashboard access
- Team member management: invite, auto-detect, deactivate
- Seat tracking with configurable limits per plan
- X-Dev-Email header for per-developer query attribution
- Founding team program: first 100 teams get unlimited seats free

### Dashboard

- React SPA with Tremor components and GitHub-dark theme
- Overview: token savings, query volume, cache hit rates
- Knowledge Base: browse, search, and inspect all generated cards
- Repositories: indexed repos, stack profiles, sync status
- Team: member list, invite form, seat usage tracking
- Analytics: per-flow query frequency, card coverage
- Multi-step onboarding wizard with personalized MCP config generation

### Framework skills

- 16 built-in skills: Rails, React, Vue, Next.js, Django, Django REST, FastAPI, Go, Gin, Laravel, NestJS, Angular, Svelte, Spring, Lambda, Python
- File-upload contribution model for community skills

### Deployment

- Docker Compose for development and production
- Caddy reverse proxy with automatic HTTPS and wildcard subdomains
- Hetzner CX23 setup script for sub-$5/month hosting
- Automated daily backups with 7-day retention
- Opt-in anonymous telemetry with aggregate public stats

### Evaluation

- Deterministic metrics suite (free, no API key needed)
- LLM-judged evaluation via Ragas (context precision, recall)
- Auto-generated golden dataset from indexed data
