import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Card } from "../../db/schema.js";
import { hybridSearch } from "../../search/hybrid.js";
import { rerankResults as crossEncoderRerank } from "../../search/reranker.js";
import {
  searchAndTrack,
  buildHydeQuery,
  formatCards,
  shortenPath,
  extractEntityNames,
  type SearchResult,
  type CardSummary,
} from "../../services/search.js";
import { safeParseJsonArray } from "../../services/utils.js";
import { getActiveContext, buildContextQuery } from "../../services/context.js";
import { getDevEmail } from "../dev-context.js";

export function registerSearchTools(server: McpServer): void {
  server.registerTool(
    "codeprism_search",
    {
      description:
        "Search codeprism knowledge cards by query. Returns matching cards with " +
        "content, flow, and source files. Uses hybrid FTS + semantic vector search.",
      inputSchema: {
        query: z.string().describe("The search query string"),
        branch: z.string().optional().describe("Optional branch name to scope results"),
        debug: z.boolean().optional().describe("Include score breakdown for each result"),
      },
    },
    async ({ query, branch, debug }) => {
      try {
        const { cards, results, cacheHit } = await searchAndTrack(query, branch, 5, randomUUID(), getDevEmail());

        if (cards.length === 0) {
          return { content: [{ type: "text" as const, text: `No cards found for: "${query}"` }] };
        }

        const header = cacheHit ? `(cache hit) ` : "";
        const flowHits = [...new Set(cards.map((c) => c.flow))];
        const flowContext = flowHits.length > 0
          ? `**Flows touched:** ${flowHits.join(", ")}\n\n`
          : "";

        let text = `${header}Found ${cards.length} card(s) for "${query}":\n\n${flowContext}${formatCards(cards, undefined, query)}`;

        if (debug) {
          const scoreLines = results.map((r, i) => {
            const card = r.card;
            const files = safeParseJsonArray(card.source_files);
            return [
              `[${i + 1}] ${card.title} (type: ${card.card_type}, score: ${r.score.toFixed(4)}, source: ${r.source})`,
              `    specificity: ${(card as Card).specificity_score?.toFixed(3) ?? "n/a"}, usage: ${(card as Card).usage_count ?? 0}`,
              `    files: ${files.slice(0, 3).map((f) => shortenPath(f)).join(", ")}${files.length > 3 ? ` +${files.length - 3} more` : ""}`,
            ].join("\n");
          });
          text += `\n\n--- DEBUG SCORES ---\n${scoreLines.join("\n")}`;
        }

        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Search error: ${message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "codeprism_context",
    {
      description:
        "Get codebase context for a ticket or task. Runs a primary semantic " +
        "search on the full description, then supplements with entity-specific " +
        "keyword lookups. ALWAYS call this first when starting work on any ticket. " +
        "If description is omitted, the active branch context set by the last git checkout is used automatically.",
      inputSchema: {
        description: z.string().optional().describe(
          "The full ticket or task description. If omitted, the current branch context is used automatically.",
        ),
        branch: z.string().optional().describe("Current git branch name"),
      },
    },
    async ({ description, branch }) => {
      try {
        // If no description provided, fall back to the stored branch context
        // (set automatically by `codeprism sync --event-type checkout` via git hook).
        let autoContextNote = "";
        let effectiveDescription = description ?? "";

        if (!effectiveDescription.trim()) {
          const ctx = getActiveContext();
          if (ctx) {
            effectiveDescription = buildContextQuery(ctx);
            autoContextNote =
              `> **Auto-context from branch \`${ctx.branch}\`**` +
              (ctx.ticketId ? ` · ticket \`${ctx.ticketId}\`` : "") +
              (ctx.epicBranch ? ` · epic \`${ctx.epicBranch}\`` : "") +
              `\n\n`;
          }
        }

        if (!effectiveDescription.trim()) {
          return {
            content: [{
              type: "text" as const,
              text: "No description provided and no active branch context found.\nCheckout a branch or provide a description.",
            }],
          };
        }

        const cleaned = effectiveDescription
          .replace(/https?:\/\/\S+/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 1000);

        const contextSessionId = randomUUID();
        const devEmail = getDevEmail();
        const hydeQuery = await buildHydeQuery(cleaned);
        const { results: primaryResults } = await searchAndTrack(hydeQuery, branch, 10, contextSessionId, devEmail);

        const entities = extractEntityNames(effectiveDescription);
        const seenIds = new Set(primaryResults.map((r) => r.card.id));
        const allSearchResults: SearchResult[] = [...primaryResults];

        for (const entity of entities.slice(0, 3)) {
          const { results: entityResults } = await searchAndTrack(entity, branch, 4, contextSessionId, devEmail);
          for (const r of entityResults) {
            if (!seenIds.has(r.card.id)) {
              seenIds.add(r.card.id);
              allSearchResults.push({ ...r, score: r.score * 0.8 });
            }
          }
        }

        if (allSearchResults.length === 0) {
          return { content: [{ type: "text" as const, text: "No relevant context found for this task." }] };
        }

        const reranked = await crossEncoderRerank(hydeQuery, allSearchResults, 8);
        const capped = reranked.map((r) => r.card) as CardSummary[];

        const flows = [...new Set(capped.map((c) => c.flow))];
        const allFiles = new Set<string>();
        for (const c of capped) {
          safeParseJsonArray(c.source_files).slice(0, 10).forEach((f) => allFiles.add(shortenPath(f)));
        }

        const summary =
          `## codeprism Context\n\n` +
          autoContextNote +
          `**Entities:** ${entities.length > 0 ? entities.join(", ") : "(none extracted)"}\n` +
          `**Flows:** ${flows.join(", ")}\n` +
          `**Key files (${allFiles.size}):**\n${[...allFiles].slice(0, 20).map((f) => `- ${f}`).join("\n")}\n\n` +
          `---\n\n` +
          formatCards(capped, undefined, hydeQuery);

        return { content: [{ type: "text" as const, text: summary }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Context error: ${message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "codeprism_ticket_files",
    {
      description:
        "Returns the files most likely to need edits for a given task. " +
        "Use after codeprism_context to narrow down to specific files.",
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
          for (const f of safeParseJsonArray(r.card.source_files)) {
            fileScores.set(f, (fileScores.get(f) || 0) + r.score);
          }
        }

        const sorted = [...fileScores.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20);

        if (sorted.length === 0) {
          return { content: [{ type: "text" as const, text: "No files identified for this task." }] };
        }

        const lines = sorted.map(
          ([path, score]) => `- ${shortenPath(path)} (relevance: ${score.toFixed(2)})`,
        );

        return {
          content: [{ type: "text" as const, text: `**Files likely relevant (${sorted.length}):**\n\n${lines.join("\n")}` }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );
}
