import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb } from "../db/connection.js";
import type { Card } from "../db/schema.js";
import { hybridSearch, checkCache } from "../search/hybrid.js";
import { trackToolCall } from "../metrics/tracker.js";
import { getEmbedder } from "../embeddings/local-embedder.js";

const MAX_CARD_LINES = 40;
const MAX_TOTAL_LINES = 300;

type CardSummary = Pick<Card, "id" | "flow" | "title" | "content" | "source_files" | "card_type">;

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

    const block =
      `### ${i + 1}. ${r.title}\n` +
      `**Flow:** ${r.flow} | **Type:** ${r.card_type}\n` +
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

async function searchAndTrack(
  query: string,
  branch?: string,
  limit = 5,
): Promise<{ cards: CardSummary[]; cardIds: string[]; cacheHit: boolean }> {
  const start = Date.now();

  const cached = await checkCache(query);
  if (cached && cached.length > 0) {
    const cards = cached.map((r) => r.card);
    const elapsed = Date.now() - start;
    trackToolCall({
      query,
      responseCards: cards.map((c) => c.id),
      responseTokens: cards.reduce((sum, c) => sum + c.content.length / 4, 0),
      cacheHit: true,
      latencyMs: elapsed,
      branch,
    });
    return { cards, cardIds: cards.map((c) => c.id), cacheHit: true };
  }

  const results = await hybridSearch(query, { branch, limit });
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

  return {
    cards: results.map((r) => r.card),
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
      },
    },
    async ({ query, branch }) => {
      try {
        const { cards, cacheHit } = await searchAndTrack(query, branch);

        if (cards.length === 0) {
          return {
            content: [
              { type: "text" as const, text: `No cards found for: "${query}"` },
            ],
          };
        }

        const header = cacheHit ? `(cache hit) ` : "";
        return {
          content: [
            {
              type: "text" as const,
              text: `${header}Found ${cards.length} card(s) for "${query}":\n\n${formatCards(cards)}`,
            },
          ],
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
        "Get codebase context for a ticket or task. Extracts keywords, runs " +
        "multiple searches, returns relevant knowledge cards and files. " +
        "ALWAYS call this first when starting work on any ticket.",
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
        const keywords = extractSearchTerms(description);
        const allResults = new Map<string, CardSummary>();

        for (const kw of keywords) {
          const { cards } = await searchAndTrack(kw, branch, 4);
          for (const card of cards) {
            if (!allResults.has(card.id)) allResults.set(card.id, card);
          }
        }

        if (allResults.size === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No relevant context found for this task.",
              },
            ],
          };
        }

        const sorted = prioritizeCards(Array.from(allResults.values()));
        const capped = sorted.slice(0, 8);

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
          `**Searches:** ${keywords.join(", ")}\n` +
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
        const keywords = extractSearchTerms(description);
        const fileScores = new Map<string, number>();

        for (const kw of keywords) {
          const results = await hybridSearch(kw, { limit: 5 });
          for (const r of results) {
            try {
              const files: string[] = JSON.parse(r.card.source_files);
              for (const f of files) {
                fileScores.set(f, (fileScores.get(f) || 0) + r.score);
              }
            } catch { /* skip */ }
          }
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
        "List all flows in the knowledge base with card counts. " +
        "Useful for discovering documented topics and areas.",
    },
    async () => {
      const db = getDb();

      const rows = db
        .prepare(
          `SELECT flow, COUNT(*) as count
           FROM cards
           WHERE stale = 0
           GROUP BY flow
           ORDER BY count DESC`,
        )
        .all() as { flow: string; count: number }[];

      if (rows.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No flows found. The knowledge base is empty.",
            },
          ],
        };
      }

      const lines = rows.map((r) => `- **${r.flow}**: ${r.count} card(s)`);
      const total = rows.reduce((sum, r) => sum + r.count, 0);

      return {
        content: [
          {
            type: "text" as const,
            text: `**${rows.length} flows** (${total} total cards):\n\n${lines.join("\n")}`,
          },
        ],
      };
    },
  );
}

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
  "as", "into", "through", "during", "before", "after", "above", "below",
  "between", "out", "off", "over", "under", "again", "further", "then",
  "once", "here", "there", "when", "where", "why", "how", "all", "each",
  "every", "both", "few", "more", "most", "other", "some", "such", "no",
  "not", "only", "own", "same", "so", "than", "too", "very", "just",
  "because", "but", "and", "or", "if", "while", "that", "this", "these",
  "those", "it", "its", "we", "they", "them", "their", "i", "you", "he",
  "she", "what", "which", "who", "whom", "want", "also", "get", "add",
  "use", "able", "based", "like", "make", "work", "new", "click",
  "ticket", "environment", "demo", "fields", "blank", "selected",
  "user", "users", "would", "once",
]);

function extractSearchTerms(text: string): string[] {
  const cleaned = text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^a-zA-Z0-9_\s-]/g, " ")
    .toLowerCase();

  const words = cleaned.split(/\s+/).filter(
    (w) => w.length > 2 && !STOP_WORDS.has(w),
  );

  const freq = new Map<string, number>();
  for (const w of words) {
    freq.set(w, (freq.get(w) || 0) + 1);
  }

  const bigrams: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    if (!STOP_WORDS.has(words[i]!) && !STOP_WORDS.has(words[i + 1]!)) {
      bigrams.push(`${words[i]} ${words[i + 1]}`);
    }
  }

  const topWords = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w]) => w);

  const topBigrams = [...new Set(bigrams)].slice(0, 3);

  const terms = [...topBigrams, ...topWords];
  return [...new Set(terms)].slice(0, 6);
}
