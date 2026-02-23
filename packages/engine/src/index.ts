import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { readFile, stat, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

import { getDb, closeAllDbs, closeTenantDb, getDataDir } from "./db/connection.js";
import { runMigrations } from "./db/migrations.js";
import { handleSync } from "./sync/receiver.js";
import type { SyncPayload } from "./sync/receiver.js";
import { createMcpServer } from "./mcp/server.js";
import { registerDashboardRoutes } from "./metrics/dashboard-api.js";
import { warmReranker } from "./search/reranker.js";
import { startTelemetryReporter, stopTelemetryReporter } from "./telemetry/reporter.js";
import { startWatcher } from "./watcher/index.js";
import { loadWorkspaceConfig } from "./config/workspace-config.js";
import { getRegisteredRepos } from "./services/repos.js";
import { runAllBranchGC } from "./sync/branch-gc.js";
import { initTenantRegistry, closeTenantRegistry, createTenant, listTenants, deleteTenant, rotateApiKey } from "./tenant/registry.js";
import { tenantMiddleware } from "./tenant/middleware.js";
import { receiveTelemetry } from "./telemetry/receiver.js";
import { getAggregateStats } from "./telemetry/receiver.js";

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

  const isMultiTenant = process.env["SRCMAP_MULTI_TENANT"] === "true";
  const srcmapDomain = process.env["SRCMAP_DOMAIN"];

  await app.register(cors, {
    origin: isMultiTenant && srcmapDomain
      ? [`https://${srcmapDomain}`, `https://*.${srcmapDomain}`]
      : true,
  });

  await app.register(rateLimit, { global: false });

  // ── Multi-tenancy (opt-in via SRCMAP_MULTI_TENANT=true) ─────────
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
      { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const { name } = request.body ?? {};
        if (!name || typeof name !== "string" || name.trim().length < 2) {
          return reply
            .code(400)
            .send({ error: "name is required (min 2 characters)" });
        }
        try {
          const result = createTenant(name.trim());
          return reply.code(201).send({
            slug: result.slug,
            name: result.name,
            apiKey: result.apiKey,
            mcpUrl: `${request.protocol}://${request.hostname}/${result.slug}/mcp`,
            dashboardUrl: `${request.protocol}://${request.hostname}/${result.slug}/`,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return reply.code(409).send({ error: message });
        }
      },
    );

    app.get("/api/tenants", async (_request, reply) => {
      return reply.send(listTenants());
    });

    app.delete<{ Params: { slug: string } }>(
      "/api/tenants/:slug",
      async (request, reply) => {
        const slug = request.params.slug;
        closeTenantDb(slug);
        const deleted = deleteTenant(slug);
        if (!deleted)
          return reply.code(404).send({ error: "Tenant not found" });

        const dbPath = join(getDataDir(), "tenants", `${slug}.db`);
        for (const ext of ["", "-wal", "-shm"]) {
          await unlink(dbPath + ext).catch(() => {});
        }

        return reply.send({ deleted: slug });
      },
    );

    app.post<{ Params: { slug: string } }>(
      "/api/tenants/:slug/rotate-key",
      async (request, reply) => {
        const newKey = rotateApiKey(request.params.slug);
        if (!newKey) return reply.code(404).send({ error: "Tenant not found" });
        return reply.send({ slug: request.params.slug, apiKey: newKey });
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
    const healthDb = getDb();
    const cardsRow = healthDb
      .prepare("SELECT COUNT(*) AS count FROM cards")
      .get() as { count: number };
    const flowsRow = healthDb
      .prepare("SELECT COUNT(DISTINCT flow) AS count FROM cards")
      .get() as { count: number };

    return reply.send({
      status: "ok",
      cards: cardsRow.count,
      flows: flowsRow.count,
    });
  });

  app.post<{ Body: unknown }>(
    "/api/telemetry",
    { bodyLimit: 16_384 },
    async (request, reply) => {
      const body = request.body as Record<string, unknown> | undefined;
      if (
        !body ||
        typeof body !== "object" ||
        typeof body.instance_id !== "string" ||
        !body.stats ||
        typeof body.stats !== "object"
      ) {
        return reply.code(400).send({ error: "Invalid telemetry payload" });
      }
      try {
        receiveTelemetry(body as Parameters<typeof receiveTelemetry>[0]);
        return reply.send({ ok: true });
      } catch {
        return reply.send({ ok: true });
      }
    },
  );

  app.get("/api/public-stats", async (_request, reply) => {
    try {
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
    getDb().prepare("SELECT COUNT(*) AS c FROM cards").get() as { c: number }
  ).c;
  console.log(`[srcmap] Engine listening on http://${host}:${port}`);
  console.log(`[srcmap] Database ready – ${cardCount} cards indexed`);

  // Pre-load the cross-encoder model so the first query has no cold-start latency
  warmReranker();

  // Start opt-in telemetry reporter
  startTelemetryReporter();

  // ── Automatic file + git watcher (zero CLI required) ──────────────
  // Collects repos from workspace config + any UI-registered repos.
  // Watches source files for code changes and .git/ for branch/merge events.
  const workspaceRoot = process.env["SRCMAP_WORKSPACE"] ?? process.cwd();
  let watchedRepos: Array<{ name: string; path: string }> = [];
  try {
    const cfg = loadWorkspaceConfig(workspaceRoot);
    watchedRepos = cfg.repos.map((r) => ({ name: r.name, path: r.path }));
  } catch { /* workspace config optional */ }
  // Merge in any UI-registered repos
  for (const extra of getRegisteredRepos()) {
    if (!watchedRepos.find((r) => r.name === extra.name)) {
      watchedRepos.push(extra);
    }
  }
  const stopWatcher = startWatcher(watchedRepos);

  // Run branch GC on startup to purge orphaned data from deleted branches
  // (branches merged/deleted while the server was offline are cleaned up here)
  setImmediate(() => {
    const repoMap = new Map(watchedRepos.map((r) => [r.name, r.path]));
    runAllBranchGC(repoMap);
  });

  // ── Graceful shutdown ──────────────────────────────────────────────

  const shutdown = async (): Promise<void> => {
    console.log("[srcmap] Shutting down…");
    stopWatcher();
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
