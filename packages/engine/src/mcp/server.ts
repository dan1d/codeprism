import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { FastifyInstance } from "fastify";
import { registerTools } from "./tools/index.js";
import { registerResources } from "./resources.js";
import { runWithTenantDb } from "../db/connection.js";
import { runWithDevEmail } from "./dev-context.js";

interface SseSession {
  transport: SSEServerTransport;
  server: McpServer;
  tenant?: string;
  devEmail?: string;
}

const sessions = new Map<string, SseSession>();

/**
 * Build a fully-configured McpServer with all tools and resources registered.
 * Each SSE connection gets its own server instance because the low-level
 * protocol binds 1:1 to a transport.
 */
function buildServer(): McpServer {
  const server = new McpServer(
    { name: "srcmap", version: "0.1.0" },
    {
      instructions:
        "srcmap is a code context engine. Use srcmap_search to find knowledge cards about the codebase, " +
        "srcmap_save_insight to capture new insights, and srcmap_list_flows to discover documented topics.\n\n" +
        "PROACTIVE USAGE GUIDELINES:\n" +
        "1. ALWAYS call srcmap_context or srcmap_search FIRST when starting work on any ticket or task.\n" +
        "2. Call srcmap_list_flows to understand the app's structure before diving into implementation.\n" +
        "3. After discovering a non-obvious pattern, architectural decision, or business rule, " +
        "PROACTIVELY call srcmap_save_insight to persist it — do NOT wait for the user to ask.\n" +
        "4. After using a card's information and confirming it's accurate, call srcmap_verify_card " +
        "to build confidence scores.\n" +
        "5. Call srcmap_recent_queries to avoid re-asking the same questions and to see what " +
        "context was previously retrieved.\n" +
        "6. When a card's information contradicts what you find in the code, note this — the card " +
        "may be stale and needs re-indexing.\n\n" +
        "INSIGHT CATEGORIES — save insights for:\n" +
        "- Cross-service data flows you discover\n" +
        "- Business rules embedded in code\n" +
        "- Non-obvious gotchas or edge cases\n" +
        "- Architecture decisions and their rationale\n" +
        "- Bug root causes and their fixes",
    },
  );

  registerTools(server);
  registerResources(server);

  return server;
}

export interface McpContext {
  /**
   * Register the SSE and message-post routes on a Fastify instance.
   * Expected to be called inside `app.register(plugin, { prefix: '/mcp' })`
   * which produces:
   *   GET  /mcp/sse       – establishes the SSE stream
   *   POST /mcp/messages   – receives JSON-RPC messages from the client
   */
  registerRoutes(app: FastifyInstance): void;

  /** Number of active SSE sessions. */
  activeSessions(): number;
}

/**
 * Creates the srcmap MCP server context.
 *
 * Usage with Fastify:
 * ```ts
 * const mcp = await createMcpServer();
 * app.register(
 *   async (sub) => mcp.registerRoutes(sub),
 *   { prefix: "/mcp" },
 * );
 * ```
 */
export async function createMcpServer(): Promise<McpContext> {
  return {
    registerRoutes(app) {
      app.get("/sse", async (req, reply) => {
        reply.hijack();

        const server = buildServer();
        const transport = new SSEServerTransport(
          "/mcp/messages",
          reply.raw,
        );

        const devEmailHeader = req.headers["x-dev-email"];
        const devEmail = typeof devEmailHeader === "string" && devEmailHeader.includes("@")
          ? devEmailHeader.trim().toLowerCase()
          : undefined;

        sessions.set(transport.sessionId, {
          transport,
          server,
          tenant: req.tenant,
          devEmail,
        });

        reply.raw.on("close", () => {
          sessions.delete(transport.sessionId);
          server.close().catch(() => {});
        });

        const connectFn = () => runWithDevEmail(devEmail, () => server.connect(transport));
        if (req.tenant) {
          await runWithTenantDb(req.tenant, connectFn);
        } else {
          await connectFn();
        }
      });

      app.post("/messages", async (req, reply) => {
        const sessionId = (req.query as Record<string, string>).sessionId;
        const session = sessionId ? sessions.get(sessionId) : undefined;

        if (!session) {
          reply.code(404).send({ error: "Unknown or expired session" });
          return;
        }

        reply.hijack();
        const handle = () =>
          runWithDevEmail(session.devEmail, () =>
            session.transport.handlePostMessage(req.raw, reply.raw, req.body),
          );

        if (session.tenant) {
          await runWithTenantDb(session.tenant, handle);
        } else {
          await handle();
        }
      });
    },

    activeSessions() {
      return sessions.size;
    },
  };
}
