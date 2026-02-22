import type { FastifyInstance } from "fastify";
import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createRequire } from "node:module";
import { getDb } from "../db/connection.js";
import type { Card, ProjectDoc } from "../db/schema.js";
import { calculateMetrics } from "./calculator.js";
import { hybridSearch } from "../search/hybrid.js";
import { createLLMProvider } from "../llm/provider.js";
import { buildRefreshDocPrompt, DOC_SYSTEM_PROMPT, type DocType } from "../indexer/doc-prompts.js";

const _require = createRequire(import.meta.url);

function getEngineVersion(): string {
  try {
    const pkg = _require("../../package.json") as { version: string };
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}

export interface RepoSummary {
  repo: string;
  primaryLanguage: string;
  frameworks: string[];
  skillIds: string[];
  cardCount: number;
  staleCards: number;
  indexedFiles: number;
  lastIndexedAt: string | null;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Async reindex state — shared singleton guard
// ---------------------------------------------------------------------------

interface ReindexState {
  status: "idle" | "running" | "done" | "error";
  startedAt: string | null;
  finishedAt: string | null;
  log: string[];
  error: string | null;
}

const reindexState: ReindexState = {
  status: "idle",
  startedAt: null,
  finishedAt: null,
  log: [],
  error: null,
};

/**
 * Fires an async background reindex by spawning the index-repos CLI.
 * Uses a module-level guard to prevent concurrent runs.
 */
function runIncrementalReindex(repo?: string): void {
  if (reindexState.status === "running") return;

  reindexState.status = "running";
  reindexState.startedAt = new Date().toISOString();
  reindexState.finishedAt = null;
  reindexState.log = [];
  reindexState.error = null;

  // Resolve workspace root (4 levels up from packages/engine/src/metrics/)
  const workspaceRoot = resolve(__dirname, "../../../../..");

  const args = ["--filter", "engine", "index-repos"];
  if (repo) args.push("--repo", repo);

  const child = spawn("pnpm", args, {
    cwd: workspaceRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  const append = (line: string) => {
    reindexState.log.push(line);
    if (reindexState.log.length > 200) reindexState.log.shift();
  };

  child.stdout?.on("data", (chunk: Buffer) =>
    String(chunk).split("\n").filter(Boolean).forEach(append),
  );
  child.stderr?.on("data", (chunk: Buffer) =>
    String(chunk).split("\n").filter(Boolean).forEach(append),
  );

  child.on("close", (code) => {
    reindexState.finishedAt = new Date().toISOString();
    if (code === 0) {
      reindexState.status = "done";
      reindexState.error = null;
    } else {
      reindexState.status = "error";
      reindexState.error = `Process exited with code ${code}`;
    }
  });

  child.on("error", (err) => {
    reindexState.finishedAt = new Date().toISOString();
    reindexState.status = "error";
    reindexState.error = err.message;
  });
}

export { reindexState };

/**
 * Registers REST endpoints that power the srcmap dashboard UI.
 */
export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  // ---------------------------------------------------------------------------
  // Instance info — identity endpoint for srcmap.ai portal aggregation
  // ---------------------------------------------------------------------------
  app.get("/api/instance-info", (_request, reply) => {
    const db = getDb();
    const profile = db
      .prepare("SELECT * FROM instance_profile WHERE id = 1")
      .get() as { company_name: string; plan: string; instance_id: string; created_at: string } | undefined;

    return reply.send({
      instanceId: profile?.instance_id ?? "",
      companyName: profile?.company_name ?? "",
      plan: profile?.plan ?? "self_hosted",
      engineVersion: getEngineVersion(),
    });
  });

  // ---------------------------------------------------------------------------
  // PUT /api/instance-info — update company name / plan from settings page
  // ---------------------------------------------------------------------------
  app.put("/api/instance-info", (request, reply) => {
    const { companyName, plan } = (request.body as { companyName?: string; plan?: string }) ?? {};
    const db = getDb();

    if (companyName !== undefined) {
      db.prepare("UPDATE instance_profile SET company_name = ? WHERE id = 1").run(companyName.trim());
    }
    if (plan !== undefined) {
      db.prepare("UPDATE instance_profile SET plan = ? WHERE id = 1").run(plan);
    }

    const updated = db
      .prepare("SELECT * FROM instance_profile WHERE id = 1")
      .get() as { company_name: string; plan: string; instance_id: string };

    return reply.send({
      instanceId: updated.instance_id,
      companyName: updated.company_name,
      plan: updated.plan,
      engineVersion: getEngineVersion(),
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/repos — per-repo summary for the Repositories dashboard page
  // ---------------------------------------------------------------------------
  app.get("/api/repos", (_request, reply) => {
    const db = getDb();

    const rows = db
      .prepare(
        `SELECT
          rp.repo,
          rp.primary_language  AS primaryLanguage,
          rp.frameworks,
          rp.skill_ids         AS skillIds,
          COUNT(DISTINCT fi.path) AS indexedFiles,
          MAX(fi.updated_at)   AS lastIndexedAt
        FROM repo_profiles rp
        LEFT JOIN file_index fi ON fi.repo = rp.repo
        GROUP BY rp.repo
        ORDER BY lastIndexedAt DESC`,
      )
      .all() as Array<{
        repo: string;
        primaryLanguage: string;
        frameworks: string;
        skillIds: string;
        indexedFiles: number;
        lastIndexedAt: string | null;
      }>;

    const cardStats = db
      .prepare(
        `SELECT
          json_each.value AS repo,
          COUNT(*) AS cardCount,
          SUM(CASE WHEN stale = 1 THEN 1 ELSE 0 END) AS staleCards
        FROM cards, json_each(cards.source_repos)
        GROUP BY json_each.value`,
      )
      .all() as Array<{ repo: string; cardCount: number; staleCards: number }>;

    const cardStatsByRepo = new Map(cardStats.map((r) => [r.repo, r]));

    const result: RepoSummary[] = rows.map((r) => {
      const cs = cardStatsByRepo.get(r.repo);
      return {
        repo: r.repo,
        primaryLanguage: r.primaryLanguage,
        frameworks: (() => { try { return JSON.parse(r.frameworks) as string[]; } catch { return []; } })(),
        skillIds: (() => { try { return JSON.parse(r.skillIds) as string[]; } catch { return []; } })(),
        cardCount: cs?.cardCount ?? 0,
        staleCards: cs?.staleCards ?? 0,
        indexedFiles: r.indexedFiles,
        lastIndexedAt: r.lastIndexedAt,
      };
    });

    return reply.send(result);
  });

  // ---------------------------------------------------------------------------
  // GET /api/settings — retrieve key search_config values for settings page
  // ---------------------------------------------------------------------------
  app.get("/api/settings", (_request, reply) => {
    const db = getDb();
    const rows = db.prepare("SELECT key, value FROM search_config").all() as Array<{ key: string; value: string }>;
    const config: Record<string, string> = {};
    for (const row of rows) config[row.key] = row.value;
    return reply.send(config);
  });

  // ---------------------------------------------------------------------------
  // PUT /api/settings — update search_config key/value pairs
  // ---------------------------------------------------------------------------
  app.put("/api/settings", (request, reply) => {
    const updates = request.body as Record<string, string>;
    const db = getDb();
    const upsert = db.prepare(
      "INSERT INTO search_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
    );
    const tx = db.transaction((pairs: Record<string, string>) => {
      for (const [key, value] of Object.entries(pairs)) {
        upsert.run(key, String(value));
      }
    });
    tx(updates);
    return reply.send({ ok: true });
  });

  app.get("/api/metrics/summary", (request, reply) => {
    const { from, to } = request.query as { from?: string; to?: string };

    const period =
      from || to ? { from: from || undefined, to: to || undefined } : undefined;

    const summary = calculateMetrics(period);
    return reply.send(summary);
  });

  app.get("/api/cards", (request, reply) => {
    const { flow } = request.query as { flow?: string };
    const db = getDb();

    if (flow) {
      const cards = db
        .prepare("SELECT * FROM cards WHERE flow = ? ORDER BY updated_at DESC")
        .all(flow) as Card[];
      return reply.send(cards);
    }

    const cards = db
      .prepare("SELECT * FROM cards ORDER BY updated_at DESC")
      .all() as Card[];
    return reply.send(cards);
  });

  app.get<{ Params: { id: string } }>("/api/cards/:id", (request, reply) => {
    const db = getDb();
    const card = db.prepare("SELECT * FROM cards WHERE id = ?").get(request.params.id) as
      | Card
      | undefined;

    if (!card) {
      return reply.status(404).send({ error: "Card not found" });
    }

    return reply.send(card);
  });

  app.get("/api/flows", (_request, reply) => {
    const db = getDb();

    const flows = db
      .prepare(
        `SELECT
          c.flow,
          COUNT(DISTINCT c.id)          AS cardCount,
          COUNT(DISTINCT jf.value)      AS fileCount,
          GROUP_CONCAT(DISTINCT jr.value) AS repos,
          SUM(CASE WHEN c.stale = 1 THEN 1 ELSE 0 END) AS staleCount
        FROM cards c
          LEFT JOIN json_each(c.source_files) jf
          LEFT JOIN json_each(c.source_repos) jr
        GROUP BY c.flow
        ORDER BY cardCount DESC`,
      )
      .all() as Array<{ flow: string; cardCount: number; fileCount: number; repos: string | null; staleCount: number }>;

    // Normalise repos CSV into array and add isPageFlow flag for sorting
    const result = flows.map((f) => ({
      flow: f.flow,
      cardCount: f.cardCount,
      fileCount: f.fileCount,
      staleCount: f.staleCount ?? 0,
      repos: f.repos ? [...new Set(f.repos.split(","))].filter(Boolean) : [],
      isPageFlow: f.flow.includes(" ") && !f.flow.includes("↔"), // seeded page flows have spaces (exclude cross-service "A ↔ B")
    }));

    // Page flows first, then technical/hub flows
    result.sort((a, b) => {
      if (a.isPageFlow && !b.isPageFlow) return -1;
      if (!a.isPageFlow && b.isPageFlow) return 1;
      return b.cardCount - a.cardCount;
    });

    return reply.send(result);
  });

  /**
   * Evaluation endpoint: runs hybrid search and returns scored cards as JSON.
   * Used by the Python Ragas evaluation harness in srcmap/eval/.
   *
   * GET /api/search?q=<query>&limit=<n>
   */
  app.get("/api/search", async (request, reply) => {
    const { q, limit } = request.query as { q?: string; limit?: string };

    if (!q || q.trim() === "") {
      return reply.status(400).send({ error: "Missing required query param: q" });
    }

    const n = Math.min(parseInt(limit ?? "10", 10) || 10, 50);

    try {
      const results = await hybridSearch(q, { limit: n });

      const payload = results.map((r) => {
        let sourceFiles: string[] = [];
        try {
          sourceFiles = JSON.parse(r.card.source_files as unknown as string);
        } catch {
          // ignore
        }
        return {
          id: r.card.id,
          title: r.card.title,
          card_type: r.card.card_type,
          flow: r.card.flow,
          score: r.score,
          source: r.source,
          content: r.card.content,
          source_files: sourceFiles,
          tags: (() => {
            try { return JSON.parse(r.card.tags as unknown as string); } catch { return []; }
          })(),
        };
      });

      return reply.send({ query: q, results: payload });
    } catch (err) {
      return reply.status(500).send({ error: String(err) });
    }
  });

  app.get<{ Params: { repo: string } }>("/api/branches/:repo", (request, reply) => {
    const db = getDb();

    const branches = db
      .prepare(
        `SELECT
          branch,
          event_type,
          from_branch,
          MAX(timestamp) AS lastSeen,
          COUNT(*) AS eventCount
        FROM branch_events
        WHERE repo = ?
        GROUP BY branch, event_type
        ORDER BY lastSeen DESC`,
      )
      .all(request.params.repo) as Array<{
      branch: string;
      event_type: string;
      from_branch: string | null;
      lastSeen: string;
      eventCount: number;
    }>;

    return reply.send(branches);
  });

  // ---------------------------------------------------------------------------
  // Project docs endpoints
  // ---------------------------------------------------------------------------

  /**
   * GET /api/project-docs
   * Returns project documentation stored in the project_docs table.
   * Optional query params: ?repo=<name>&type=<doc_type>
   */
  app.get("/api/project-docs", (request, reply) => {
    const { repo, type } = request.query as { repo?: string; type?: string };
    const db = getDb();

    let rows: ProjectDoc[];
    if (repo && type) {
      rows = [db.prepare("SELECT * FROM project_docs WHERE repo = ? AND doc_type = ?").get(repo, type)].filter(Boolean) as ProjectDoc[];
    } else if (repo) {
      rows = db.prepare("SELECT * FROM project_docs WHERE repo = ? ORDER BY doc_type").all(repo) as ProjectDoc[];
    } else {
      rows = db.prepare("SELECT * FROM project_docs ORDER BY repo, doc_type").all() as ProjectDoc[];
    }

    return reply.send(rows);
  });

  /**
   * POST /api/refresh
   * Regenerates stale project docs using the LLM (reads source files from disk).
   * Body: { repo?: string } — if omitted, refreshes all stale docs across all repos.
   * Returns: { refreshed: number, skipped: number, errors: string[] }
   */
  app.post("/api/refresh", async (request, reply) => {
    const { repo: targetRepo } = (request.body as { repo?: string }) ?? {};
    const db = getDb();

    const llm = createLLMProvider();
    if (!llm) {
      return reply.status(503).send({
        error: "LLM not configured. Set SRCMAP_LLM_PROVIDER and SRCMAP_LLM_API_KEY to enable refresh.",
      });
    }

    const staleQuery = targetRepo
      ? "SELECT * FROM project_docs WHERE stale = 1 AND repo = ? ORDER BY repo, doc_type"
      : "SELECT * FROM project_docs WHERE stale = 1 ORDER BY repo, doc_type";

    const staleDocs = (targetRepo
      ? db.prepare(staleQuery).all(targetRepo)
      : db.prepare(staleQuery).all()
    ) as ProjectDoc[];

    if (staleDocs.length === 0) {
      return reply.send({ refreshed: 0, skipped: 0, errors: [], message: "No stale docs found." });
    }

    let refreshed = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const doc of staleDocs) {
      let sourceFilePaths: string[] = [];
      try {
        sourceFilePaths = JSON.parse(doc.source_file_paths) as string[];
      } catch {
        // ignore parse errors
      }

      const availableFiles = sourceFilePaths
        .filter((p) => existsSync(p))
        .map((p) => {
          try {
            const raw = readFileSync(p, "utf-8");
            const lines = raw.split("\n");
            const content = lines.length > 120
              ? lines.slice(0, 120).join("\n") + `\n... (${lines.length - 120} more lines)`
              : raw.trimEnd();
            return { path: p, content };
          } catch {
            return null;
          }
        })
        .filter((f): f is { path: string; content: string } => f !== null);

      if (availableFiles.length === 0) {
        skipped++;
        errors.push(`${doc.repo}/${doc.doc_type}: no source files available on disk`);
        continue;
      }

      try {
        const prompt = buildRefreshDocPrompt(doc.doc_type as DocType, doc.repo, availableFiles);
        const newContent = await llm.generate(prompt, { systemPrompt: DOC_SYSTEM_PROMPT, maxTokens: 1200 });

        db.prepare(
          `UPDATE project_docs SET content = ?, stale = 0, updated_at = datetime('now') WHERE id = ?`,
        ).run(newContent, doc.id);

        refreshed++;
        console.log(`[refresh] ${doc.repo}/${doc.doc_type} regenerated`);
      } catch (err) {
        skipped++;
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${doc.repo}/${doc.doc_type}: LLM error — ${msg.slice(0, 100)}`);
      }
    }

    return reply.send({ refreshed, skipped, errors });
  });

  /**
   * GET /api/reindex-status
   * Returns the current state of the background reindex job.
   */
  app.get("/api/reindex-status", (_request, reply) => {
    return reply.send(reindexState);
  });

  /**
   * POST /api/reindex-stale
   * Fires an async background reindex of all stale cards (or a specific repo).
   * Returns 409 if a reindex is already running, 202 when kicked off, 200 if nothing to do.
   *
   * Optional query param: ?repo=<name>
   */
  app.post("/api/reindex-stale", (request, reply) => {
    const { repo } = (request.query as { repo?: string });
    const db = getDb();

    if (reindexState.status === "running") {
      return reply.status(409).send({
        status: "running",
        message: "A reindex is already in progress. Check GET /api/reindex-status for progress.",
        startedAt: reindexState.startedAt,
      });
    }

    const staleCount = repo
      ? (db.prepare("SELECT COUNT(*) as n FROM cards WHERE stale = 1 AND source_repos LIKE ?").get(`%${repo}%`) as { n: number }).n
      : (db.prepare("SELECT COUNT(*) as n FROM cards WHERE stale = 1").get() as { n: number }).n;

    if (staleCount === 0) {
      return reply.send({ status: "ok", message: "No stale cards. Knowledge base is up to date." });
    }

    runIncrementalReindex(repo);

    return reply.status(202).send({
      status: "queued",
      message: `Reindexing ${staleCount} stale card(s)${repo ? ` in ${repo}` : ""}. Poll GET /api/reindex-status for progress.`,
      staleCount,
    });
  });

}
