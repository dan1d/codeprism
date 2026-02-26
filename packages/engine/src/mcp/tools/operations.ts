import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getRecentQueries } from "../../services/search.js";
import { invalidateSearchConfig } from "../../services/search.js";
import {
  listSearchConfig,
  getSearchConfigEntry,
  setSearchConfigEntry,
} from "../../services/instance.js";
import { getWorkspaceStatus } from "../../services/repos.js";
import { getStaleCardCount, runIncrementalReindex, reindexState } from "../../services/reindex.js";

export function registerOperationsTools(server: McpServer): void {
  server.registerTool(
    "codeprism_recent_queries",
    {
      title: "View Recent Queries",
      description:
        "Returns recent search queries and which cards they matched.",
      annotations: { readOnlyHint: true, idempotentHint: true },
      inputSchema: {
        limit: z.number().optional().describe("Max queries to return (default 10)"),
      },
    },
    async ({ limit }) => {
      try {
        const rows = getRecentQueries(limit ?? 10);

        if (rows.length === 0) {
          return { content: [{ type: "text" as const, text: "No recent queries found." }] };
        }

        const lines = rows.map((r) => {
          const titles = r.cardTitles
            ? r.cardTitles.split(",").slice(0, 3).join(", ")
            : "no matches";
          return `- **"${r.query}"** \u2192 ${r.matchedCards} card(s) [${titles}] (${r.lastAsked})`;
        });

        return {
          content: [{ type: "text" as const, text: `**Recent queries (${rows.length}):**\n\n${lines.join("\n")}` }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Query history error: ${message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "codeprism_configure",
    {
      title: "Configure Search Settings",
      description: "View or modify codeprism search configuration.",
      annotations: { readOnlyHint: false, idempotentHint: true },
      inputSchema: {
        action: z.enum(["get", "set", "list"]).describe("Action to perform"),
        key: z.string().optional().describe("Config key"),
        value: z.string().optional().describe("New value for the key"),
      },
    },
    async ({ action, key, value }) => {
      try {
        if (action === "list") {
          const rows = listSearchConfig();
          if (rows.length === 0) {
            return { content: [{ type: "text" as const, text: "No custom configuration set. Using defaults." }] };
          }
          const lines = rows.map((r) => `- **${r.key}**: ${r.value} (updated: ${r.updatedAt})`);
          return { content: [{ type: "text" as const, text: `**Search config:**\n\n${lines.join("\n")}` }] };
        }

        if (action === "get") {
          if (!key) return { content: [{ type: "text" as const, text: "Error: 'key' is required for 'get'" }], isError: true };
          const val = getSearchConfigEntry(key);
          return {
            content: [{ type: "text" as const, text: val !== undefined ? `**${key}**: ${val}` : `Key "${key}" not found. Using default.` }],
          };
        }

        if (action === "set") {
          if (!key || value === undefined) {
            return { content: [{ type: "text" as const, text: "Error: 'key' and 'value' are required for 'set'" }], isError: true };
          }
          setSearchConfigEntry(key, value);
          invalidateSearchConfig();
          return { content: [{ type: "text" as const, text: `Set **${key}** = ${value}` }] };
        }

        return { content: [{ type: "text" as const, text: `Unknown action: ${action}` }], isError: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Config error: ${message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "codeprism_workspace_status",
    {
      title: "View Workspace Status",
      description:
        "Returns a real-time status of the codeprism knowledge base.",
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      try {
        const status = getWorkspaceStatus();
        const lines: string[] = ["## codeprism Workspace Status\n"];

        for (const repo of status.repos) {
          lines.push(`### ${repo.repo}`);
          lines.push(`- **Stack:** ${repo.stack}${repo.skillIds.length ? ` (${repo.skillIds.join(", ")})` : ""}`);
          lines.push(`- **Cards:** ${repo.totalCards} total, ${repo.staleCards} stale`);
          if (repo.lastCommit) lines.push(`- **Last indexed commit:** ${repo.lastCommit.slice(0, 8)}`);
          if (repo.staleDocTypes.length) lines.push(`- **Stale docs:** ${repo.staleDocTypes.join(", ")}`);
          lines.push("");
        }

        if (status.crossRepoEdges.length > 0) {
          lines.push("### Cross-Repo Connections");
          for (const edge of status.crossRepoEdges) lines.push(`- **${edge.sourceRepo}**: ${edge.edgeCount} api_endpoint edge(s)`);
          lines.push("");
        }

        lines.push(`**Total stale cards:** ${status.totalStale}`);
        if (status.totalStale > 0) lines.push("\n> Run `codeprism_reindex` or `POST /api/reindex-stale` to refresh stale cards.");

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Status error: ${message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "codeprism_reindex",
    {
      title: "Reindex Stale Cards",
      description: "Triggers incremental reindex of stale cards only.",
      annotations: { readOnlyHint: false, idempotentHint: true },
      inputSchema: {
        repo: z.string().optional().describe("Limit reindex to a specific repo."),
      },
    },
    async ({ repo }) => {
      try {
        if (reindexState.status === "running") {
          return {
            content: [{
              type: "text" as const,
              text: `Reindex already in progress (started ${reindexState.startedAt}). Check \`codeprism_workspace_status\` for progress.`,
            }],
          };
        }

        const staleCount = getStaleCardCount(repo);

        if (staleCount === 0) {
          return { content: [{ type: "text" as const, text: "No stale cards found. Knowledge base is up to date." }] };
        }

        runIncrementalReindex(repo);

        return {
          content: [{
            type: "text" as const,
            text:
              `Reindex started for ${staleCount} stale card(s)${repo ? ` in \`${repo}\`` : ""}.\n` +
              `Use \`codeprism_workspace_status\` to check progress.`,
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Reindex error: ${message}` }], isError: true };
      }
    },
  );
}
