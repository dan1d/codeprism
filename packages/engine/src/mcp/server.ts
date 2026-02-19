import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { FastifyInstance } from "fastify";
import { registerTools } from "./tools.js";
import { registerResources } from "./resources.js";

interface SseSession {
  transport: SSEServerTransport;
  server: McpServer;
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
        "srcmap is a code context engine. Use srcmap_search to find " +
        "knowledge cards about the codebase, srcmap_save_insight to " +
        "capture new insights, and srcmap_list_flows to discover " +
        "documented topics.",
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
      app.get("/sse", async (_req, reply) => {
        reply.hijack();

        const server = buildServer();
        const transport = new SSEServerTransport(
          "/mcp/messages",
          reply.raw,
        );

        sessions.set(transport.sessionId, { transport, server });

        reply.raw.on("close", () => {
          sessions.delete(transport.sessionId);
          server.close().catch(() => {});
        });

        await server.connect(transport);
      });

      app.post("/messages", async (req, reply) => {
        const sessionId = (req.query as Record<string, string>).sessionId;
        const session = sessionId ? sessions.get(sessionId) : undefined;

        if (!session) {
          reply.code(404).send({ error: "Unknown or expired session" });
          return;
        }

        reply.hijack();
        await session.transport.handlePostMessage(
          req.raw,
          reply.raw,
          req.body,
        );
      });
    },

    activeSessions() {
      return sessions.size;
    },
  };
}
