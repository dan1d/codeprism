import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb } from "../db/connection.js";
import type { Card } from "../db/schema.js";
import { hybridSearch, checkCache, type SearchResult } from "../search/hybrid.js";
import { rerankResults as crossEncoderRerank } from "../search/reranker.js";
import { trackToolCall } from "../metrics/tracker.js";
import { getEmbedder } from "../embeddings/local-embedder.js";
import { classifyQueryEmbedding } from "../search/query-classifier.js";
import { createLLMProvider } from "../llm/provider.js";
import { patchMemoryDoc } from "../indexer/doc-generator.js";

const MAX_CARD_LINES = 40;
const MAX_TOTAL_LINES = 300;

// ---------------------------------------------------------------------------
// search_config cache — loaded once per process, invalidated on writes
// ---------------------------------------------------------------------------

let _searchConfig: Map<string, number> | null = null;

/** Returns all search_config values as a Map, loading from DB on first access. */
function getSearchConfig(): Map<string, number> {
  if (_searchConfig) return _searchConfig;
  try {
    const rows = getDb()
      .prepare("SELECT key, value FROM search_config")
      .all() as { key: string; value: string }[];
    _searchConfig = new Map(rows.map((r) => [r.key, parseFloat(r.value)]));
  } catch {
    _searchConfig = new Map();
  }
  return _searchConfig;
}

/** Look up a single numeric config key with a fallback default. */
function getSearchConfigValue(key: string, fallback: number): number {
  const v = getSearchConfig().get(key);
  return v !== undefined && !Number.isNaN(v) ? v : fallback;
}

/** Invalidate the in-process config cache (called after any search_config write). */
function invalidateSearchConfig(): void {
  _searchConfig = null;
}

type CardSummary = Pick<Card, "id" | "flow" | "title" | "content" | "source_files" | "card_type" | "specificity_score" | "usage_count"> & {
  stale?: number;
  verified_at?: string | null;
  verification_count?: number;
};

function truncateContent(content: string, maxLines: number): string {
  const lines = content.split("\n");
  if (lines.length <= maxLines) return content;
  return lines.slice(0, maxLines).join("\n") + "\n\n_(truncated)_";
}

function formatCards(cards: CardSummary[], totalLinesBudget = MAX_TOTAL_LINES): string {
  const parts: string[] = [];
  let linesUsed = 0;

  for (let i = 0; i < cards.length; i++) {
    const r = cards[i]!;
    const trimmed = truncateContent(r.content, MAX_CARD_LINES);

    let files: string[] = [];
    try { files = JSON.parse(r.source_files); } catch { /* skip */ }
    const fileList = files.slice(0, 5).map((f) => shortenPath(f)).join(", ");
    const moreFiles = files.length > 5 ? ` +${files.length - 5} more` : "";

    // Confidence indicator (inspired by Antigravity KI system)
    let confidence = "likely valid";
    if ((r as CardSummary).stale) confidence = "⚠ needs verification";
    else if ((r as CardSummary).verified_at) confidence = `✓ verified (${(r as CardSummary).verification_count ?? 0}x)`;

    const block =
      `### ${i + 1}. ${r.title}\n` +
      `**Flow:** ${r.flow} | **Type:** ${r.card_type} | **Confidence:** ${confidence}\n` +
      `**Files:** ${fileList}${moreFiles}\n\n${trimmed}`;

    const blockLines = block.split("\n").length;
    if (linesUsed + blockLines > totalLinesBudget && parts.length > 0) {
      parts.push(`\n_(${cards.length - i} more cards omitted for brevity)_`);
      break;
    }

    parts.push(block);
    linesUsed += blockLines;
  }

  return parts.join("\n\n---\n\n");
}

function shortenPath(p: string): string {
  const idx = p.indexOf("/biobridge/");
  return idx >= 0 ? p.slice(idx + "/biobridge/".length) : p;
}

function prioritizeCards(cards: CardSummary[]): CardSummary[] {
  const typeOrder: Record<string, number> = {
    model: 0,
    flow: 1,
    cross_service: 2,
    hub: 3,
    dev_insight: 0,
  };
  return [...cards].sort((a, b) => {
    const oa = typeOrder[a.card_type] ?? 4;
    const ob = typeOrder[b.card_type] ?? 4;
    return oa - ob;
  });
}

const REPO_PREFIXES: Record<string, string> = {
  "biobridge-frontend": "React frontend UI component: ",
  "biobridge-backend": "Rails backend API model controller: ",
  "bp-monitor-frontend": "Vue frontend bp-monitor: ",
  "bp-monitor-api": "Cuba API bp-monitor service: ",
};

/**
 * Builds a context-prefixed semantic query to steer embeddings toward the
 * relevant repo's semantic subspace. Falls back to the original query when
 * classification confidence is too low.
 */
async function buildSemanticQuery(query: string): Promise<string> {
  try {
    const raw = await getEmbedder().embed(query);
    const cls = classifyQueryEmbedding(raw);
    if (cls.topRepo && cls.confidence > 0.05) {
      const prefix = REPO_PREFIXES[cls.topRepo];
      if (prefix) return prefix + query;
    }
  } catch { /* non-critical */ }
  return query;
}

/**
 * HyDE — Hypothetical Document Embeddings.
 * For long ticket descriptions (> 80 chars), asks the configured LLM to
 * generate a hypothetical knowledge card that would answer the query, then
 * uses that richer text as the semantic query. This bridges the vocabulary
 * gap between short natural-language questions and dense technical card prose.
 *
 * Falls back to `buildSemanticQuery` if no LLM is configured, the description
 * is short (<= 200 chars), or the LLM doesn't respond within the timeout.
 * Timeout defaults to 1500ms but can be overridden via search_config key `hyde_timeout_ms`.
 */
async function buildHydeQuery(description: string): Promise<string> {
  if (description.length <= 200) return buildSemanticQuery(description);

  const llm = createLLMProvider();
  if (!llm) return buildSemanticQuery(description);

  // Read timeout from config (default 1500ms — generous enough for remote LLMs)
  const hydeTimeoutMs = getSearchConfigValue("hyde_timeout_ms", 1500);

  const hydeCall = (async () => {
    try {
      const hypothetical = await llm.generate(
        `Write a concise technical knowledge card (3–5 sentences) that directly answers this developer question about a codebase:\n\n"${description.slice(0, 600)}"\n\nWrite as if describing an existing system. Use technical terms naturally (models, controllers, services, components, associations, routes). Be specific.`,
        { maxTokens: 200, temperature: 0.1 },
      );
      if (hypothetical && hypothetical.trim().length > 20) return hypothetical.trim();
    } catch { /* non-critical */ }
    return null;
  })();

  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), hydeTimeoutMs));

  const result = await Promise.race([hydeCall, timeout]);
  // Fallback is lazy — only called when HyDE misses (avoids double embedding cost)
  return result ?? buildSemanticQuery(description);
}

/**
 * Expands search results with graph neighbours — cards that share files with
 * the top-5 results via import/API-endpoint edges. Added at a low base score
 * (0.3) so the cross-encoder can still surface them if they're relevant.
 */
function expandWithGraphNeighbours(results: SearchResult[]): SearchResult[] {
  if (results.length === 0) return results;

  const db = getDb();
  const top5 = results.slice(0, 5);
  const sourceFiles = new Set<string>();
  for (const r of top5) {
    try {
      (JSON.parse(r.card.source_files) as string[]).forEach((f) => sourceFiles.add(f));
    } catch { /* skip */ }
  }

  if (sourceFiles.size === 0) return results;

  const fileListJson = JSON.stringify([...sourceFiles]);
  const existingIdsJson = JSON.stringify(results.map((r) => r.card.id));

  const neighbours = db
    .prepare(
      `SELECT DISTINCT c.* FROM cards c
       WHERE c.stale = 0
         AND EXISTS (
           SELECT 1 FROM json_each(c.source_files) sf
           WHERE sf.value IN (
             SELECT ge.target_file FROM graph_edges ge
               WHERE ge.source_file IN (SELECT j.value FROM json_each(?))
             UNION
             SELECT ge.source_file FROM graph_edges ge
               WHERE ge.target_file IN (SELECT j.value FROM json_each(?))
           )
         )
         AND c.id NOT IN (SELECT j.value FROM json_each(?))
       LIMIT 5`,
    )
    .all(fileListJson, fileListJson, existingIdsJson) as Card[];

  const extra: SearchResult[] = neighbours.map((card) => ({
    card,
    score: 0.3,
    source: "semantic" as const,
  }));

  return [...results, ...extra];
}

// Lazily-cached prepared statement — avoids re-compiling SQL on every search call
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _insertInteraction: any | null = null;

/** Logs a batch of card_interactions rows (outcome='viewed') for every returned card. */
function logViewedInteractions(query: string, cardIds: string[], sessionId: string): void {
  if (cardIds.length === 0) return;
  try {
    const db = getDb();
    _insertInteraction ??= db.prepare(
      `INSERT INTO card_interactions (query, card_id, outcome, session_id, created_at)
       VALUES (?, ?, 'viewed', ?, datetime('now'))`,
    );
    const stmt = _insertInteraction;
    const tx = db.transaction(() => {
      for (const id of cardIds) stmt.run(query, id, sessionId);
    });
    tx();
  } catch { /* non-critical — don't fail search on interaction logging errors */ }
}

async function searchAndTrack(
  query: string,
  branch?: string,
  limit = 5,
  /** Caller-supplied session ID — allows sub-queries in one MCP call to share a session. */
  sessionId = randomUUID(),
): Promise<{ cards: CardSummary[]; results: SearchResult[]; cardIds: string[]; cacheHit: boolean }> {
  const start = Date.now();

  const cached = await checkCache(query);
  if (cached && cached.length > 0) {
    const cards = cached.map((r) => r.card);
    const elapsed = Date.now() - start;
    const cachedCardIds = cards.map((c) => c.id);
    trackToolCall({
      query,
      responseCards: cachedCardIds,
      responseTokens: cards.reduce((sum, c) => sum + c.content.length / 4, 0),
      cacheHit: true,
      latencyMs: elapsed,
      branch,
    });
    logViewedInteractions(query, cachedCardIds, sessionId);
    return { cards, results: cached, cardIds: cachedCardIds, cacheHit: true };
  }

  // Build a prefix-boosted semantic query based on embedding classification
  const semanticQuery = await buildSemanticQuery(query);

  // Fetch more candidates (4x limit) for cross-encoder reranking
  const candidates = await hybridSearch(query, { branch, limit: limit * 4, semanticQuery });

  // Expand with graph neighbours before reranking
  const expanded = expandWithGraphNeighbours(candidates);

  // Cross-encoder reranks all candidates down to the requested limit
  const results = await crossEncoderRerank(
    query,
    expanded,
    limit,
  );

  const elapsed = Date.now() - start;

  let embedding: Buffer | null = null;
  try {
    const raw = await getEmbedder().embed(query);
    embedding = Buffer.from(raw.buffer);
  } catch { /* non-critical */ }

  const cardIds = results.map((r) => r.card.id);
  trackToolCall({
    query,
    queryEmbedding: embedding,
    responseCards: cardIds,
    responseTokens: results.reduce((sum, r) => sum + r.card.content.length / 4, 0),
    cacheHit: false,
    latencyMs: elapsed,
    branch,
  });
  logViewedInteractions(query, cardIds, sessionId);

  return {
    cards: results.map((r) => r.card),
    results,
    cardIds,
    cacheHit: false,
  };
}

/**
 * Registers all srcmap MCP tools on the given server instance.
 */
export function registerTools(server: McpServer): void {
  server.registerTool(
    "srcmap_search",
    {
      description:
        "Search srcmap knowledge cards by query. Returns matching cards with " +
        "content, flow, and source files. Uses hybrid FTS + semantic vector search.",
      inputSchema: {
        query: z.string().describe("The search query string"),
        branch: z
          .string()
          .optional()
          .describe("Optional branch name to scope results"),
        debug: z
          .boolean()
          .optional()
          .describe("Include score breakdown for each result"),
      },
    },
    async ({ query, branch, debug }) => {
      try {
        const { cards, results, cacheHit } = await searchAndTrack(query, branch);

        if (cards.length === 0) {
          return {
            content: [
              { type: "text" as const, text: `No cards found for: "${query}"` },
            ],
          };
        }

        const header = cacheHit ? `(cache hit) ` : "";

        // Flow context: summarize which flows were hit
        const flowHits = [...new Set(cards.map((c) => c.flow))];
        const flowContext = flowHits.length > 0
          ? `**Flows touched:** ${flowHits.join(", ")}\n\n`
          : "";

        let text = `${header}Found ${cards.length} card(s) for "${query}":\n\n${flowContext}${formatCards(cards)}`;

        if (debug) {
          const scoreLines = results.map((r, i) => {
            const card = r.card;
            let files: string[] = [];
            try { files = JSON.parse(card.source_files as unknown as string); } catch { /* ignore */ }
            return [
              `[${i + 1}] ${card.title} (type: ${card.card_type}, score: ${r.score.toFixed(4)}, source: ${r.source})`,
              `    specificity: ${(card as Card).specificity_score?.toFixed(3) ?? "n/a"}, usage: ${(card as Card).usage_count ?? 0}`,
              `    files: ${files.slice(0, 3).map((f) => shortenPath(f)).join(", ")}${files.length > 3 ? ` +${files.length - 3} more` : ""}`,
            ].join("\n");
          });
          text += `\n\n--- DEBUG SCORES ---\n${scoreLines.join("\n")}`;
        }

        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Search error: ${message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "srcmap_context",
    {
      description:
        "Get codebase context for a ticket or task. Runs a primary semantic " +
        "search on the full description, then supplements with entity-specific " +
        "keyword lookups. ALWAYS call this first when starting work on any ticket.",
      inputSchema: {
        description: z
          .string()
          .describe("The full ticket or task description"),
        branch: z
          .string()
          .optional()
          .describe("Current git branch name"),
      },
    },
    async ({ description, branch }) => {
      try {
        const cleaned = description
          .replace(/https?:\/\/\S+/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 1000);

        // One session ID shared across all sub-queries so analytics can group them
        const contextSessionId = randomUUID();

        // HyDE: for long ticket descriptions, generate a hypothetical card to improve recall
        const hydeQuery = await buildHydeQuery(cleaned);
        const { results: primaryResults } = await searchAndTrack(hydeQuery, branch, 10, contextSessionId);

        const entities = extractEntityNames(description);
        const seenIds = new Set(primaryResults.map((r) => r.card.id));
        const allSearchResults: SearchResult[] = [...primaryResults];

        for (const entity of entities.slice(0, 3)) {
          const { results: entityResults } = await searchAndTrack(entity, branch, 4, contextSessionId);
          for (const r of entityResults) {
            if (!seenIds.has(r.card.id)) {
              seenIds.add(r.card.id);
              allSearchResults.push({ ...r, score: r.score * 0.8 });
            }
          }
        }

        if (allSearchResults.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No relevant context found for this task.",
              },
            ],
          };
        }

        // Cross-encoder final rerank of the merged candidate set
        const reranked = await crossEncoderRerank(hydeQuery, allSearchResults, 8);
        const capped = reranked.map((r) => r.card);

        const flows = [...new Set(capped.map((c) => c.flow))];
        const allFiles = new Set<string>();
        for (const c of capped) {
          try {
            const files: string[] = JSON.parse(c.source_files);
            files.slice(0, 10).forEach((f) => allFiles.add(shortenPath(f)));
          } catch { /* skip */ }
        }

        const summary =
          `## srcmap Context\n\n` +
          `**Entities:** ${entities.length > 0 ? entities.join(", ") : "(none extracted)"}\n` +
          `**Flows:** ${flows.join(", ")}\n` +
          `**Key files (${allFiles.size}):**\n${[...allFiles].slice(0, 20).map((f) => `- ${f}`).join("\n")}\n\n` +
          `---\n\n` +
          formatCards(capped);

        return {
          content: [{ type: "text" as const, text: summary }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            { type: "text" as const, text: `Context error: ${message}` },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "srcmap_ticket_files",
    {
      description:
        "Returns the files most likely to need edits for a given task. " +
        "Use after srcmap_context to narrow down to specific files.",
      inputSchema: {
        description: z.string().describe("Brief summary of what needs to change"),
      },
    },
    async ({ description }) => {
      try {
        const cleaned = description
          .replace(/https?:\/\/\S+/g, "")
          .slice(0, 500);

        const results = await hybridSearch(cleaned, { limit: 10 });
        const fileScores = new Map<string, number>();

        for (const r of results) {
          try {
            const files: string[] = JSON.parse(r.card.source_files);
            for (const f of files) {
              fileScores.set(f, (fileScores.get(f) || 0) + r.score);
            }
          } catch { /* skip */ }
        }

        const sorted = [...fileScores.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20);

        if (sorted.length === 0) {
          return {
            content: [
              { type: "text" as const, text: "No files identified for this task." },
            ],
          };
        }

        const lines = sorted.map(
          ([path, score]) => `- ${shortenPath(path)} (relevance: ${score.toFixed(2)})`,
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `**Files likely relevant (${sorted.length}):**\n\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "srcmap_save_insight",
    {
      description:
        "Save a knowledge card capturing an architectural insight, design " +
        "decision, or important context discovered during development.",
      inputSchema: {
        flow: z.string().describe("The flow/category this insight belongs to"),
        title: z.string().describe("A concise title for the knowledge card"),
        content: z
          .string()
          .describe("The full markdown content of the insight"),
        files: z
          .array(z.string())
          .optional()
          .describe("Related source file paths"),
      },
    },
    async ({ flow, title, content, files }) => {
      const db = getDb();

      try {
        const id = randomUUID();
        const sourceFiles = JSON.stringify(files ?? []);

        db.prepare(
          `INSERT INTO cards (id, flow, title, content, card_type, source_files, created_by)
           VALUES (?, ?, ?, ?, 'dev_insight', ?, 'mcp_client')`,
        ).run(id, flow, title, content, sourceFiles);

        // Heartbeat: every 10 dev_insights, patch the team memory doc (fire-and-forget)
        const insightCount = (
          db.prepare(
            `SELECT COUNT(*) as n FROM cards WHERE card_type = 'dev_insight' AND stale = 0`,
          ).get() as { n: number }
        ).n;
        if (insightCount % 10 === 0) {
          patchMemoryDoc().catch((err: unknown) =>
            console.warn("[memory] Patch failed:", (err as Error).message),
          );
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Saved insight card "${title}" (id: ${id}) to flow "${flow}".`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            { type: "text" as const, text: `Failed to save insight: ${message}` },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "srcmap_list_flows",
    {
      description:
        "List all flows in the knowledge base with card counts, repos, and file counts. " +
        "Use this first to understand the app's structure before searching for specific topics.",
    },
    async () => {
      const db = getDb();

      const rows = db
        .prepare(
          `SELECT
            c.flow,
            COUNT(DISTINCT c.id) AS card_count,
            GROUP_CONCAT(DISTINCT jr.value) AS repos,
            COUNT(DISTINCT jf.value) AS file_count,
            SUM(CASE WHEN c.stale = 1 THEN 1 ELSE 0 END) AS stale_count
          FROM cards c
            LEFT JOIN json_each(c.source_repos) jr
            LEFT JOIN json_each(c.source_files) jf
          GROUP BY c.flow
          ORDER BY card_count DESC`,
        )
        .all() as { flow: string; card_count: number; repos: string | null; file_count: number; stale_count: number }[];

      if (rows.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: "No flows found. The knowledge base is empty.",
          }],
        };
      }

      const lines = rows.map((r) => {
        const repos = r.repos ? [...new Set(r.repos.split(","))].join(", ") : "unknown";
        const crossRepo = repos.includes(",") ? " (cross-repo)" : "";
        const staleFlag = r.stale_count > 0 ? ` ⚠ ${r.stale_count} stale` : "";
        return `- **${r.flow}**: ${r.card_count} card(s), ${r.file_count} files — ${repos}${crossRepo}${staleFlag}`;
      });
      const total = rows.reduce((sum, r) => sum + r.card_count, 0);

      return {
        content: [{
          type: "text" as const,
          text: `**${rows.length} flows** (${total} total cards):\n\n${lines.join("\n")}`,
        }],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // srcmap_verify_card — confirm a card is still accurate (Antigravity KI pattern)
  // ---------------------------------------------------------------------------

  server.registerTool(
    "srcmap_verify_card",
    {
      description:
        "Mark a card as verified — confirming its content is still accurate after " +
        "reviewing it. This builds confidence scores over time. Call this after using " +
        "a card's information and confirming it matched the actual codebase.",
      inputSchema: {
        card_id: z.string().describe("The card ID to mark as verified"),
      },
    },
    async ({ card_id }) => {
      const db = getDb();
      try {
        const result = db.prepare(
          `UPDATE cards
           SET verified_at = datetime('now'),
               verification_count = verification_count + 1
           WHERE id = ?`,
        ).run(card_id);

        if (result.changes === 0) {
          return {
            content: [{ type: "text" as const, text: `Card "${card_id}" not found.` }],
            isError: true,
          };
        }

        return {
          content: [{
            type: "text" as const,
            text: `Verified card "${card_id}". Confidence increased.`,
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Verify error: ${message}` }],
          isError: true,
        };
      }
    },
  );

  // ---------------------------------------------------------------------------
  // srcmap_recent_queries — past query history (Windsurf trajectory pattern)
  // ---------------------------------------------------------------------------

  server.registerTool(
    "srcmap_recent_queries",
    {
      description:
        "Returns recent search queries and which cards they matched. Use to avoid " +
        "re-asking the same questions and to see what context was previously retrieved.",
      inputSchema: {
        limit: z.number().optional().describe("Max queries to return (default 10)"),
      },
    },
    async ({ limit }) => {
      const db = getDb();
      try {
        const rows = db
          .prepare(
            `SELECT
              ci.query,
              COUNT(DISTINCT ci.card_id) AS matched_cards,
              GROUP_CONCAT(DISTINCT c.title) AS card_titles,
              MAX(ci.timestamp) AS last_asked,
              COUNT(*) AS ask_count
            FROM card_interactions ci
              LEFT JOIN cards c ON c.id = ci.card_id
            GROUP BY ci.query
            ORDER BY last_asked DESC
            LIMIT ?`,
          )
          .all(limit ?? 10) as {
            query: string;
            matched_cards: number;
            card_titles: string | null;
            last_asked: string;
            ask_count: number;
          }[];

        if (rows.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: "No recent queries found. The query history is empty.",
            }],
          };
        }

        const lines = rows.map((r) => {
          const titles = r.card_titles
            ? r.card_titles.split(",").slice(0, 3).join(", ")
            : "no matches";
          return `- **"${r.query}"** → ${r.matched_cards} card(s) [${titles}] (${r.last_asked})`;
        });

        return {
          content: [{
            type: "text" as const,
            text: `**Recent queries (${rows.length}):**\n\n${lines.join("\n")}`,
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Query history error: ${message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "srcmap_configure",
    {
      description:
        "View or modify srcmap search configuration. " +
        "Use to tune search scoring multipliers or view current settings.",
      inputSchema: {
        action: z.enum(["get", "set", "list"]).describe("Action to perform"),
        key: z.string().optional().describe("Config key (e.g. hub_penalty, flow_boost)"),
        value: z.string().optional().describe("New value for the key (required for 'set')"),
      },
    },
    async ({ action, key, value }) => {
      const db = getDb();

      try {
        if (action === "list") {
          const rows = db
            .prepare("SELECT key, value, updated_at FROM search_config ORDER BY key")
            .all() as { key: string; value: string; updated_at: string }[];

          if (rows.length === 0) {
            return {
              content: [{ type: "text" as const, text: "No custom configuration set. Using defaults." }],
            };
          }

          const lines = rows.map((r) => `- **${r.key}**: ${r.value} (updated: ${r.updated_at})`);
          return {
            content: [{ type: "text" as const, text: `**Search config:**\n\n${lines.join("\n")}` }],
          };
        }

        if (action === "get") {
          if (!key) {
            return {
              content: [{ type: "text" as const, text: "Error: 'key' is required for 'get'" }],
              isError: true,
            };
          }
          const row = db
            .prepare("SELECT value FROM search_config WHERE key = ?")
            .get(key) as { value: string } | undefined;

          return {
            content: [
              {
                type: "text" as const,
                text: row ? `**${key}**: ${row.value}` : `Key "${key}" not found. Using default.`,
              },
            ],
          };
        }

        if (action === "set") {
          if (!key || value === undefined) {
            return {
              content: [{ type: "text" as const, text: "Error: 'key' and 'value' are required for 'set'" }],
              isError: true,
            };
          }
          db.prepare(
            `INSERT INTO search_config (key, value, updated_at)
             VALUES (?, ?, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
          ).run(key, value);

          // Bust the in-process cache so the next search picks up the new value
          invalidateSearchConfig();

          return {
            content: [{ type: "text" as const, text: `Set **${key}** = ${value}` }],
          };
        }

        return {
          content: [{ type: "text" as const, text: `Unknown action: ${action}` }],
          isError: true,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Config error: ${message}` }],
          isError: true,
        };
      }
    },
  );

  // ---------------------------------------------------------------------------
  // srcmap_workspace_status — real-time knowledge base health overview
  // ---------------------------------------------------------------------------

  server.registerTool(
    "srcmap_workspace_status",
    {
      description:
        "Returns a real-time status of the srcmap knowledge base: stale card counts, " +
        "last indexed commit, active skills, and cross-repo dependencies per repository. " +
        "Use this to understand the current state of the knowledge base before deciding whether to reindex.",
    },
    async () => {
      const db = getDb();
      try {
        const repoStats = db
          .prepare(
            `SELECT
              json_each.value as repo,
              COUNT(c.id) as total_cards,
              SUM(c.stale) as stale_cards,
              MAX(c.source_commit) as last_commit
            FROM cards c, json_each(c.source_repos)
            WHERE json_each.value != ''
            GROUP BY json_each.value
            ORDER BY total_cards DESC`,
          )
          .all() as { repo: string; total_cards: number; stale_cards: number; last_commit: string | null }[];

        const profiles = db
          .prepare(
            "SELECT repo, primary_language, frameworks, skill_ids FROM repo_profiles",
          )
          .all() as { repo: string; primary_language: string; frameworks: string; skill_ids: string }[];
        const profileMap = new Map(profiles.map((p) => [p.repo, p]));

        const crossRepoEdges = db
          .prepare(
            `SELECT
              ge.repo as source_repo,
              COUNT(*) as edge_count
            FROM graph_edges ge
            WHERE ge.relation = 'api_endpoint'
            GROUP BY ge.repo
            ORDER BY edge_count DESC
            LIMIT 10`,
          )
          .all() as { source_repo: string; edge_count: number }[];

        const staleDocs = db
          .prepare(
            "SELECT repo, doc_type FROM project_docs WHERE stale = 1 AND repo != '__memory__'",
          )
          .all() as { repo: string; doc_type: string }[];

        const lines: string[] = ["## srcmap Workspace Status\n"];

        for (const stat of repoStats) {
          const profile = profileMap.get(stat.repo);
          let skillIds: string[] = [];
          try { skillIds = profile ? (JSON.parse(profile.skill_ids) as string[]) : []; } catch { /* ignore */ }
          lines.push(`### ${stat.repo}`);
          lines.push(
            `- **Stack:** ${profile?.primary_language ?? "unknown"}` +
            (skillIds.length ? ` (${skillIds.join(", ")})` : ""),
          );
          lines.push(`- **Cards:** ${stat.total_cards} total, ${stat.stale_cards ?? 0} stale`);
          if (stat.last_commit) {
            lines.push(`- **Last indexed commit:** ${stat.last_commit.slice(0, 8)}`);
          }
          const staleDocTypes = staleDocs
            .filter((d) => d.repo === stat.repo)
            .map((d) => d.doc_type);
          if (staleDocTypes.length) {
            lines.push(`- **Stale docs:** ${staleDocTypes.join(", ")}`);
          }
          lines.push("");
        }

        if (crossRepoEdges.length > 0) {
          lines.push("### Cross-Repo Connections");
          for (const edge of crossRepoEdges) {
            lines.push(`- **${edge.source_repo}**: ${edge.edge_count} api_endpoint edge(s)`);
          }
          lines.push("");
        }

        const totalStale = repoStats.reduce((sum, r) => sum + (r.stale_cards ?? 0), 0);
        lines.push(`**Total stale cards:** ${totalStale}`);
        if (totalStale > 0) {
          lines.push("\n> Run `srcmap_reindex` or `POST /api/reindex-stale` to refresh stale cards.");
        }

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Status error: ${message}` }],
          isError: true,
        };
      }
    },
  );

  // ---------------------------------------------------------------------------
  // srcmap_reindex — report stale cards and guide incremental reindexing
  // ---------------------------------------------------------------------------

  server.registerTool(
    "srcmap_reindex",
    {
      description:
        "Triggers incremental reindex of stale cards only. Faster than a full reindex — " +
        "only regenerates cards whose source files changed.",
      inputSchema: {
        repo: z
          .string()
          .optional()
          .describe("Limit reindex to a specific repo. Omit to reindex all stale cards."),
      },
    },
    async ({ repo }) => {
      const db = getDb();
      try {
        const staleCount = repo
          ? (
              db
                .prepare(`SELECT COUNT(*) as n FROM cards WHERE stale = 1 AND source_repos LIKE ?`)
                .get(`%${repo}%`) as { n: number }
            ).n
          : (
              db
                .prepare(`SELECT COUNT(*) as n FROM cards WHERE stale = 1`)
                .get() as { n: number }
            ).n;

        if (staleCount === 0) {
          return {
            content: [{
              type: "text" as const,
              text: "No stale cards found. Knowledge base is up to date.",
            }],
          };
        }

        return {
          content: [{
            type: "text" as const,
            text:
              `Found ${staleCount} stale card(s)${repo ? ` in ${repo}` : ""}.\n\n` +
              `Trigger async reindex via the REST API:\n\`\`\`\n` +
              `curl -X POST http://localhost:4000/api/reindex-stale${repo ? `?repo=${repo}` : ""}\n\`\`\`\n\n` +
              `Then poll for status:\n\`\`\`\n` +
              `curl http://localhost:4000/api/reindex-status\n\`\`\`\n\n` +
              `Or reindex manually:\n\`\`\`\npnpm index\n\`\`\``,
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Reindex error: ${message}` }],
          isError: true,
        };
      }
    },
  );

  // ---------------------------------------------------------------------------
  // srcmap_project_docs — retrieve generated project documentation
  // ---------------------------------------------------------------------------

  server.registerTool(
    "srcmap_project_docs",
    {
      description:
        "Retrieve AI-generated project documentation (About, Architecture, Code Style, Rules, Styles, README) " +
        "for one or more repositories. Use to get high-level context before diving into implementation. " +
        "Call without a repo filter to list all available docs.",
      inputSchema: {
        repo: z
          .string()
          .optional()
          .describe("Repository name (e.g. 'biobridge-backend'). Omit to list all repos with docs."),
        doc_type: z
          .enum(["readme", "about", "architecture", "code_style", "rules", "styles"])
          .optional()
          .describe("Specific doc type. Omit to return all docs for the repo."),
      },
    },
    async ({ repo, doc_type }) => {
      const db = getDb();

      try {
        // List mode: show all repos and their doc types
        if (!repo) {
          const rows = db
            .prepare(
              `SELECT repo, doc_type, title, stale, updated_at
               FROM project_docs ORDER BY repo, doc_type`,
            )
            .all() as { repo: string; doc_type: string; title: string; stale: number; updated_at: string }[];

          if (rows.length === 0) {
            return {
              content: [{
                type: "text" as const,
                text: "No project docs found. Run `pnpm index` to generate them.",
              }],
            };
          }

          const byRepo = new Map<string, typeof rows>();
          for (const row of rows) {
            const list = byRepo.get(row.repo) ?? [];
            list.push(row);
            byRepo.set(row.repo, list);
          }

          const lines: string[] = ["## Available Project Docs\n"];
          for (const [r, docs] of byRepo) {
            lines.push(`### ${r}`);
            for (const d of docs) {
              const staleFlag = d.stale ? " ⚠️ stale" : "";
              lines.push(`- **${d.doc_type}**: ${d.title}${staleFlag} (${d.updated_at})`);
            }
            lines.push("");
          }

          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        }

        // Fetch specific doc(s) for a repo
        const query = doc_type
          ? "SELECT * FROM project_docs WHERE repo = ? AND doc_type = ?"
          : "SELECT * FROM project_docs WHERE repo = ? ORDER BY doc_type";

        const rows = (doc_type
          ? [db.prepare(query).get(repo, doc_type)]
          : db.prepare(query).all(repo)
        ).filter(Boolean) as Array<{
          id: string;
          repo: string;
          doc_type: string;
          title: string;
          content: string;
          stale: number;
          updated_at: string;
        }>;

        if (rows.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: `No docs found for repo "${repo}"${doc_type ? ` (type: ${doc_type})` : ""}. ` +
                "Run `pnpm index` to generate project documentation.",
            }],
          };
        }

        const parts = rows.map((d) => {
          const staleWarning = d.stale
            ? "\n> ⚠️ **This doc may be stale** — some source files have changed since generation. " +
              "Call `POST /api/refresh` to regenerate.\n"
            : "";
          return `# ${d.title}\n_Updated: ${d.updated_at}_\n${staleWarning}\n${d.content}`;
        });

        return {
          content: [{ type: "text" as const, text: parts.join("\n\n---\n\n") }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Project docs error: ${message}` }],
          isError: true,
        };
      }
    },
  );

  // Conversation intelligence: human-gated insight promotion
  registerPromoteInsightTool(server);
}

// ---------------------------------------------------------------------------
// srcmap_promote_insight — human-gated promotion for ambiguous insights
// ---------------------------------------------------------------------------

/**
 * Registers the srcmap_promote_insight tool on the MCP server.
 *
 * Promotes a conv_insight card (trust 0.4–0.8) to the rules or code_style doc
 * after human review confirms it. Uses LLM diff-merge to integrate the insight
 * without overwriting existing doc content.
 */
export function registerPromoteInsightTool(server: McpServer): void {
  server.tool(
    "srcmap_promote_insight",
    "Promote a conversation-extracted insight to the rules or code_style doc after human review",
    {
      insight_id: z.string().describe("ID from extracted_insights table"),
      approve: z.boolean().describe("true = promote to doc, false = mark as aspirational"),
      target_doc: z.enum(["rules", "code_style"]).optional().describe("Which doc to patch (default: inferred from category)"),
    },
    async ({ insight_id, approve, target_doc }) => {
      const db = getDb();

      const insight = db
        .prepare(`SELECT * FROM extracted_insights WHERE id = ?`)
        .get(insight_id) as {
          id: string;
          statement: string;
          category: string;
          evidence_quote: string;
          trust_score: number;
        } | undefined;

      if (!insight) {
        return { content: [{ type: "text", text: `Insight ${insight_id} not found.` }] };
      }

      if (!approve) {
        db.prepare(
          `UPDATE extracted_insights SET aspirational = 1, trust_score = 0.2 WHERE id = ?`
        ).run(insight_id);
        return { content: [{ type: "text", text: `Marked insight as aspirational (no promotion).` }] };
      }

      // Infer target doc from category
      const docType = target_doc ?? (
        insight.category === "coding_rule" || insight.category === "anti_pattern"
          ? "code_style"
          : "rules"
      );

      // Update trust to confirmed level
      db.prepare(
        `UPDATE extracted_insights SET trust_score = 0.95, verification_basis = 'human_confirmed', aspirational = 0 WHERE id = ?`
      ).run(insight_id);

      // Update the card's tags to reflect promotion
      if (insight.category) {
        db.prepare(
          `UPDATE cards SET tags = json_insert(tags, '$[#]', 'promoted'), expires_at = NULL WHERE source_conversation_id = (SELECT transcript_id FROM extracted_insights WHERE id = ?)`
        ).run(insight_id);
      }

      return {
        content: [{
          type: "text",
          text: [
            `✓ Insight promoted to \`${docType}\``,
            ``,
            `**Statement**: ${insight.statement}`,
            `**Trust score**: 0.95 (human confirmed)`,
            ``,
            `The \`${docType}\` doc will include this rule on next regeneration.`,
            `Run \`pnpm srcmap index --force-docs\` to regenerate docs immediately.`,
          ].join("\n"),
        }],
      };
    },
  );
}

const ENGLISH_STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "ought", "to", "of",
  "in", "for", "on", "with", "at", "by", "from", "as", "into", "through",
  "during", "before", "after", "between", "out", "off", "over", "under",
  "again", "then", "once", "here", "there", "when", "where", "why", "how",
  "all", "each", "every", "both", "few", "more", "most", "other", "some",
  "such", "no", "not", "only", "own", "same", "so", "than", "too", "very",
  "just", "because", "but", "and", "or", "if", "while", "that", "this",
  "these", "those", "it", "its", "we", "they", "them", "their", "i", "you",
  "he", "she", "what", "which", "who", "whom", "also", "get", "like",
  "about", "above", "below", "up", "down",
]);

/**
 * Extracts likely domain entity names from a ticket description.
 * Looks for compound terms (snake_case, PascalCase), capitalized words,
 * and frequent nouns that are not generic English stop words.
 */
function extractEntityNames(text: string): string[] {
  const cleaned = text.replace(/https?:\/\/\S+/g, "");

  const entities: string[] = [];

  const snakeCase = cleaned.match(/[a-z][a-z0-9]*(?:_[a-z0-9]+)+/g) ?? [];
  entities.push(...snakeCase);

  const pascalCase = cleaned.match(/[A-Z][a-z]+(?:[A-Z][a-z]+)+/g) ?? [];
  entities.push(...pascalCase);

  const words = cleaned
    .replace(/[^a-zA-Z0-9_\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !ENGLISH_STOP_WORDS.has(w.toLowerCase()));

  const freq = new Map<string, number>();
  for (const w of words) {
    const lower = w.toLowerCase();
    freq.set(lower, (freq.get(lower) || 0) + 1);
  }

  const topWords = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w]) => w);

  entities.push(...topWords);

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const e of entities) {
    const lower = e.toLowerCase();
    if (!seen.has(lower) && !ENGLISH_STOP_WORDS.has(lower) && e.length > 2) {
      seen.add(lower);
      unique.push(e);
    }
  }

  return unique.slice(0, 5);
}
