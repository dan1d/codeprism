import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

import { getDb, closeAllDbs } from "./db/connection.js";
import { runMigrations } from "./db/migrations.js";
import { createMcpServer } from "./mcp/server.js";
import { registerDashboardRoutes } from "./metrics/dashboard-api.js";
import { warmReranker } from "./search/reranker.js";
import { startTelemetryReporter, stopTelemetryReporter } from "./telemetry/reporter.js";
import { startWatcher } from "./watcher/index.js";
import { loadWorkspaceConfig } from "./config/workspace-config.js";
import { getRegisteredRepos } from "./services/repos.js";
import { runAllBranchGC } from "./sync/branch-gc.js";
import { initTenantRegistry, closeTenantRegistry } from "./tenant/registry.js";
import { tenantMiddleware } from "./tenant/middleware.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerTenantRoutes } from "./routes/tenants.js";
import { registerBenchmarkRoutes } from "./routes/benchmarks.js";
import { registerGeneratedDocsRoutes } from "./routes/generated-docs.js";
import { closeCatalogDb } from "./services/catalog.js";
import { registerMiscRoutes } from "./routes/misc.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// In dev (tsx): serve from packages/dashboard/dist after `pnpm --filter dashboard build`
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
  // ── Database ─────────────────────────────────────────────────────────
  const db = getDb();
  runMigrations(db);

  // Seed instance_profile from env vars on first boot (no-op on subsequent starts)
  const companyName = process.env["CODEPRISM_COMPANY_NAME"] ?? "";
  const plan = process.env["CODEPRISM_PLAN"] ?? "self_hosted";
  db.prepare(
    "UPDATE instance_profile SET company_name = CASE WHEN company_name = '' THEN ? ELSE company_name END, plan = ? WHERE id = 1",
  ).run(companyName, plan);

  // ── Fastify ───────────────────────────────────────────────────────────
  const app = Fastify({ logger: true });

  const isMultiTenant = process.env["CODEPRISM_MULTI_TENANT"] === "true";
  const codeprismDomain = process.env["CODEPRISM_DOMAIN"];

  await app.register(cors, {
    origin: isMultiTenant && codeprismDomain
      ? [
          `https://${codeprismDomain}`,
          new RegExp(`^https://[^.]+\\.${codeprismDomain.replace(/\./g, "\\.")}$`),
        ]
      : true,
  });
  await app.register(rateLimit, { global: false });

  // ── Multi-tenancy ─────────────────────────────────────────────────────
  if (isMultiTenant) {
    initTenantRegistry();
    await app.register(registerTenantRoutes);
    await app.register(registerAuthRoutes);
  }
  await app.register(tenantMiddleware);

  // ── Feature routes ────────────────────────────────────────────────────
  await app.register(registerMiscRoutes);
  await app.register(registerBenchmarkRoutes);
  await app.register(registerGeneratedDocsRoutes);
  await registerDashboardRoutes(app);

  // ── MCP server ────────────────────────────────────────────────────────
  const mcp = await createMcpServer();
  await app.register(
    async (sub) => mcp.registerRoutes(sub),
    { prefix: "/mcp" },
  );

  // ── Dashboard static files (SPA catch-all — must be last) ────────────
  app.get("/*", async (request, reply) => {
    const urlPath = request.url === "/" ? "/index.html" : request.url;
    const filePath = join(DASHBOARD_DIR, urlPath);

    if (!filePath.startsWith(DASHBOARD_DIR)) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    try {
      const info = await stat(filePath);
      if (!info.isFile()) return reply.code(404).send({ error: "Not found" });

      const content = await readFile(filePath);
      const mime = MIME_TYPES[extname(filePath)] ?? "application/octet-stream";
      return reply.type(mime).send(content);
    } catch {
      // SPA fallback: serve index.html for unmatched client-side routes
      try {
        const index = await readFile(join(DASHBOARD_DIR, "index.html"));
        return reply.type("text/html").send(index);
      } catch {
        return reply.code(404).send({ error: "Dashboard not found" });
      }
    }
  });

  // ── Start ─────────────────────────────────────────────────────────────
  const port = Number(process.env["CODEPRISM_PORT"]) || 4000;
  const host = process.env["CODEPRISM_HOST"] ?? "0.0.0.0";

  await app.listen({ port, host });

  const cardCount = (getDb().prepare("SELECT COUNT(*) AS c FROM cards").get() as { c: number }).c;
  console.log(`[codeprism] Engine listening on http://${host}:${port}`);
  console.log(`[codeprism] Database ready – ${cardCount} cards indexed`);

  warmReranker();
  startTelemetryReporter();

  // ── File + git watcher ────────────────────────────────────────────────
  const workspaceRoot = process.env["CODEPRISM_WORKSPACE"] ?? process.cwd();
  let watchedRepos: Array<{ name: string; path: string }> = [];
  try {
    const cfg = loadWorkspaceConfig(workspaceRoot);
    watchedRepos = cfg.repos.map((r) => ({ name: r.name, path: r.path }));
  } catch { /* workspace config is optional */ }

  for (const extra of getRegisteredRepos()) {
    if (!watchedRepos.find((r) => r.name === extra.name)) watchedRepos.push(extra);
  }
  const stopWatcher = startWatcher(watchedRepos);

  // Branch GC on startup — runs async, does not block server startup
  void runAllBranchGC(new Map(watchedRepos.map((r) => [r.name, r.path])));

  // ── Graceful shutdown ─────────────────────────────────────────────────
  const shutdown = async (): Promise<void> => {
    console.log("[codeprism] Shutting down…");
    stopWatcher();
    stopTelemetryReporter();
    await app.close();
    closeTenantRegistry();
    closeCatalogDb();
    closeAllDbs();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[codeprism] Fatal startup error:", err);
  process.exit(1);
});
