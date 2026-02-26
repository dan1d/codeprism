# MCP Tools Reference

srcmap exposes 12 tools and 1 resource via MCP. Your AI calls these automatically when srcmap is connected.

## Tools

### `codeprism_context`

Get full codebase context for a ticket or task. **Call this first when starting work on any ticket.**

Runs a HyDE-enhanced semantic search on the full description, then supplements with entity-specific keyword lookups. Results are cross-encoder reranked.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `description` | string | yes | Full ticket or task description |
| `branch` | string | no | Current git branch name |

**Returns:** Extracted entities, matched flows, key files, and up to 8 knowledge cards.

---

### `codeprism_search`

Search knowledge cards by query. Uses hybrid FTS + semantic vector search with cross-encoder reranking.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Search query |
| `branch` | string | no | Branch name to scope results |
| `debug` | boolean | no | Include score breakdown per result |

**Returns:** Matched cards with flow, type, confidence indicator, and source files.

---

### `codeprism_ticket_files`

Returns the files most likely to need edits for a given task. Use after `codeprism_context` to narrow down to specific files.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `description` | string | yes | Brief summary of what needs to change |

**Returns:** Up to 20 files ranked by relevance score.

---

### `codeprism_save_insight`

Save an architectural insight, design decision, or important context discovered during development. Creates a `dev_insight` card that appears in future search results.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `flow` | string | yes | Flow/category this insight belongs to |
| `title` | string | yes | Concise title for the knowledge card |
| `content` | string | yes | Full markdown content |
| `files` | string[] | no | Related source file paths |

**Example:**
```
codeprism_save_insight({
  flow: "billing",
  title: "Billing uses a saga pattern across 3 services",
  content: "The billing flow spans backend (BillingOrder), Cuba (charge processing), and frontend (status polling). Failures trigger compensating transactions via Sidekiq retry.",
  files: ["app/services/billing/charge_service.rb"]
})
```

Every 10 dev insights, srcmap automatically patches the team memory doc.

---

### `codeprism_list_flows`

List all flows in the knowledge base with card counts, repos, file counts, and heat scores.

No parameters.

**Returns:** All flows sorted by average heat score, with cross-repo indicators and stale card warnings.

---

### `codeprism_verify_card`

Mark a card as verified after confirming its content matches the actual codebase. Builds confidence scores over time.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `card_id` | string | yes | The card ID to verify |

Cards show confidence indicators in search results: "likely valid", "verified (Nx)", or "needs verification" (stale).

---

### `codeprism_recent_queries`

Returns recent search queries and which cards they matched. Use to avoid re-asking the same questions.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | number | no | Max queries to return (default 10) |

---

### `codeprism_configure`

View or modify search configuration at runtime.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | `"get" \| "set" \| "list"` | yes | Action to perform |
| `key` | string | for get/set | Config key (e.g. `hub_penalty`, `max_hub_cards`) |
| `value` | string | for set | New value |

---

### `codeprism_workspace_status`

Real-time knowledge base health overview: stale cards, stack profiles, cross-repo API edges, and stale project docs per repo.

No parameters.

---

### `codeprism_reindex`

Triggers incremental reindex of stale cards only. Faster than a full reindex.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `repo` | string | no | Limit to a specific repo |

Returns the `curl` commands for the async reindex REST API.

---

### `codeprism_project_docs`

Retrieve AI-generated project documentation. Call without `repo` to list all available docs.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `repo` | string | no | Repository name. Omit to list all repos with docs. |
| `doc_type` | string | no | One of: `readme`, `about`, `architecture`, `code_style`, `rules`, `styles` |

---

### `codeprism_promote_insight`

Promote a conversation-extracted insight to the rules or code_style doc after human review.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `insight_id` | string | yes | ID from the extracted_insights table |
| `approve` | boolean | yes | `true` = promote, `false` = mark as aspirational |
| `target_doc` | string | no | `"rules"` or `"code_style"` (default: inferred from category) |

## Resources

### `srcmap://stats`

JSON resource with current engine statistics:
- `totalCards` -- non-stale card count
- `totalFlows` -- distinct flow count
- `totalQueries` -- total MCP queries served
- `cacheHitRate` -- percentage of queries served from semantic cache

## REST API

The engine also exposes HTTP endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check with card and flow counts |
| `/api/sync` | POST | Receive sync payload from the Cursor extension |
| `/api/reindex-stale` | POST | Trigger async stale card reindex |
| `/api/reindex-status` | GET | Poll reindex progress |
| `/api/flows` | GET | List all flows |
| `/api/cards` | GET | List/search cards |
| `/api/metrics` | GET | Query analytics |
| `/mcp/sse` | GET | MCP SSE transport endpoint |
| `/mcp/messages` | POST | MCP message endpoint |
