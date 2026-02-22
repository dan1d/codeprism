import Fastify from "fastify";
import cors from "@fastify/cors";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

import { getDb, closeDb } from "./db/connection.js";
import { runMigrations } from "./db/migrations.js";
import { handleSync } from "./sync/receiver.js";
import type { SyncPayload } from "./sync/receiver.js";
import { createMcpServer } from "./mcp/server.js";
import { registerDashboardRoutes } from "./metrics/dashboard-api.js";
import { warmReranker } from "./search/reranker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DASHBOARD_DIR = join(__dirname, "../../dashboard");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

async function main(): Promise<void> {
  // ── Database ───────────────────────────────────────────────────────
  const db = getDb();
  runMigrations(db);

  // ── Fastify ────────────────────────────────────────────────────────
  const app = Fastify({ logger: true });
  await app.register(cors);

  // ── API routes ─────────────────────────────────────────────────────

  app.post<{ Body: SyncPayload }>("/api/sync", async (request, reply) => {
    const result = await handleSync(request.body);
    return reply.send(result);
  });

  await registerDashboardRoutes(app);

  const mcp = await createMcpServer();
  await app.register(
    async (sub) => mcp.registerRoutes(sub),
    { prefix: "/mcp" },
  );

  app.get("/api/health", async (_request, reply) => {
    const cardsRow = db
      .prepare("SELECT COUNT(*) AS count FROM cards")
      .get() as { count: number };
    const flowsRow = db
      .prepare("SELECT COUNT(DISTINCT flow) AS count FROM cards")
      .get() as { count: number };

    return reply.send({
      status: "ok",
      cards: cardsRow.count,
      flows: flowsRow.count,
    });
  });

  // ── Dashboard static files ─────────────────────────────────────────

  app.get("/*", async (request, reply) => {
    const urlPath = request.url === "/" ? "/index.html" : request.url;
    const filePath = join(DASHBOARD_DIR, urlPath);

    if (!filePath.startsWith(DASHBOARD_DIR)) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    try {
      const info = await stat(filePath);
      if (!info.isFile()) {
        return reply.code(404).send({ error: "Not found" });
      }

      const content = await readFile(filePath);
      const mime = MIME_TYPES[extname(filePath)] ?? "application/octet-stream";
      return reply.type(mime).send(content);
    } catch {
      // SPA fallback: serve index.html for unmatched paths
      try {
        const index = await readFile(join(DASHBOARD_DIR, "index.html"));
        return reply.type("text/html").send(index);
      } catch {
        return reply.code(404).send({ error: "Dashboard not found" });
      }
    }
  });

  // ── Start ──────────────────────────────────────────────────────────

  const port = Number(process.env["SRCMAP_PORT"]) || 4000;
  const host = process.env["SRCMAP_HOST"] ?? "0.0.0.0";

  await app.listen({ port, host });

  const cardCount = (
    db.prepare("SELECT COUNT(*) AS c FROM cards").get() as { c: number }
  ).c;
  console.log(`[srcmap] Engine listening on http://${host}:${port}`);
  console.log(`[srcmap] Database ready – ${cardCount} cards indexed`);

  // Pre-load the cross-encoder model so the first query has no cold-start latency
  warmReranker();

  // ── Graceful shutdown ──────────────────────────────────────────────

  const shutdown = async (): Promise<void> => {
    console.log("[srcmap] Shutting down…");
    await app.close();
    closeDb();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[srcmap] Fatal startup error:", err);
  process.exit(1);
});
