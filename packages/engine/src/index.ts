import Fastify from "fastify";
import cors from "@fastify/cors";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

import { getDb, closeAllDbs } from "./db/connection.js";
import { runMigrations } from "./db/migrations.js";
import { handleSync } from "./sync/receiver.js";
import type { SyncPayload } from "./sync/receiver.js";
import { createMcpServer } from "./mcp/server.js";
import { registerDashboardRoutes } from "./metrics/dashboard-api.js";
import { warmReranker } from "./search/reranker.js";
import { startTelemetryReporter, stopTelemetryReporter } from "./telemetry/reporter.js";
import { initTenantRegistry, closeTenantRegistry } from "./tenant/registry.js";
import { tenantMiddleware } from "./tenant/middleware.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// In dev (ts-node/tsx): serve from packages/dashboard/dist after `pnpm --filter dashboard build`
// In Docker: COPY copies packages/dashboard/dist to the same relative location
const DASHBOARD_DIR = join(__dirname, "../../dashboard/dist");

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

  // Seed instance_profile from env vars on first boot (no-op on subsequent starts)
  const companyName = process.env["SRCMAP_COMPANY_NAME"] ?? "";
  const plan = process.env["SRCMAP_PLAN"] ?? "self_hosted";
  db.prepare(
    "UPDATE instance_profile SET company_name = CASE WHEN company_name = '' THEN ? ELSE company_name END, plan = ? WHERE id = 1",
  ).run(companyName, plan);

  // ── Fastify ────────────────────────────────────────────────────────
  const app = Fastify({ logger: true });
  await app.register(cors);

  // ── Multi-tenancy (opt-in via SRCMAP_MULTI_TENANT=true) ─────────
  const isMultiTenant = process.env["SRCMAP_MULTI_TENANT"] === "true";
  if (isMultiTenant) {
    initTenantRegistry();
  }
  await app.register(tenantMiddleware);

  // ── API routes ─────────────────────────────────────────────────────

  app.post<{ Body: SyncPayload }>("/api/sync", async (request, reply) => {
    const result = await handleSync(request.body);
    return reply.send(result);
  });

  if (isMultiTenant) {
    app.post<{ Body: { name: string } }>(
      "/api/tenants",
      async (request, reply) => {
        const { name } = request.body ?? {};
        if (!name || typeof name !== "string" || name.trim().length < 2) {
          return reply
            .code(400)
            .send({ error: "name is required (min 2 characters)" });
        }
        try {
          const { createTenant } = await import("./tenant/registry.js");
          const { getTenantDb } = await import("./db/connection.js");
          const tenant = createTenant(name.trim());
          getTenantDb(tenant.slug); // lazy-provisions DB + runs migrations
          return reply.code(201).send({
            slug: tenant.slug,
            name: tenant.name,
            apiKey: tenant.api_key,
            mcpUrl: `${request.protocol}://${request.hostname}/${tenant.slug}/mcp`,
            dashboardUrl: `${request.protocol}://${request.hostname}/${tenant.slug}/`,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return reply.code(409).send({ error: message });
        }
      },
    );

    app.get("/api/tenants", async (_request, reply) => {
      const { listTenants } = await import("./tenant/registry.js");
      return reply.send(listTenants());
    });

    app.delete<{ Params: { slug: string } }>(
      "/api/tenants/:slug",
      async (request, reply) => {
        const { deleteTenant } = await import("./tenant/registry.js");
        const { closeTenantDb } = await import("./db/connection.js");
        closeTenantDb(request.params.slug);
        const deleted = deleteTenant(request.params.slug);
        if (!deleted)
          return reply.code(404).send({ error: "Tenant not found" });
        return reply.send({ deleted: request.params.slug });
      },
    );
  }

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

  app.post<{ Body: unknown }>("/api/telemetry", async (request, reply) => {
    const body = request.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== "object" || !body.instance_id || !body.stats) {
      return reply.code(400).send({ error: "Invalid telemetry payload" });
    }
    try {
      const { receiveTelemetry } = await import("./telemetry/receiver.js");
      receiveTelemetry(body as Parameters<typeof receiveTelemetry>[0]);
      return reply.send({ ok: true });
    } catch {
      return reply.send({ ok: true });
    }
  });

  app.get("/api/public-stats", async (_request, reply) => {
    try {
      const { getAggregateStats } = await import("./telemetry/receiver.js");
      return reply.send(getAggregateStats());
    } catch {
      return reply.send({
        activeInstances: 0,
        totalTokensSaved: 0,
        totalQueries: 0,
        totalCards: 0,
        avgCacheHitRate: 0,
      });
    }
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

  // Start opt-in telemetry reporter
  startTelemetryReporter();

  // ── Graceful shutdown ──────────────────────────────────────────────

  const shutdown = async (): Promise<void> => {
    console.log("[srcmap] Shutting down…");
    stopTelemetryReporter();
    await app.close();
    closeTenantRegistry();
    closeAllDbs();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[srcmap] Fatal startup error:", err);
  process.exit(1);
});
