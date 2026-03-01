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
    { name: "codeprism", version: "0.1.0" },
    {
      instructions:
        "codeprism is your team's shared architectural memory — a persistent knowledge base that " +
        "works across every AI tool your team uses (Cursor, Claude Code, Windsurf, Zed, and any " +
        "MCP-compatible client). When one developer discovers how a flow works, that knowledge is " +
        "instantly available to every other developer, in every tool, forever.\n\n" +
        "PROACTIVE USAGE GUIDELINES:\n" +
        "1. ALWAYS call codeprism_context or codeprism_search FIRST when starting work on any ticket or task. " +
        "Another team member may have already mapped this exact area — don't re-discover what's already known.\n" +
        "2. Call codeprism_list_flows to get a map of what the team has documented before diving into implementation.\n" +
        "3. After discovering a non-obvious pattern, architectural decision, or business rule, " +
        "PROACTIVELY call codeprism_save_insight to persist it for the whole team — do NOT wait for the user to ask. " +
        "Every insight you save makes every developer's AI session smarter going forward.\n" +
        "4. After using a card's information and confirming it's accurate, call codeprism_verify_card " +
        "to build the team's confidence in that knowledge over time.\n" +
        "5. Call codeprism_recent_queries to see what context other team members have already retrieved — " +
        "avoid re-asking questions your colleagues have already answered.\n" +
        "6. When a card's information contradicts what you find in the code, note this — the card " +
        "may be stale and needs re-indexing.\n\n" +
        "SAVE INSIGHTS FOR (these compound in value over time):\n" +
        "- Cross-service data flows you discover\n" +
        "- Business rules embedded in code\n" +
        "- Non-obvious gotchas or edge cases\n" +
        "- Architecture decisions and their rationale\n" +
        "- Bug root causes and their fixes\n" +
        "- Patterns that differ from what the code name suggests",
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
 * Creates the codeprism MCP server context.
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

        // TTL: remove the session after 4 h regardless of TCP close event.
        // 30 min was too short for active multi-hour development sessions.
        // This prevents proxy/LB timeouts from leaking sessions indefinitely.
        const SESSION_TTL_MS = 4 * 60 * 60 * 1_000;
        const ttlTimer = setTimeout(() => {
          sessions.delete(transport.sessionId);
          server.close().catch(() => {});
        }, SESSION_TTL_MS);

        reply.raw.on("close", () => {
          clearTimeout(ttlTimer);
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

        // Tenant ownership check: the session must belong to the same tenant
        // that authenticated this request. Without this, Tenant B could pass
        // Tenant A's sessionId and read their knowledge cards.
        if (session.tenant !== req.tenant) {
          reply.code(403).send({ error: "Session does not belong to this tenant" });
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
