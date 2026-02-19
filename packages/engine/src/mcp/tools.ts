import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb } from "../db/connection.js";
import type { Card } from "../db/schema.js";

/**
 * Registers all srcmap MCP tools on the given server instance.
 * Each tool interacts with the local SQLite database via `getDb()`.
 */
export function registerTools(server: McpServer): void {
  server.registerTool(
    "srcmap_search",
    {
      description:
        "Search srcmap knowledge cards using hybrid search (FTS + vector). " +
        "Returns matching cards with their content, flow, and source files.",
      inputSchema: {
        query: z.string().describe("The search query string"),
        branch: z
          .string()
          .optional()
          .describe("Optional branch name to scope results"),
      },
    },
    async ({ query, branch }) => {
      const db = getDb();

      try {
        let sql = `
          SELECT c.id, c.flow, c.title, c.content, c.source_files, c.card_type
          FROM cards_fts fts
          JOIN cards c ON c.rowid = fts.rowid
          WHERE cards_fts MATCH ?
            AND c.stale = 0
        `;
        const params: unknown[] = [query];

        if (branch) {
          sql +=
            " AND (c.valid_branches IS NULL OR c.valid_branches LIKE ?)";
          params.push(`%${branch}%`);
        }

        sql += " ORDER BY rank LIMIT 10";

        type SearchRow = Pick<
          Card,
          "id" | "flow" | "title" | "content" | "source_files" | "card_type"
        >;
        const rows = db.prepare(sql).all(...params) as SearchRow[];

        if (rows.length === 0) {
          return {
            content: [
              { type: "text" as const, text: `No cards found for: "${query}"` },
            ],
          };
        }

        const formatted = rows
          .map(
            (r, i) =>
              `### ${i + 1}. ${r.title}\n` +
              `**Flow:** ${r.flow} | **Type:** ${r.card_type}\n` +
              `**Files:** ${r.source_files}\n\n${r.content}`,
          )
          .join("\n\n---\n\n");

        return {
          content: [
            {
              type: "text" as const,
              text: `Found ${rows.length} card(s) for "${query}":\n\n${formatted}`,
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
    "srcmap_save_insight",
    {
      description:
        "Save a developer-contributed knowledge card to the srcmap database. " +
        "Use this to capture architectural insights, design decisions, or " +
        "important code context discovered during development.",
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
        "List all unique flows in the srcmap knowledge base with their card counts. " +
        "Useful for discovering what topics and areas are documented.",
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
