import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { getDataDir } from "../db/connection.js";
import { sanitizeFts5Query } from "../search/keyword.js";
import { llmQueryRepair } from "../services/query-repair.js";
import {
  submitBenchmark as submitBenchmarkJob,
  getQueueStatus,
  getBenchmarkProject,
  openBenchmarkDb,
  type LLMConfig,
} from "../services/benchmark-worker.js";
import { getCatalog, addCatalogPrompt, incrementPromptRunCount } from "../services/catalog.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Benchmark submission, queue status, sandbox search, and results routes. */
export async function registerBenchmarkRoutes(app: FastifyInstance): Promise<void> {
  // In-memory limiter for expensive miss-only sandbox repair calls.
  const REPAIR_LIMIT = { max: 5, windowMs: 60_000 };
  const repairWindowByIp = new Map<string, { start: number; n: number }>();

  const repairCache = new Map<string, { expiresAt: number; ftsQuery?: string; likeTokens?: string[] }>();
  const REPAIR_CACHE_TTL_MS = 15 * 60_000;

  function canAttemptRepair(ip: string): boolean {
    const now = Date.now();
    const w = repairWindowByIp.get(ip);
    if (!w || now - w.start >= REPAIR_LIMIT.windowMs) {
      repairWindowByIp.set(ip, { start: now, n: 1 });
      return true;
    }
    if (w.n >= REPAIR_LIMIT.max) return false;
    w.n += 1;
    return true;
  }

  function getIp(request: { ip?: string; headers: Record<string, unknown> }): string {
    return request.ip ?? (typeof request.headers["x-forwarded-for"] === "string" ? request.headers["x-forwarded-for"].split(",")[0]!.trim() : "unknown");
  }

  async function llmQueryRepairSandbox(params: {
    query: string;
    ftsQuery: string;
    likeTokensTried: string[];
    hints: Array<{ title: string; flow: string; identifiers: string }>;
    provider: "anthropic" | "openai" | "deepseek" | "gemini";
    apiKey: string;
    model?: string;
    timeoutMs: number;
  }): Promise<null | { probes: Array<{ query: string; fts_terms?: string; like_tokens?: string[] }> }> {
    const res = await llmQueryRepair({
      goalLabel: "an interactive sandbox search",
      query: params.query,
      ftsQuery: params.ftsQuery,
      likeTokensTried: params.likeTokensTried,
      hints: params.hints,
      provider: params.provider,
      apiKey: params.apiKey,
      model: params.model,
      timeoutMs: params.timeoutMs,
      maxTokens: 250,
    });
    if (!res) return null;
    return { probes: res.probes };
  }

  app.post<{ Body: { url: string; provider?: string; apiKey?: string; model?: string } }>(
    "/api/benchmarks/submit",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { url, provider, apiKey, model } = request.body ?? {};
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
          return reply.code(400).send({
            queued: false,
            error: `Invalid provider. Must be one of: ${validProviders.join(", ")}`,
          });
        }
        llmConfig = {
          provider: provider as LLMConfig["provider"],
          apiKey,
          model: typeof model === "string" && model.trim() ? model.trim() : undefined,
        };
      }

      const result = await submitBenchmarkJob(url, llmConfig);
      return reply.code(result.queued ? 202 : 200).send(result);
    },
  );

  app.get("/api/benchmarks/queue", async (_request, reply) => {
    return reply.send(getQueueStatus());
  });

  app.post<{ Body: { query: string; repo?: string; llmLabel?: string; repair?: { enabled: boolean; provider: "anthropic" | "openai" | "deepseek" | "gemini"; model?: string; apiKey?: string } } }>(
    "/api/benchmarks/sandbox",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { query, repo, llmLabel, repair } = request.body ?? {};
      if (!query || typeof query !== "string" || query.trim().length < 3) {
        return reply.code(400).send({ error: "query is required (min 3 characters)" });
      }
      if (!repo) {
        return reply.code(400).send({ error: "repo is required" });
      }

      const db = openBenchmarkDb(repo, typeof llmLabel === "string" && llmLabel.trim() ? llmLabel.trim() : undefined);
      if (!db) {
        return reply.code(404).send({ error: "No indexed data found for this project. Submit it for benchmarking first." });
      }

      try {
        const start = Date.now();
        const searchTerm = sanitizeFts5Query(query);
        const diagnostics: {
          v: 1;
          fts_query?: string;
          fts_attempted: boolean;
          fts_matched: boolean;
          fallback_used: "none" | "llm_repair" | "recent_cards" | "no_cards";
          llm_repair_attempted?: boolean;
          llm_repair_used?: boolean;
          llm_repair_latency_ms?: number;
          llm_repair_probes?: number;
          llm_repair_cache_hit?: boolean;
        } = {
          v: 1,
          fts_query: searchTerm || undefined,
          fts_attempted: Boolean(searchTerm),
          fts_matched: false,
          fallback_used: "none",
        };

        type CardRow = {
          id: string; title: string; flow: string;
          card_type: string; content: string; source_files: string;
        };
        let cardRows: CardRow[] = [];
        try {
          cardRows = db
            .prepare(
              "SELECT c.id, c.title, c.flow, c.card_type, c.content, c.source_files " +
              "FROM cards_fts f JOIN cards c ON c.rowid = f.rowid " +
              "WHERE cards_fts MATCH ? AND c.stale = 0 LIMIT 5",
            )
            .all(searchTerm) as CardRow[];
          diagnostics.fts_matched = cardRows.length > 0;
        } catch { /* FTS table may not exist in benchmark DB */ }

        // If miss, try a cheap LIKE scan first (title/flow/identifiers).
        const likeTokensTried: string[] = [];
        if (cardRows.length === 0) {
          const tokens = query
            .replace(/[^a-zA-Z0-9_\\s]/g, " ")
            .replace(/([a-z])([A-Z])/g, "$1 $2")
            .split(/\\s+/)
            .filter((t) => t.length > 2)
            .slice(0, 8);
          likeTokensTried.push(...tokens);
          if (tokens.length > 0) {
            try {
              const like = tokens.map(() => "(title LIKE ? OR identifiers LIKE ? OR flow LIKE ?)").join(" AND ");
              const args = tokens.flatMap((t) => {
                const pat = `%${t}%`;
                return [pat, pat, pat];
              });
              cardRows = db
                .prepare(
                  `SELECT id, title, flow, card_type, content, source_files
                   FROM cards WHERE stale = 0 AND ${like}
                   ORDER BY updated_at DESC LIMIT 5`,
                )
                .all(...args) as CardRow[];
            } catch { /* ignore */ }
          }
        }

        // LLM repair (user-key) on miss-only, verified by DB hits.
        if (cardRows.length === 0 && repair?.enabled) {
          diagnostics.llm_repair_attempted = true;
          const ip = getIp({ ip: (request as { ip?: string }).ip, headers: request.headers as Record<string, unknown> });
          if (!canAttemptRepair(ip)) {
            // Skip repair (budget exceeded); fall through to recent-cards fallback.
          } else if (!repair.apiKey || typeof repair.apiKey !== "string" || repair.apiKey.trim().length < 10) {
            // Skip repair (no key)
          } else {
            const cacheKey = `${repo}::${llmLabel ?? ""}::${query.trim().toLowerCase()}`;
            const cached = repairCache.get(cacheKey);
            if (cached && cached.expiresAt > Date.now()) {
              diagnostics.llm_repair_cache_hit = true;
              if (cached.ftsQuery) {
                try {
                  cardRows = db
                    .prepare(
                      "SELECT c.id, c.title, c.flow, c.card_type, c.content, c.source_files " +
                      "FROM cards_fts f JOIN cards c ON c.rowid = f.rowid " +
                      "WHERE cards_fts MATCH ? AND c.stale = 0 LIMIT 5",
                    )
                    .all(cached.ftsQuery) as CardRow[];
                } catch { /* ignore */ }
              }
              if (cardRows.length === 0 && cached.likeTokens?.length) {
                try {
                  const like = cached.likeTokens.map(() => "(title LIKE ? OR identifiers LIKE ? OR flow LIKE ?)").join(" AND ");
                  const args = cached.likeTokens.flatMap((t) => {
                    const pat = `%${t}%`;
                    return [pat, pat, pat];
                  });
                  cardRows = db
                    .prepare(
                      `SELECT id, title, flow, card_type, content, source_files
                       FROM cards WHERE stale = 0 AND ${like}
                       ORDER BY updated_at DESC LIMIT 5`,
                    )
                    .all(...args) as CardRow[];
                } catch { /* ignore */ }
              }
              if (cardRows.length > 0) {
                diagnostics.fallback_used = "llm_repair";
                diagnostics.llm_repair_used = true;
              }
            }

            if (cardRows.length === 0) {
              const t0 = Date.now();
              const hints = (() => {
                try {
                  return db
                    .prepare("SELECT title, flow, identifiers FROM cards WHERE stale = 0 ORDER BY updated_at DESC LIMIT 8")
                    .all() as Array<{ title: string; flow: string; identifiers: string }>;
                } catch {
                  return [];
                }
              })();

              const repairRes = await llmQueryRepairSandbox({
                query: query.trim(),
                ftsQuery: searchTerm ?? "",
                likeTokensTried,
                hints,
                provider: repair.provider,
                apiKey: repair.apiKey.trim(),
                model: repair.model,
                timeoutMs: 1200,
              });
              diagnostics.llm_repair_latency_ms = Date.now() - t0;
              diagnostics.llm_repair_probes = repairRes?.probes?.length ?? 0;

              if (repairRes?.probes?.length) {
                for (const probe of repairRes.probes) {
                  const probeFts = sanitizeFts5Query((probe.fts_terms ?? probe.query ?? "").slice(0, 400));
                  if (probeFts) {
                    try {
                      cardRows = db
                        .prepare(
                          "SELECT c.id, c.title, c.flow, c.card_type, c.content, c.source_files " +
                          "FROM cards_fts f JOIN cards c ON c.rowid = f.rowid " +
                          "WHERE cards_fts MATCH ? AND c.stale = 0 LIMIT 5",
                        )
                        .all(probeFts) as CardRow[];
                      if (cardRows.length > 0) {
                        diagnostics.fallback_used = "llm_repair";
                        diagnostics.llm_repair_used = true;
                        repairCache.set(cacheKey, { expiresAt: Date.now() + REPAIR_CACHE_TTL_MS, ftsQuery: probeFts });
                        break;
                      }
                    } catch { /* ignore */ }
                  }

                  const probeLike = (probe.like_tokens ?? []).map((t) => t.trim()).filter((t) => t.length > 2).slice(0, 6);
                  if (probeLike.length > 0) {
                    try {
                      const like = probeLike.map(() => "(title LIKE ? OR identifiers LIKE ? OR flow LIKE ?)").join(" AND ");
                      const args = probeLike.flatMap((t) => {
                        const pat = `%${t}%`;
                        return [pat, pat, pat];
                      });
                      cardRows = db
                        .prepare(
                          `SELECT id, title, flow, card_type, content, source_files
                           FROM cards WHERE stale = 0 AND ${like}
                           ORDER BY updated_at DESC LIMIT 5`,
                        )
                        .all(...args) as CardRow[];
                      if (cardRows.length > 0) {
                        diagnostics.fallback_used = "llm_repair";
                        diagnostics.llm_repair_used = true;
                        repairCache.set(cacheKey, { expiresAt: Date.now() + REPAIR_CACHE_TTL_MS, likeTokens: probeLike });
                        break;
                      }
                    } catch { /* ignore */ }
                  }
                }
              }
            }
          }
        }

        if (cardRows.length === 0) {
          try {
            cardRows = db
              .prepare("SELECT id, title, flow, card_type, content, source_files FROM cards WHERE stale = 0 ORDER BY updated_at DESC LIMIT 5")
              .all() as CardRow[];
            if (diagnostics.fallback_used === "none") {
              diagnostics.fallback_used = cardRows.length > 0 ? "recent_cards" : "no_cards";
            }
          } catch { /* no cards table */ }
        }

        const latencyMs = Date.now() - start;
        const allSourceFiles = new Set<string>();

        const cards = cardRows.map((c) => {
          let sourceFiles: string[] = [];
          try { sourceFiles = JSON.parse(c.source_files || "[]"); } catch { /* ignore */ }
          sourceFiles.forEach((f) => allSourceFiles.add(f));
          return {
            id: c.id, title: c.title, flow: c.flow, cardType: c.card_type,
            content: c.content, sourceFiles: sourceFiles.slice(0, 8),
          };
        });

        const formattedContext = cards
          .map((c) => `## ${c.title}\n**Flow:** ${c.flow}\n**Files:** ${c.sourceFiles.join(", ")}\n\n${c.content}`)
          .join("\n\n---\n\n");
        const codeprismTokens = Math.ceil(formattedContext.length / 4);
        const naiveFiles = allSourceFiles.size;
        const naiveTokens = naiveFiles * 500;

        return reply.send({
          query: query.trim(), cards, formattedContext, latencyMs, cacheHit: false,
          codeprismTokens, naiveFiles, naiveTokens,
          tokenReduction: naiveTokens > 0 ? Math.round((1 - codeprismTokens / naiveTokens) * 100) : 0,
          diagnostics,
        });
      } finally {
        db.close();
      }
    },
  );

  app.get<{ Params: { slug: string } }>("/api/benchmarks/:slug", async (request, reply) => {
    const project = getBenchmarkProject(request.params.slug);
    if (!project) return reply.code(404).send({ error: "Project not found" });
    return reply.send(project);
  });

  app.get("/api/benchmarks", async (_request, reply) => {
    const benchPath = join(getDataDir(), "benchmarks", "benchmarks.json");
    let benchData = null;
    try {
      benchData = JSON.parse(await readFile(benchPath, "utf-8"));
    } catch { /* no benchmark file yet */ }
    return reply.send({ benchmarks: benchData });
  });

  /** Catalog: list all projects with their prompts (default + user-added). */
  app.get("/api/benchmarks/catalog", async (_request, reply) => {
    try {
      const catalog = getCatalog();
      return reply.send({ catalog });
    } catch (err) {
      app.log.error(err, "Failed to load benchmark catalog");
      return reply.code(500).send({ error: "Failed to load catalog" });
    }
  });

  /** Catalog: persist a user-submitted prompt for a repo. */
  app.post<{ Body: { repo: string; prompt: string } }>(
    "/api/benchmarks/catalog/prompts",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { repo, prompt } = request.body ?? {};
      if (!repo || typeof repo !== "string" || !repo.includes("/")) {
        return reply.code(400).send({ error: "repo must be a valid 'owner/name' string" });
      }
      if (!prompt || typeof prompt !== "string" || prompt.trim().length < 10) {
        return reply.code(400).send({ error: "prompt must be at least 10 characters" });
      }
      if (prompt.trim().length > 500) {
        return reply.code(400).send({ error: "prompt must be 500 characters or fewer" });
      }
      try {
        const id = addCatalogPrompt(repo, prompt);
        return reply.code(201).send({ ok: true, id });
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404) return reply.code(404).send({ error: (err as Error).message });
        app.log.error(err, "Failed to save catalog prompt");
        return reply.code(500).send({ error: "Failed to save prompt" });
      }
    },
  );

  /** Catalog: increment run count when a prompt is used. */
  app.post<{ Params: { id: string } }>(
    "/api/benchmarks/catalog/prompts/:id/run",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isInteger(id) || id < 1) {
        return reply.code(400).send({ error: "invalid prompt id" });
      }
      incrementPromptRunCount(id);
      return reply.send({ ok: true });
    },
  );
}
