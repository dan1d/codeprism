import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb } from "../db/connection.js";

/**
 * Registers all codeprism MCP resources on the given server instance.
 */
export function registerResources(server: McpServer): void {
  server.registerResource(
    "codeprism-stats",
    "codeprism://stats",
    {
      description:
        "Current codeprism engine statistics: total cards, total flows, " +
        "total queries, and cache hit rate.",
      mimeType: "application/json",
    },
    async (uri) => {
      const db = getDb();

      const { totalCards } = db
        .prepare("SELECT COUNT(*) as totalCards FROM cards WHERE stale = 0")
        .get() as { totalCards: number };

      const { totalFlows } = db
        .prepare(
          "SELECT COUNT(DISTINCT flow) as totalFlows FROM cards WHERE stale = 0",
        )
        .get() as { totalFlows: number };

      const { totalQueries } = db
        .prepare("SELECT COUNT(*) as totalQueries FROM metrics")
        .get() as { totalQueries: number };

      const cacheRow = db
        .prepare(
          "SELECT COUNT(*) as total, SUM(cache_hit) as hits FROM metrics",
        )
        .get() as { total: number; hits: number };

      const cacheHitRate =
        cacheRow.total > 0 ? (cacheRow.hits / cacheRow.total) * 100 : 0;

      const stats = {
        totalCards,
        totalFlows,
        totalQueries,
        cacheHitRate: Math.round(cacheHitRate * 100) / 100,
      };

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(stats, null, 2),
          },
        ],
      };
    },
  );
}
