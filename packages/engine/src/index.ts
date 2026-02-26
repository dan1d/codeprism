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
import { initTenantRegistry, closeTenantRegistry, createTenant, listTenants, deleteTenant, rotateApiKey, getTenantBySlug, getTenantCount } from "./tenant/registry.js";
import { tenantMiddleware } from "./tenant/middleware.js";
import { receiveTelemetry } from "./telemetry/receiver.js";
import { getAggregateStats } from "./telemetry/receiver.js";
import { createMagicLink, verifyMagicLink, ensureUser, createSession, validateSession, destroySession } from "./services/auth.js";
import { inviteMembers, listMembers, activateMember, deactivateMember, getActiveSeatCount } from "./services/members.js";
import { sendMagicLinkEmail, sendInvitationEmail } from "./services/email.js";
import { submitBenchmark as submitBenchmarkJob, getQueueStatus, getFileCountCap, getBenchmarkProject, openBenchmarkDb, type LLMConfig } from "./services/benchmark-worker.js";

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
  const companyName = process.env["CODEPRISM_COMPANY_NAME"] ?? "";
  const plan = process.env["CODEPRISM_PLAN"] ?? "self_hosted";
  db.prepare(
    "UPDATE instance_profile SET company_name = CASE WHEN company_name = '' THEN ? ELSE company_name END, plan = ? WHERE id = 1",
  ).run(companyName, plan);

  // ── Fastify ────────────────────────────────────────────────────────
  const app = Fastify({ logger: true });

  const isMultiTenant = process.env["CODEPRISM_MULTI_TENANT"] === "true";
  const codeprismDomain = process.env["CODEPRISM_DOMAIN"];

  await app.register(cors, {
    origin: isMultiTenant && codeprismDomain
      ? [`https://${codeprismDomain}`, `https://*.${codeprismDomain}`]
      : true,
  });

  await app.register(rateLimit, { global: false });

  // ── Multi-tenancy (opt-in via CODEPRISM_MULTI_TENANT=true) ─────────
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
    app.post<{ Body: { name: string; email?: string } }>(
      "/api/tenants",
      { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const { name, email } = request.body ?? {};
        if (!name || typeof name !== "string" || name.trim().length < 2) {
          return reply
            .code(400)
            .send({ error: "name is required (min 2 characters)" });
        }
        try {
          const result = createTenant(name.trim(), email?.trim());

          // Auto-register admin if email provided
          if (email?.trim()) {
            const user = ensureUser(email.trim());
            const { getRegistryDb_ } = await import("./tenant/registry.js");
            const rDb = getRegistryDb_();
            rDb.prepare(
              "INSERT OR IGNORE INTO team_members (user_id, tenant_slug, role, status, accepted_at) VALUES (?, ?, 'admin', 'active', datetime('now'))",
            ).run(user.id, result.slug);
          }

          return reply.code(201).send({
            slug: result.slug,
            name: result.name,
            apiKey: result.apiKey,
            mcpUrl: `${request.protocol}://${request.hostname}/${result.slug}/mcp/sse`,
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

  // ── Auth routes (public, multi-tenant only) ──────────────────────
  if (isMultiTenant) {
    app.post<{ Body: { email: string; tenant: string } }>(
      "/api/auth/magic-link",
      { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const { email, tenant: tenantSlug } = request.body ?? {};
        if (!email || !tenantSlug) {
          return reply.code(400).send({ error: "email and tenant are required" });
        }
        const tenant = getTenantBySlug(tenantSlug);
        if (!tenant) return reply.code(404).send({ error: "Tenant not found" });

        const token = createMagicLink(email.trim(), tenantSlug);
        await sendMagicLinkEmail(email.trim(), token, tenantSlug, tenant.name);
        return reply.send({ ok: true, message: "Check your email for a sign-in link." });
      },
    );

    app.post<{ Body: { token: string } }>(
      "/api/auth/verify",
      async (request, reply) => {
        const { token } = request.body ?? {};
        if (!token) return reply.code(400).send({ error: "token is required" });

        const result = verifyMagicLink(token);
        if (!result) return reply.code(401).send({ error: "Invalid or expired link" });

        const user = ensureUser(result.email);
        activateMember(user.id, result.tenantSlug);

        const sessionToken = createSession(user.id, result.tenantSlug);
        const tenant = getTenantBySlug(result.tenantSlug);

        return reply.send({
          sessionToken,
          user: { id: user.id, email: user.email, name: user.name },
          tenant: { slug: result.tenantSlug, name: tenant?.name ?? "" },
        });
      },
    );

    app.post("/api/auth/logout", async (request, reply) => {
      const sessionToken = (request.headers["x-session-token"] as string) ?? "";
      if (sessionToken) destroySession(sessionToken);
      return reply.send({ ok: true });
    });

    app.get("/api/auth/me", async (request, reply) => {
      const sessionToken = (request.headers["x-session-token"] as string) ?? "";
      const session = sessionToken ? validateSession(sessionToken) : null;
      if (!session) return reply.code(401).send({ error: "Not authenticated" });
      return reply.send(session);
    });

    // ── Member management routes ──────────────────────────────────
    app.get("/api/members", async (request, reply) => {
      const sessionToken = (request.headers["x-session-token"] as string) ?? "";
      const session = sessionToken ? validateSession(sessionToken) : null;
      if (!session) return reply.code(401).send({ error: "Not authenticated" });

      const members = listMembers(session.tenantSlug);
      const activeCount = getActiveSeatCount(session.tenantSlug);
      const tenant = getTenantBySlug(session.tenantSlug);

      return reply.send({
        members,
        activeCount,
        maxSeats: tenant?.max_seats ?? null,
      });
    });

    app.post<{ Body: { emails: string[] } }>(
      "/api/members/invite",
      async (request, reply) => {
        const sessionToken = (request.headers["x-session-token"] as string) ?? "";
        const session = sessionToken ? validateSession(sessionToken) : null;
        if (!session) return reply.code(401).send({ error: "Not authenticated" });
        if (session.role !== "admin") return reply.code(403).send({ error: "Admin access required" });

        const { emails } = request.body ?? {};
        if (!Array.isArray(emails) || emails.length === 0) {
          return reply.code(400).send({ error: "emails array is required" });
        }
        if (emails.length > 50) {
          return reply.code(400).send({ error: "Maximum 50 invitations at once" });
        }

        const tenant = getTenantBySlug(session.tenantSlug);
        const results = inviteMembers(emails, session.tenantSlug);

        // Send invitation emails in background
        for (const r of results) {
          if (!r.alreadyMember && r.token) {
            sendInvitationEmail(
              r.email, r.token, session.tenantSlug,
              tenant?.name ?? session.tenantSlug, session.email,
            ).catch((err) => console.warn(`[email] Failed to send invite to ${r.email}:`, err));
          }
        }

        const invited = results.filter((r) => !r.alreadyMember).length;
        const skipped = results.filter((r) => r.alreadyMember).length;
        return reply.code(201).send({ invited, skipped, details: results.map((r) => ({ email: r.email, alreadyMember: r.alreadyMember })) });
      },
    );

    app.delete<{ Params: { userId: string } }>(
      "/api/members/:userId",
      async (request, reply) => {
        const sessionToken = (request.headers["x-session-token"] as string) ?? "";
        const session = sessionToken ? validateSession(sessionToken) : null;
        if (!session) return reply.code(401).send({ error: "Not authenticated" });
        if (session.role !== "admin") return reply.code(403).send({ error: "Admin access required" });

        if (request.params.userId === session.userId) {
          return reply.code(400).send({ error: "Cannot deactivate yourself" });
        }

        const removed = deactivateMember(request.params.userId, session.tenantSlug);
        if (!removed) return reply.code(404).send({ error: "Member not found" });
        return reply.send({ deactivated: request.params.userId });
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
        receiveTelemetry(body as unknown as Parameters<typeof receiveTelemetry>[0]);
        return reply.send({ ok: true });
      } catch {
        return reply.send({ ok: true });
      }
    },
  );

  app.get("/api/founding-status", async (_request, reply) => {
    if (!isMultiTenant) return reply.send({ founding: false, remaining: 0, total: 0, limit: 100 });
    const count = getTenantCount();
    const limit = 100;
    return reply.send({
      founding: count < limit,
      remaining: Math.max(0, limit - count),
      total: count,
      limit,
    });
  });

  app.post<{ Body: { url: string; provider?: string; apiKey?: string } }>(
    "/api/benchmarks/submit",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { url, provider, apiKey } = request.body ?? {};
      if (!url || typeof url !== "string") {
        return reply.code(400).send({ queued: false, error: "url is required" });
      }

      const githubMatch = url.match(/github\.com\/([^/]+\/[^/]+)/);
      if (!githubMatch) {
        return reply.code(400).send({ queued: false, error: "Must be a valid GitHub repository URL" });
      }

      const validProviders = ["gemini", "openai", "deepseek", "anthropic"];
      let llmConfig: LLMConfig | undefined;
      if (apiKey && provider) {
        if (!validProviders.includes(provider)) {
          return reply.code(400).send({ queued: false, error: `Invalid provider. Must be one of: ${validProviders.join(", ")}` });
        }
        llmConfig = { provider: provider as LLMConfig["provider"], apiKey };
      }

      const result = await submitBenchmarkJob(url, llmConfig);
      const code = result.queued ? 202 : 200;
      return reply.code(code).send(result);
    },
  );

  app.get("/api/benchmarks/queue", async (_request, reply) => {
    return reply.send(getQueueStatus());
  });

  app.post<{ Body: { query: string; repo?: string } }>(
    "/api/benchmarks/sandbox",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { query, repo } = request.body ?? {};
      if (!query || typeof query !== "string" || query.trim().length < 3) {
        return reply.code(400).send({ error: "query is required (min 3 characters)" });
      }
      if (!repo) {
        return reply.code(400).send({ error: "repo is required" });
      }

      const db = openBenchmarkDb(repo);
      if (!db) {
        return reply.code(404).send({ error: "No indexed data found for this project. Submit it for benchmarking first." });
      }

      try {
        const start = Date.now();
        const searchTerm = query.trim().replace(/[^a-zA-Z0-9\s]/g, "");

        type CardRow = { id: string; title: string; flow: string; card_type: string; content: string; source_files: string };
        let cardRows: CardRow[] = [];
        try {
          cardRows = db
            .prepare("SELECT c.id, c.title, c.flow, c.card_type, c.content, c.source_files FROM cards_fts f JOIN cards c ON c.rowid = f.rowid WHERE cards_fts MATCH ? AND c.stale = 0 LIMIT 5")
            .all(searchTerm) as CardRow[];
        } catch { /* FTS may not exist */ }

        if (cardRows.length === 0) {
          try {
            cardRows = db
              .prepare("SELECT id, title, flow, card_type, content, source_files FROM cards WHERE stale = 0 ORDER BY updated_at DESC LIMIT 5")
              .all() as CardRow[];
          } catch { /* no cards table */ }
        }

        const latencyMs = Date.now() - start;

        const allSourceFiles = new Set<string>();
        const cards = cardRows.map((c) => {
          let sourceFiles: string[] = [];
          try { sourceFiles = JSON.parse(c.source_files || "[]"); } catch { /* ignore */ }
          sourceFiles.forEach((f) => allSourceFiles.add(f));
          return {
            id: c.id,
            title: c.title,
            flow: c.flow,
            cardType: c.card_type,
            content: c.content,
            sourceFiles: sourceFiles.slice(0, 8),
          };
        });

        const formattedContext = cards.map((c) =>
          `## ${c.title}\n**Flow:** ${c.flow}\n**Files:** ${c.sourceFiles.join(", ")}\n\n${c.content}`
        ).join("\n\n---\n\n");
        const codeprismTokens = Math.ceil(formattedContext.length / 4);
        const naiveFiles = allSourceFiles.size;
        const naiveTokens = naiveFiles * 500;

        return reply.send({
          query: query.trim(),
          cards,
          formattedContext,
          latencyMs,
          cacheHit: false,
          codeprismTokens,
          naiveFiles,
          naiveTokens,
          tokenReduction: naiveTokens > 0 ? Math.round((1 - codeprismTokens / naiveTokens) * 100) : 0,
        });
      } finally {
        db.close();
      }
    },
  );

  app.get<{ Params: { slug: string } }>("/api/benchmarks/:slug", async (request, reply) => {
    const project = getBenchmarkProject(request.params.slug);
    if (!project) {
      return reply.code(404).send({ error: "Project not found" });
    }
    return reply.send(project);
  });

  app.get("/api/benchmarks", async (_request, reply) => {
    const benchPath = join(__dirname, "../../../eval/benchmarks.json");
    let benchData = null;
    try {
      const raw = await readFile(benchPath, "utf-8");
      benchData = JSON.parse(raw);
    } catch { /* no benchmark file yet */ }

    return reply.send({ benchmarks: benchData });
  });

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

  const port = Number(process.env["CODEPRISM_PORT"]) || 4000;
  const host = process.env["CODEPRISM_HOST"] ?? "0.0.0.0";

  await app.listen({ port, host });

  const cardCount = (
    getDb().prepare("SELECT COUNT(*) AS c FROM cards").get() as { c: number }
  ).c;
  console.log(`[codeprism] Engine listening on http://${host}:${port}`);
  console.log(`[codeprism] Database ready – ${cardCount} cards indexed`);

  // Pre-load the cross-encoder model so the first query has no cold-start latency
  warmReranker();

  // Start opt-in telemetry reporter
  startTelemetryReporter();

  // ── Automatic file + git watcher (zero CLI required) ──────────────
  // Collects repos from workspace config + any UI-registered repos.
  // Watches source files for code changes and .git/ for branch/merge events.
  const workspaceRoot = process.env["CODEPRISM_WORKSPACE"] ?? process.cwd();
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

  // Run branch GC on startup to purge orphaned data from deleted branches.
  // Runs async in the background — does not block server startup.
  const repoMap = new Map(watchedRepos.map((r) => [r.name, r.path]));
  void runAllBranchGC(repoMap);

  // ── Graceful shutdown ──────────────────────────────────────────────

  const shutdown = async (): Promise<void> => {
    console.log("[codeprism] Shutting down…");
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
  console.error("[codeprism] Fatal startup error:", err);
  process.exit(1);
});
