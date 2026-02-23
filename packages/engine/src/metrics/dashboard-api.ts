import type { FastifyInstance } from "fastify";
import { readFileSync, existsSync } from "node:fs";
import { writeFile, mkdir, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { getDb } from "../db/connection.js";
import type { Card, ProjectDoc } from "../db/schema.js";
import { calculateMetrics } from "./calculator.js";
import { hybridSearch } from "../search/hybrid.js";
import { createLLMProvider } from "../llm/provider.js";
import { buildRefreshDocPrompt, buildFrameworkBaseline, DOC_SYSTEM_PROMPT, type DocType } from "../indexer/doc-prompts.js";
import { resolveSkills } from "../skills/index.js";
import { getAllRepoSignalRecords } from "../search/repo-signals.js";

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
   * GET /api/repo-overview?repo=<name>
   * Returns the three key docs for a repo in a single request:
   * about, pages, and be_overview.  Nulls for docs that don't exist yet.
   */
  app.get("/api/repo-overview", (request, reply) => {
    const { repo } = request.query as { repo?: string };
    if (!repo) return reply.status(400).send({ error: "repo query param required" });
    const db = getDb();

    const fetchDoc = (docType: string) =>
      db
        .prepare("SELECT id, repo, doc_type, title, content, updated_at FROM project_docs WHERE repo = ? AND doc_type = ?")
        .get(repo, docType) as import("../db/schema.js").ProjectDoc | undefined ?? null;

    return reply.send({
      about: fetchDoc("about"),
      pages: fetchDoc("pages"),
      be_overview: fetchDoc("be_overview"),
    });
  });

  /**
   * GET /api/repo-signals
   * Returns all stored repo signals for transparency and debugging.
   * Teams can inspect which keywords drive repo affinity scoring and lock
   * or override signals via the PUT /api/settings endpoint.
   *
   * Response: Array of { repo, signals, signalSource, locked, generatedAt }
   */
  app.get("/api/repo-signals", (_request, reply) => {
    return reply.send(getAllRepoSignalRecords());
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

    // Cache framework baselines per repo to avoid repeated DB lookups within the same refresh batch
    const repoBaselines = new Map<string, string>();
    const getRepoBaseline = (repo: string): string => {
      if (repoBaselines.has(repo)) return repoBaselines.get(repo)!;
      const profileRow = db
        .prepare("SELECT skill_ids FROM repo_profiles WHERE repo = ?")
        .get(repo) as { skill_ids: string } | undefined;
      if (!profileRow) { repoBaselines.set(repo, ""); return ""; }
      let skillIds: string[] = [];
      try { skillIds = JSON.parse(profileRow.skill_ids) as string[]; } catch { /* ignore */ }
      const skills = resolveSkills(skillIds);
      const baseline = skills.length > 0
        ? buildFrameworkBaseline(skills.map((s) => s.bestPractices))
        : "";
      repoBaselines.set(repo, baseline);
      return baseline;
    };

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
        const baseline = getRepoBaseline(doc.repo);
        const prompt = buildRefreshDocPrompt(doc.doc_type as DocType, doc.repo, availableFiles, baseline);
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

  /**
   * GET /api/knowledge-files
   * List all community knowledge .md files from <workspace>/.srcmap/knowledge/
   * and built-in src/skills/knowledge/.
   */
  app.get("/api/knowledge-files", async (_request, reply) => {
    const workspaceRoot = resolve(__dirname, "../../../../..");
    const customDir = join(workspaceRoot, ".srcmap", "knowledge");
    const builtinDir = resolve(__dirname, "../skills/knowledge");

    const readDir = async (dir: string, source: "builtin" | "custom") => {
      if (!existsSync(dir)) return [];
      try {
        const files = await readdir(dir);
        return files
          .filter((f) => f.endsWith(".md"))
          .map((f) => ({ id: f.slice(0, -3), source, path: join(dir, f) }));
      } catch { return []; }
    };

    const [builtin, custom] = await Promise.all([
      readDir(builtinDir, "builtin"),
      readDir(customDir, "custom"),
    ]);

    // Custom overrides builtin with same ID
    const builtinIds = new Set(custom.map((f) => f.id));
    const merged = [
      ...custom,
      ...builtin.filter((f) => !builtinIds.has(f.id)),
    ].sort((a, b) => a.id.localeCompare(b.id));

    return reply.send(merged.map(({ id, source }) => ({ id, source })));
  });

  /**
   * POST /api/knowledge-files
   * Write a community knowledge .md file to <workspace>/.srcmap/knowledge/<skillId>.md.
   * Body: { skillId: string, content: string }
   */
  app.post("/api/knowledge-files", async (request, reply) => {
    const body = request.body as { skillId?: string; content?: string };
    if (!body.skillId || !body.content) {
      return reply.status(400).send({ error: "skillId and content are required" });
    }

    const skillId = body.skillId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    if (!skillId) return reply.status(400).send({ error: "Invalid skillId" });
    if (body.content.length > 500_000) {
      return reply.status(413).send({ error: "Content exceeds 500 KB limit" });
    }

    const workspaceRoot = resolve(__dirname, "../../../../..");
    const customDir = join(workspaceRoot, ".srcmap", "knowledge");
    await mkdir(customDir, { recursive: true });

    const filePath = join(customDir, `${skillId}.md`);
    await writeFile(filePath, body.content.trim() + "\n", "utf-8");

    return reply.status(201).send({
      skillId,
      path: filePath,
      message: `Knowledge file written. It will be loaded on next srcmap index run.`,
    });
  });

  /**
   * GET /api/repos/registered
   * List all user-registered extra repos stored in search_config.
   */
  app.get("/api/repos/registered", (_request, reply) => {
    const db = getDb();
    const row = db.prepare("SELECT value FROM search_config WHERE key = 'extra_repos'").get() as { value: string } | undefined;
    const repos: Array<{ name: string; path: string }> = row ? JSON.parse(row.value) : [];
    return reply.send(repos);
  });

  /**
   * POST /api/repos/register
   * Register a new repo by name + local filesystem path.
   * Stores in search_config and triggers an incremental reindex.
   * Body: { name: string, path: string }
   */
  app.post("/api/repos/register", (request, reply) => {
    const body = request.body as { name?: string; path?: string };
    if (!body.name || !body.path) {
      return reply.status(400).send({ error: "name and path are required" });
    }

    const name = body.name.trim().replace(/[^a-zA-Z0-9_-]/g, "-");
    const repoPath = resolve(body.path.trim());

    if (!existsSync(repoPath)) {
      return reply.status(400).send({ error: `Path does not exist: ${repoPath}` });
    }

    const db = getDb();
    const row = db.prepare("SELECT value FROM search_config WHERE key = 'extra_repos'").get() as { value: string } | undefined;
    const repos: Array<{ name: string; path: string }> = row ? JSON.parse(row.value) : [];

    if (repos.find((r) => r.name === name)) {
      return reply.status(409).send({ error: `Repository "${name}" is already registered` });
    }

    repos.push({ name, path: repoPath });
    db.prepare("INSERT OR REPLACE INTO search_config (key, value) VALUES ('extra_repos', ?)")
      .run(JSON.stringify(repos));

    // Kick off a background reindex for the new repo only
    const wasAlreadyRunning = reindexState.status === "running";
    if (!wasAlreadyRunning) {
      runIncrementalReindex(name);
    }

    return reply.status(201).send({
      name,
      path: repoPath,
      reindexing: !wasAlreadyRunning,
      message: `Repository "${name}" registered.${!wasAlreadyRunning ? " Indexing started." : " Another reindex is already running; it will pick up the new repo on the next run."}`,
    });
  });

  /**
   * DELETE /api/repos/register/:name
   * Remove a user-registered repo.
   */
  app.delete<{ Params: { name: string } }>("/api/repos/register/:name", (request, reply) => {
    const { name } = request.params;
    const db = getDb();
    const row = db.prepare("SELECT value FROM search_config WHERE key = 'extra_repos'").get() as { value: string } | undefined;
    const repos: Array<{ name: string; path: string }> = row ? JSON.parse(row.value) : [];
    const filtered = repos.filter((r) => r.name !== name);
    db.prepare("INSERT OR REPLACE INTO search_config (key, value) VALUES ('extra_repos', ?)")
      .run(JSON.stringify(filtered));
    return reply.send({ removed: name });
  });

  // -------------------------------------------------------------------------
  // Team Rules
  // -------------------------------------------------------------------------

  /** Shared helper — inserts a rule and returns the saved row. */
  function insertTeamRule(db: ReturnType<typeof getDb>, fields: {
    name: string;
    description: string;
    severity: string;
    scope?: string | null;
    created_by?: string | null;
  }) {
    const validSeverities = ["error", "warning", "info"];
    const severity = validSeverities.includes(fields.severity) ? fields.severity : "warning";
    const id = `rule_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    db.prepare(`
      INSERT INTO team_rules (id, name, description, severity, scope, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, fields.name.trim(), fields.description.trim(), severity, fields.scope?.trim() || null, fields.created_by?.trim() || null);
    return db.prepare("SELECT * FROM team_rules WHERE id = ?").get(id);
  }

  /**
   * GET /api/rules
   * List all team rules, ordered by severity then name.
   */
  app.get("/api/rules", (_request, reply) => {
    const db = getDb();
    const rules = db.prepare(`
      SELECT * FROM team_rules
      ORDER BY CASE severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, name
    `).all();
    return reply.send(rules);
  });

  /**
   * POST /api/rules
   * Create a new team rule.
   * Body: { name, description, severity?, scope?, created_by? }
   */
  app.post("/api/rules", (request, reply) => {
    const body = request.body as {
      name?: string;
      description?: string;
      severity?: string;
      scope?: string;
      created_by?: string;
    };

    if (!body.name?.trim() || !body.description?.trim()) {
      return reply.status(400).send({ error: "name and description are required" });
    }
    const db = getDb();
    const rule = insertTeamRule(db, {
      name: body.name,
      description: body.description,
      severity: body.severity ?? "warning",
      scope: body.scope,
      created_by: body.created_by,
    });
    return reply.status(201).send(rule);
  });

  /**
   * PATCH /api/rules/:id
   * Update rule fields (name, description, severity, scope, enabled).
   */
  app.patch<{ Params: { id: string } }>("/api/rules/:id", (request, reply) => {
    const { id } = request.params;
    const body = request.body as Record<string, unknown>;
    const db = getDb();

    const existing = db.prepare("SELECT * FROM team_rules WHERE id = ?").get(id);
    if (!existing) return reply.status(404).send({ error: "Rule not found" });

    const allowed = ["name", "description", "severity", "scope", "enabled"] as const;
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const key of allowed) {
      if (key in body) {
        sets.push(`${key} = ?`);
        // Normalize enabled to SQLite integer
        values.push(key === "enabled" ? (body[key] ? 1 : 0) : body[key]);
      }
    }
    if (sets.length === 0) return reply.status(400).send({ error: "No updatable fields provided" });

    sets.push("updated_at = datetime('now')");
    values.push(id);
    db.prepare(`UPDATE team_rules SET ${sets.join(", ")} WHERE id = ?`).run(...values);

    const updated = db.prepare("SELECT * FROM team_rules WHERE id = ?").get(id);
    return reply.send(updated);
  });

  /**
   * DELETE /api/rules/:id
   */
  app.delete<{ Params: { id: string } }>("/api/rules/:id", (request, reply) => {
    const { id } = request.params;
    const db = getDb();
    const info = db.prepare("DELETE FROM team_rules WHERE id = ?").run(id);
    if (info.changes === 0) return reply.status(404).send({ error: "Rule not found" });
    return reply.send({ deleted: id });
  });

  /**
   * GET /api/rule-checks
   * Recent rule check results, newest first.
   */
  app.get("/api/rule-checks", (request, reply) => {
    const { repo, limit = "20" } = request.query as { repo?: string; limit?: string };
    const db = getDb();
    const checks = repo
      ? db.prepare("SELECT * FROM rule_checks WHERE repo = ? ORDER BY checked_at DESC LIMIT ?").all(repo, parseInt(limit, 10))
      : db.prepare("SELECT * FROM rule_checks ORDER BY checked_at DESC LIMIT ?").all(parseInt(limit, 10));
    return reply.send(checks);
  });

  /**
   * POST /api/rules/refine
   * Use the LLM to rewrite a rough rule description into a precise, actionable
   * code-review instruction. Returns the refined description as a string.
   * Body: { name: string, description: string, scope?: string, severity?: string }
   */
  app.post("/api/rules/refine", async (request, reply) => {
    const body = request.body as { name?: string; description?: string; scope?: string; severity?: string };
    if (!body.description?.trim()) {
      return reply.status(400).send({ error: "description is required" });
    }

    const llm = createLLMProvider();
    if (!llm) {
      return reply.status(503).send({ error: "No LLM configured. Add an LLM provider in Settings." });
    }

    const context = [
      body.name ? `Rule name: "${body.name}"` : null,
      body.scope ? `Tech stack / scope: ${body.scope}` : null,
      body.severity ? `Severity: ${body.severity}` : null,
    ].filter(Boolean).join("\n");

    const prompt = `You are helping a developer write a precise code-review rule description.

The rule description is given verbatim to an LLM that reviews git diffs. It must be:
- Specific and unambiguous (say exactly what to look for in the added lines)
- Actionable (describe what IS and IS NOT allowed with clear examples when helpful)
- Concise (2-4 sentences maximum)
- Free of vague words like "avoid", "try to", "consider", "maybe"

${context ? `Context:\n${context}\n\n` : ""}Original (rough) description written by the user:
"${body.description.trim()}"

Rewrite this as a precise, LLM-readable rule description. Output ONLY the rewritten description — no preamble, no quotes, no explanation.`;

    try {
      const refined = await llm.generate(prompt, { maxTokens: 300, temperature: 0.2 });
      return reply.send({ refined: refined.trim() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });

  /**
   * POST /api/rules/import
   * Bulk-import rules from a JSON array.
   * Skips rules with duplicate names (case-insensitive).
   * Body: Array<{ name, description, severity?, scope?, created_by? }>
   */
  app.post("/api/rules/import", (request, reply) => {
    const body = request.body as Array<{
      name?: string;
      description?: string;
      severity?: string;
      scope?: string;
      created_by?: string;
    }>;

    if (!Array.isArray(body)) {
      return reply.status(400).send({ error: "Body must be a JSON array of rules" });
    }
    if (body.length > 500) {
      return reply.status(413).send({ error: "Maximum 500 rules per import" });
    }

    const db = getDb();
    const existing = (db.prepare("SELECT LOWER(name) as n FROM team_rules").all() as { n: string }[]).map((r) => r.n);

    const inserted: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];

    for (const rule of body) {
      if (!rule.name?.trim() || !rule.description?.trim()) {
        errors.push(`Rule missing name or description: ${JSON.stringify(rule).slice(0, 60)}`);
        continue;
      }
      if (existing.includes(rule.name.trim().toLowerCase())) {
        skipped.push(rule.name.trim());
        continue;
      }
      insertTeamRule(db, {
        name: rule.name,
        description: rule.description,
        severity: rule.severity ?? "warning",
        scope: rule.scope,
        created_by: rule.created_by,
      });
      inserted.push(rule.name.trim());
      existing.push(rule.name.trim().toLowerCase());
    }

    return reply.status(201).send({ inserted, skipped, errors });
  });

  /**
   * POST /api/rules/run-check
   * Trigger srcmap check from the UI. Calls runCheckCore directly — no stdout
   * capture, no process.exit, no monkey-patching. Safe for concurrent requests.
   * Body: { repo?: string, base?: string }
   */
  app.post("/api/rules/run-check", async (request, reply) => {
    const { repo, base = "main" } = request.body as { repo?: string; base?: string };
    const db = getDb();

    const activeRules = db.prepare("SELECT COUNT(*) as n FROM team_rules WHERE enabled = 1").get() as { n: number };
    if (activeRules.n === 0) {
      return reply.send({ passed: true, violations: [], message: "No active rules to check." });
    }

    // Resolve repo path — try UI-registered repos first, then workspace config
    const row = db.prepare("SELECT value FROM search_config WHERE key = 'extra_repos'").get() as { value: string } | undefined;
    const registeredRepos: Array<{ name: string; path: string }> = row ? JSON.parse(row.value) : [];

    let repoPath: string | null = null;
    if (repo) {
      repoPath = registeredRepos.find((r) => r.name === repo)?.path ?? null;
    } else if (registeredRepos.length > 0) {
      repoPath = registeredRepos[0]!.path;
    }

    // Fallback: use workspace config repos (srcmap.config.json or auto-discovery)
    if (!repoPath) {
      try {
        const { loadWorkspaceConfig } = await import("../config/workspace-config.js");
        const { userWorkspaceRootFrom } = await import("../utils/workspace.js");
        const wsRoot = userWorkspaceRootFrom(import.meta.url);
        const wsConfig = loadWorkspaceConfig(wsRoot);
        const wsRepos = wsConfig.repos;
        if (repo) {
          repoPath = wsRepos.find((r) => r.name === repo)?.path ?? null;
        } else if (wsRepos.length > 0) {
          repoPath = wsRepos[0]!.path;
        }
      } catch { /* workspace config not available — continue */ }
    }

    if (!repoPath) {
      return reply.status(400).send({
        error: "No repo path found. Add a repository in the Repositories page, or ensure srcmap.config.json is configured.",
      });
    }

    try {
      const { runCheckCore } = await import("../cli/check.js");
      const result = await runCheckCore(repoPath, {
        base,
        repo,
        strict: false,
        triggeredBy: "ui",
      });
      return reply.send(result);
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

}
