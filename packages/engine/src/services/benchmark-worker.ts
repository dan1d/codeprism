import { spawn, execSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BENCHMARKS_PATH = join(__dirname, "../../../../eval/benchmarks.json");
const MAX_PROJECTS = 20;
const MAX_QUERIES_PER_PROJECT = 16;
const FILE_CAP = 2000;

function getBenchDbDir(): string {
  const dataDir = process.env["CODEPRISM_DATA_DIR"] ?? join(__dirname, "../..", "data");
  const dir = join(dataDir, "benchmarks");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function slugify(repo: string): string {
  return repo.replace(/\//g, "-");
}

function getBenchDbPath(repo: string, llmLabel?: string): string {
  const base = slugify(repo);
  const suffix = llmLabel ? `-${llmLabel}` : "";
  return join(getBenchDbDir(), `${base}${suffix}.db`);
}

/** Extended PATH so git/node are found in Docker and minimal server environments. */
const EXTENDED_PATH = [
  "/usr/local/sbin", "/usr/local/bin", "/usr/sbin", "/usr/bin", "/sbin", "/bin",
  "/opt/homebrew/bin", "/snap/bin", "/root/.local/bin",
  process.env.PATH ?? "",
].filter(Boolean).join(":");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BenchmarkStage = "queued" | "cloning" | "analyzing" | "indexing" | "benchmarking" | "saving";

export interface LLMConfig {
  provider: "gemini" | "openai" | "deepseek" | "anthropic";
  apiKey: string;
  model?: string;
}

interface QueueEntry {
  id: string;
  repo: string;
  repoUrl: string;
  status: "pending" | "running" | "done" | "error";
  stage: BenchmarkStage;
  submittedAt: string;
  error?: string;
}

interface BenchmarkCase {
  query: string;
  codeprism_tokens: number;
  naive_tokens: number;
  latency_ms: number;
  cache_hit: boolean;
  flow_hit_rate: number;
  file_hit_rate: number;
  precision_at_k: number;
  result_count: number;
  quality_score?: number;
}

interface BenchmarkProject {
  name: string;
  repo: string;
  language: string;
  framework: string;
  live?: boolean;
  llmEnhanced?: boolean;
  llmLabel?: string;
  dbPath?: string;
  cardCount?: number;
  stats: Record<string, number>;
  cases: BenchmarkCase[];
}

interface BenchmarkFile {
  generated_at: string;
  projects: BenchmarkProject[];
  aggregate: Record<string, number>;
}

// In-memory queue with LLM configs (keys never written to disk)
const memoryQueue: Array<QueueEntry & { llmConfig?: LLMConfig; tmpDir?: string }> = [];
let processing = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getBenchmarkSlots(): { used: number; total: number } {
  const file = readBenchmarkFileSync();
  return { used: file?.projects?.length ?? 0, total: MAX_PROJECTS };
}

export function getQueueStatus(): {
  queue: Array<{ repo: string; status: string; stage: BenchmarkStage; position: number; error?: string }>;
  slotsUsed: number;
  slotsTotal: number;
} {
  const slots = getBenchmarkSlots();
  return {
    queue: memoryQueue.map((e, i) => ({
      repo: e.repo,
      status: e.status,
      stage: e.stage,
      position: i + 1,
      error: e.error,
    })),
    slotsUsed: slots.used,
    slotsTotal: slots.total,
  };
}

export function getFileCountCap(): number {
  return FILE_CAP;
}

export function getBenchmarkProject(slug: string): BenchmarkProject | null {
  const file = readBenchmarkFileSync();
  if (!file) return null;
  // Exact DB-slug match first (includes llmLabel suffix), then fallback to repo match
  return (
    file.projects.find((p) => {
      const projectSlug = p.llmLabel
        ? `${slugify(p.repo)}-${p.llmLabel}`
        : slugify(p.repo);
      return projectSlug === slug;
    }) ??
    // Fallback: match by repo slug alone (returns the structural / most-recent result)
    file.projects.find((p) => slugify(p.repo) === slug) ??
    null
  );
}

/** Opens the per-repo benchmark DB (read-only for sandbox queries). */
export function openBenchmarkDb(repo: string): InstanceType<typeof Database> | null {
  const dbPath = getBenchDbPath(repo);
  try {
    const db = new Database(dbPath, { readonly: true });
    sqliteVec.load(db);
    return db;
  } catch {
    return null;
  }
}

export async function submitBenchmark(
  repoUrl: string,
  llmConfig?: LLMConfig,
): Promise<{ queued: boolean; position?: number; requiresKey?: boolean; fileEstimate?: number; error?: string }> {
  const match = repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
  if (!match) return { queued: false, error: "Invalid GitHub URL" };

  const repoSlug = match[1].replace(/\.git$/, "");
  // Build the llmLabel the same way runBenchmarkJob does, so dedup is consistent
  const llmLabel = llmConfig
    ? `${llmConfig.provider}${llmConfig.model ? `-${llmConfig.model}` : ""}`
    : undefined;

  const file = readBenchmarkFileSync();
  // Count unique (repo, llmLabel) pairs toward the slot cap
  const existingCount = file?.projects?.length ?? 0;

  if (existingCount >= MAX_PROJECTS) {
    return { queued: false, error: `Benchmark cap reached (${MAX_PROJECTS} projects). No more slots available.` };
  }

  // Check for exact duplicate: same repo AND same llmLabel
  const existingProject = file?.projects?.find(
    (p: BenchmarkProject) => p.repo === repoSlug && (p.llmLabel ?? undefined) === llmLabel,
  );
  if (existingProject) {
    return { queued: false, error: `${repoSlug}${llmLabel ? ` (${llmLabel})` : ""} has already been benchmarked` };
  }

  if (memoryQueue.some((e) => e.repo === repoSlug && e.status !== "error")) {
    return { queued: false, error: `${repoSlug} is already in the queue` };
  }

  // Remove old error entries for this repo so the queue stays clean
  for (let i = memoryQueue.length - 1; i >= 0; i--) {
    if (memoryQueue[i].repo === repoSlug && memoryQueue[i].status === "error") {
      memoryQueue.splice(i, 1);
    }
  }

  const entry: QueueEntry & { llmConfig?: LLMConfig } = {
    id: `bench-${Date.now()}`,
    repo: repoSlug,
    repoUrl: `https://github.com/${repoSlug}.git`,
    status: "pending",
    stage: "queued",
    submittedAt: new Date().toISOString(),
    llmConfig,
  };

  memoryQueue.push(entry);

  if (!processing) {
    void processQueue();
  }

  return { queued: true, position: memoryQueue.filter((e) => e.status === "pending").length };
}

// ---------------------------------------------------------------------------
// Queue processor
// ---------------------------------------------------------------------------

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;

  try {
    while (true) {
      const job = memoryQueue.find((e) => e.status === "pending");
      if (!job) break;

      job.status = "running";
      try {
        await runBenchmarkJob(job);
        job.status = "done";
        job.stage = "saving";
      } catch (err) {
        job.status = "error";
        job.error = err instanceof Error ? err.message : String(err);
        console.error(`[benchmark] Failed for ${job.repo}:`, job.error);
      }

      delete job.llmConfig;
      if (job.tmpDir) {
        await rm(job.tmpDir, { recursive: true, force: true }).catch(() => {});
        delete job.tmpDir;
      }
    }
  } finally {
    processing = false;
  }
}

async function runBenchmarkJob(job: QueueEntry & { llmConfig?: LLMConfig; tmpDir?: string }): Promise<void> {
  const tmpDir = await mkdtemp(join(tmpdir(), "codeprism-bench-"));
  job.tmpDir = tmpDir;
  // Clone into a named subdirectory so autoDiscover finds it as a repo
  const repoShortName = job.repo.split("/").pop() ?? "repo";
  const clonePath = join(tmpDir, repoShortName);
  // Build a unique label for this LLM config so results from different models coexist
  const llmLabel = job.llmConfig
    ? `${job.llmConfig.provider}${job.llmConfig.model ? `-${job.llmConfig.model}` : ""}`
    : undefined;
  const benchDbPath = getBenchDbPath(job.repo, llmLabel);

  // Stage 1: Clone
  job.stage = "cloning";
  console.log(`[benchmark] Cloning ${job.repoUrl}…`);
  execSync(`git clone --depth 1 ${job.repoUrl} ${clonePath}`, {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
    env: { ...(process.env as Record<string, string>), PATH: EXTENDED_PATH },
  });

  // Stage 2: Analyze
  job.stage = "analyzing";
  const fileCount = countSourceFiles(clonePath);
  console.log(`[benchmark] ${job.repo}: ${fileCount} source files`);

  if (fileCount >= FILE_CAP && !job.llmConfig) {
    throw new Error(`Repository has ${fileCount} files (>= ${FILE_CAP}). An API key is required for large repos.`);
  }

  const { language, framework } = detectLanguageAndFramework(clonePath);

  // Stage 3: Index (into per-repo DB)
  // CODEPRISM_WORKSPACE = tmpDir so autoDiscover finds the cloned repo subdirectory
  job.stage = "indexing";
  console.log(`[benchmark] Indexing ${job.repo} (${language}/${framework}) -> ${benchDbPath}`);
  await runIndex(tmpDir, repoShortName, benchDbPath, job.llmConfig);

  // Stage 4: Benchmark queries (against per-repo DB)
  job.stage = "benchmarking";
  console.log(`[benchmark] Running benchmark queries for ${job.repo}…`);
  const { cases, flows, cardCount } = runBenchmarkQueries(benchDbPath, job.repo, clonePath);

  // Stage 4b: LLM-as-judge quality evaluation (only when LLM key is provided)
  if (job.llmConfig && cases.some((c) => c.result_count > 0)) {
    console.log(`[benchmark] Running quality evaluation for ${job.repo}…`);
    const evalDb = new Database(benchDbPath, { readonly: true });
    try {
      for (const c of cases) {
        if (c.result_count === 0) continue;
        try {
          const ftsTerms = extractKeyTerms(c.query);
          let cardRows: Array<{ content: string }> = [];
          if (ftsTerms) {
            try {
              cardRows = evalDb
                .prepare("SELECT c.content FROM cards_fts f JOIN cards c ON c.rowid = f.rowid WHERE cards_fts MATCH ? AND c.stale = 0 LIMIT 5")
                .all(ftsTerms) as typeof cardRows;
            } catch { /* ignore */ }
          }
          if (cardRows.length === 0) {
            cardRows = evalDb
              .prepare("SELECT content FROM cards WHERE stale = 0 LIMIT 5")
              .all() as typeof cardRows;
          }
          const score = await evaluateCardQuality(c.query, cardRows.map((r) => r.content), job.llmConfig);
          if (score >= 0) c.quality_score = score;
        } catch { /* skip quality eval for this query */ }
      }
    } finally {
      evalDb.close();
    }
  }

  // Stage 5: Save results
  job.stage = "saving";
  const project = buildProjectResult(job.repo, language, framework, cases, !!job.llmConfig, cardCount, llmLabel);

  await appendProjectToBenchmarks(project);

  console.log(`[benchmark] Completed ${job.repo}: ${cases.length} queries, ${flows} flows detected`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countSourceFiles(dir: string): number {
  try {
    const output = execSync(
      `find . -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.py" -o -name "*.rb" -o -name "*.go" -o -name "*.rs" -o -name "*.java" -o -name "*.kt" -o -name "*.swift" -o -name "*.vue" -o -name "*.svelte" -o -name "*.php" \\) | grep -v node_modules | grep -v vendor | grep -v ".git/" | wc -l`,
      { cwd: dir, stdio: ["ignore", "pipe", "pipe"] },
    );
    return parseInt(output.toString().trim(), 10) || 0;
  } catch {
    return 0;
  }
}

export function detectLanguageAndFramework(dir: string): { language: string; framework: string } {
  const markers: Array<{ file: string; lang: string; fw: string }> = [
    { file: "Gemfile", lang: "Ruby", fw: "Ruby" },
    { file: "composer.json", lang: "PHP", fw: "PHP" },
    { file: "requirements.txt", lang: "Python", fw: "Python" },
    { file: "pyproject.toml", lang: "Python", fw: "Python" },
    { file: "go.mod", lang: "Go", fw: "Go" },
    { file: "Cargo.toml", lang: "Rust", fw: "Rust" },
    { file: "package.json", lang: "JavaScript", fw: "Node.js" },
    { file: "tsconfig.json", lang: "TypeScript", fw: "TypeScript" },
    { file: "pom.xml", lang: "Java", fw: "Java" },
    { file: "build.gradle", lang: "Java", fw: "Java" },
    { file: "Package.swift", lang: "Swift", fw: "Swift" },
  ];

  for (const m of markers) {
    try {
      execSync(`test -f ${join(dir, m.file)}`, { stdio: "ignore" });
      if (m.file === "Gemfile") {
        try {
          const gemfile = execSync(`cat ${join(dir, m.file)}`, { encoding: "utf-8" });
          if (gemfile.includes("'rails'") || gemfile.includes('"rails"')) return { language: "Ruby", framework: "Rails" };
          if (gemfile.includes("'sinatra'") || gemfile.includes('"sinatra"')) return { language: "Ruby", framework: "Sinatra" };
          if (gemfile.includes("'rack'") || gemfile.includes('"rack"')) return { language: "Ruby", framework: "Rack" };
        } catch { /* fall through */ }
        return { language: "Ruby", framework: "Ruby" };
      }
      if (m.file === "package.json") {
        try {
          const pkg = JSON.parse(execSync(`cat ${join(dir, m.file)}`, { encoding: "utf-8" }));
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };
          if (deps["next"]) return { language: "TypeScript", framework: "Next.js" };
          if (deps["react"]) return { language: "TypeScript", framework: "React" };
          if (deps["vue"]) return { language: "TypeScript", framework: "Vue" };
          if (deps["express"]) return { language: "JavaScript", framework: "Express" };
          if (deps["fastify"]) return { language: "TypeScript", framework: "Fastify" };
          if (deps["@angular/core"]) return { language: "TypeScript", framework: "Angular" };
        } catch { /* fall through */ }
        if (m.lang === "JavaScript") {
          try {
            execSync(`test -f ${join(dir, "tsconfig.json")}`, { stdio: "ignore" });
            return { language: "TypeScript", framework: "TypeScript" };
          } catch { /* fall through */ }
        }
      }
      if (m.file === "go.mod") {
        try {
          const gomod = execSync(`cat ${join(dir, m.file)}`, { encoding: "utf-8" });
          if (gomod.includes("gin-gonic")) return { language: "Go", framework: "Gin" };
          if (gomod.includes("echo")) return { language: "Go", framework: "Echo" };
          if (gomod.includes("fiber")) return { language: "Go", framework: "Fiber" };
        } catch { /* fall through */ }
      }
      if (m.file === "requirements.txt" || m.file === "pyproject.toml") {
        try {
          const content = execSync(`cat ${join(dir, m.file)}`, { encoding: "utf-8" }).toLowerCase();
          if (content.includes("fastapi")) return { language: "Python", framework: "FastAPI" };
          if (content.includes("djangorestframework")) return { language: "Python", framework: "Django" };
          if (content.includes("django")) return { language: "Python", framework: "Django" };
          if (content.includes("flask")) return { language: "Python", framework: "Flask" };
        } catch { /* fall through */ }
      }
      if (m.file === "composer.json") {
        try {
          const composer = JSON.parse(execSync(`cat ${join(dir, m.file)}`, { encoding: "utf-8" }));
          const require = { ...composer.require, ...composer["require-dev"] };
          if (require["laravel/framework"] || require["laravel/laravel"]) return { language: "PHP", framework: "Laravel" };
          if (require["symfony/symfony"] || require["symfony/framework-bundle"]) return { language: "PHP", framework: "Symfony" };
          if (require["slim/slim"]) return { language: "PHP", framework: "Slim" };
          if (require["cakephp/cakephp"]) return { language: "PHP", framework: "CakePHP" };
        } catch { /* fall through */ }
        return { language: "PHP", framework: "PHP" };
      }
      return { language: m.lang, framework: m.fw };
    } catch { /* file doesn't exist */ }
  }

  return { language: "Unknown", framework: "Unknown" };
}

async function runIndex(
  repoPath: string,
  repoName: string,
  benchDbPath: string,
  llmConfig?: LLMConfig,
): Promise<void> {
  const skipDocs = !llmConfig;
  const engineRoot = join(__dirname, "../..");

  // Detect whether we're running from compiled dist/ (production/Docker) or src/ (dev with tsx).
  // __dirname is e.g. /app/packages/engine/dist/services in prod, or .../src/services in dev.
  const isCompiled = __dirname.replace(/\\/g, "/").includes("/dist/");
  let cmd: string;
  let args: string[];
  if (isCompiled) {
    // Production: compiled JS available, node resolves it directly
    cmd = "node";
    args = [join(engineRoot, "dist/cli/index-repos.js"), "--repo", repoName];
  } else {
    // Development: TypeScript source, run via tsx
    cmd = "npx";
    args = ["tsx", join(engineRoot, "src/cli/index-repos.ts"), "--repo", repoName];
  }
  if (skipDocs) args.push("--skip-docs");

  const childEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
    CODEPRISM_WORKSPACE: repoPath,
    CODEPRISM_DB_PATH: benchDbPath,
    PATH: EXTENDED_PATH,
  };

  if (llmConfig) {
    childEnv["CODEPRISM_LLM_PROVIDER"] = llmConfig.provider;
    childEnv["CODEPRISM_LLM_API_KEY"] = llmConfig.apiKey;
  }

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: engineRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: childEnv,
      timeout: 300_000,
    });

    const logs: string[] = [];
    child.stdout?.on("data", (chunk: Buffer) => {
      const lines = String(chunk).split("\n").filter(Boolean);
      lines.forEach((l) => {
        logs.push(l);
        console.log(`[indexer:${repoName}] ${l}`);
      });
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const lines = String(chunk).split("\n").filter(Boolean);
      lines.forEach((l) => {
        logs.push(l);
        if (!l.includes("ExperimentalWarning")) console.warn(`[indexer:${repoName}] ${l}`);
      });
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Indexing failed (exit ${code}):\n${logs.slice(-10).join("\n")}`));
      }
    });

    child.on("error", (err) => reject(err));
  });
}

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "do", "does",
  "for", "from", "has", "have", "how", "i", "if", "in", "is", "it",
  "its", "of", "on", "or", "the", "to", "was", "what", "when",
  "where", "which", "who", "why", "with", "work", "works",
  "implement", "implementation", "data", "model", "module",
]);

function extractKeyTerms(query: string): string {
  const words = query
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w.toLowerCase()));
  return words.join(" ");
}

function deriveModuleQueries(
  db: InstanceType<typeof Database>,
  repoShort: string,
): Array<{ query: string; expectedFiles: string[] }> {
  const queries: Array<{ query: string; expectedFiles: string[] }> = [];
  try {
    // Find distinct directories under lib/, src/, app/ that contain source files
    const rows = db
      .prepare(`
        SELECT path FROM file_index
        WHERE path NOT LIKE '%test%'
          AND path NOT LIKE '%spec%'
          AND path NOT LIKE '%example%'
          AND path NOT LIKE '%benchmark%'
          AND path NOT LIKE '%node_modules%'
        ORDER BY path
      `)
      .all() as Array<{ path: string }>;

    // Group files by their parent directory (2nd level under the repo root)
    const modules = new Map<string, string[]>();
    for (const r of rows) {
      const parts = r.path.split("/");
      // Skip files at repo root (index.js, etc.)
      if (parts.length < 3) continue;
      // Use the second-level directory as the module name (e.g., "lib", "src/routes")
      const moduleKey = parts.slice(1, Math.min(parts.length - 1, 3)).join("/");
      if (!modules.has(moduleKey)) modules.set(moduleKey, []);
      modules.get(moduleKey)!.push(r.path);
    }

    // Sort by file count descending, take the most substantial modules
    const sorted = [...modules.entries()]
      .filter(([, files]) => files.length >= 2)
      .sort((a, b) => b[1].length - a[1].length);

    for (const [mod, files] of sorted.slice(0, 6)) {
      const modName = mod.replace(/\//g, " ").replace(/[-_]/g, " ");
      queries.push({
        query: `${modName} module in ${repoShort}`,
        expectedFiles: files.slice(0, 10),
      });
      if (queries.length >= MAX_QUERIES_PER_PROJECT) break;
    }

    // Add entry-point / core files query
    const coreFiles = rows
      .filter((r) => {
        const parts = r.path.split("/");
        return parts.length <= 3 && !r.path.includes("test");
      })
      .map((r) => r.path)
      .slice(0, 10);

    if (coreFiles.length > 0 && queries.length < MAX_QUERIES_PER_PROJECT) {
      queries.push({
        query: `How does ${repoShort} work?`,
        expectedFiles: coreFiles,
      });
    }
  } catch { /* ignore */ }
  return queries;
}

function estimateTokens(text: string): number {
  // Keep benchmark accounting consistent with the rest of the codebase (~4 chars/token).
  return Math.ceil(text.length / 4);
}

function estimateFileTokens(repoDir: string, relPath: string): number | null {
  try {
    // Note: benchmark DB source file paths are relative to repo root.
    const content = readFileSync(join(repoDir, relPath), "utf-8");
    return estimateTokens(content);
  } catch {
    return null;
  }
}

function runBenchmarkQueries(
  benchDbPath: string,
  repoName: string,
  repoDir: string,
): { cases: BenchmarkCase[]; flows: number; cardCount: number } {
  let db: InstanceType<typeof Database>;
  try {
    db = new Database(benchDbPath, { readonly: true });
    sqliteVec.load(db);
  } catch {
    return { cases: [], flows: 0, cardCount: 0 };
  }

  try {
    const repoShort = repoName.split("/")[1] ?? repoName;

    let flowRows: Array<{ flow: string }> = [];
    try {
      flowRows = db
        .prepare("SELECT DISTINCT flow FROM cards WHERE stale = 0")
        .all() as Array<{ flow: string }>;
    } catch {
      flowRows = [];
    }

    // Count available cards
    let cardCount = 0;
    try {
      cardCount = (db.prepare("SELECT COUNT(*) as cnt FROM cards WHERE stale = 0").get() as { cnt: number }).cnt;
    } catch { /* ignore */ }

    const queries: Array<{ query: string; expectedFlow: string; expectedFiles?: string[] }> = [];
    for (const row of flowRows) {
      if (queries.length >= MAX_QUERIES_PER_PROJECT) break;
      queries.push(
        { query: `How does the ${row.flow} work?`, expectedFlow: row.flow },
        { query: `${row.flow} implementation and data model`, expectedFlow: row.flow },
      );
    }

    // When no cards/flows exist, generate queries from the file structure
    if (queries.length === 0) {
      const moduleQueries = deriveModuleQueries(db, repoShort);
      for (const mq of moduleQueries) {
        queries.push({ query: mq.query, expectedFlow: "", expectedFiles: mq.expectedFiles });
      }
    }

    // Final fallback
    if (queries.length === 0) {
      queries.push(
        { query: `How does the main ${repoShort} application work?`, expectedFlow: "" },
        { query: `Core data models and associations in ${repoShort}`, expectedFlow: "" },
      );
    }

    const cases: BenchmarkCase[] = [];

    for (const q of queries.slice(0, MAX_QUERIES_PER_PROJECT)) {
      const start = Date.now();
      try {
        let cards: Array<{ content: string; flow: string; source_files: string }> = [];

        if (cardCount > 0) {
          // Search against cards — use key terms only (strip stop words for better FTS precision)
          const ftsTerms = extractKeyTerms(q.query);
          if (ftsTerms) {
            try {
              const ftsCards = db
                .prepare(`SELECT c.content, c.flow, c.source_files FROM cards_fts f JOIN cards c ON c.rowid = f.rowid WHERE cards_fts MATCH ? AND c.stale = 0 LIMIT 5`)
                .all(ftsTerms) as typeof cards;
              if (ftsCards.length > 0) cards = ftsCards;
            } catch { /* FTS may not be set up */ }
          }

          if (cards.length === 0) {
            try {
              cards = db
                .prepare("SELECT content, flow, source_files FROM cards WHERE stale = 0 ORDER BY updated_at DESC LIMIT 5")
                .all() as typeof cards;
            } catch { /* ignore */ }
          }
        }

        const latency = Date.now() - start;

        const codeprismTokens = cards.reduce((sum, c) => sum + estimateTokens(c.content), 0);
        const sourceFiles = new Set<string>();
        for (const card of cards) {
          try {
            const files = JSON.parse(card.source_files || "[]") as string[];
            files.forEach((f) => sourceFiles.add(f));
          } catch { /* ignore */ }
        }

        // Naive tokens: estimate actual tokens from the underlying source files.
        // If we have no cards (or cards have no sources), fall back to expectedFiles (from file-structure queries).
        const naiveFiles = sourceFiles.size > 0
          ? Array.from(sourceFiles)
          : (q.expectedFiles?.length ? q.expectedFiles : []);

        let naiveTokens = 0;
        if (naiveFiles.length > 0) {
          for (const f of naiveFiles) {
            naiveTokens += estimateFileTokens(repoDir, f) ?? 500;
          }
        } else {
          // Conservative fallback when we can't map to files.
          naiveTokens = 2500;
        }

        let flowHit = 0;
        let fileHit = 0;
        if (q.expectedFlow) {
          flowHit = cards.some((c) => c.flow === q.expectedFlow) ? 1 : 0;
          const expectedFiles = new Set<string>();
          try {
            const flowCards = db
              .prepare("SELECT source_files FROM cards WHERE flow = ?")
              .all(q.expectedFlow) as Array<{ source_files: string }>;
            for (const fc of flowCards) {
              const files = JSON.parse(fc.source_files || "[]") as string[];
              files.forEach((f) => expectedFiles.add(f));
            }
          } catch { /* ignore */ }
          if (expectedFiles.size > 0) {
            let hits = 0;
            for (const f of expectedFiles) {
              if (sourceFiles.has(f)) hits++;
            }
            fileHit = hits / expectedFiles.size;
          }
        } else if (q.expectedFiles && q.expectedFiles.length > 0) {
          // For file-structure queries, check if cards reference any of the expected files
          const expected = new Set(q.expectedFiles);
          let hits = 0;
          for (const f of expected) {
            if (sourceFiles.has(f)) hits++;
          }
          fileHit = expected.size > 0 ? hits / expected.size : 0;
          flowHit = cards.length > 0 ? 1 : 0;
        }

        const precisionK = cards.length > 0 && q.expectedFlow
          ? cards.filter((c) => c.flow === q.expectedFlow).length / cards.length
          : cards.length > 0 ? 1 : 0;

        cases.push({
          query: q.query,
          codeprism_tokens: codeprismTokens,
          naive_tokens: naiveTokens,
          latency_ms: latency,
          cache_hit: false,
          flow_hit_rate: flowHit,
          file_hit_rate: Math.round(fileHit * 100) / 100,
          precision_at_k: Math.round(precisionK * 100) / 100,
          result_count: cards.length,
        });
      } catch (err) {
        console.warn(`[benchmark] Query failed: "${q.query}":`, err);
      }
    }

    return { cases, flows: flowRows.length, cardCount };
  } finally {
    db.close();
  }
}

function buildProjectResult(
  repoSlug: string,
  language: string,
  framework: string,
  cases: BenchmarkCase[],
  llmEnhanced: boolean,
  cardCount = 0,
  llmLabel?: string,
): BenchmarkProject {
  const name = repoSlug.split("/")[1] ?? repoSlug;
  const queriesTested = cases.length;
  const avgCodeprism = cases.length > 0 ? Math.round(cases.reduce((s, c) => s + c.codeprism_tokens, 0) / cases.length) : 0;
  const avgNaive = cases.length > 0 ? Math.round(cases.reduce((s, c) => s + c.naive_tokens, 0) / cases.length) : 0;
  const anyResults = cases.some((c) => c.result_count > 0);
  const tokenReduction = avgNaive > 0 && anyResults ? Math.round((1 - avgCodeprism / avgNaive) * 1000) / 10 : 0;
  const avgLatency = cases.length > 0 ? Math.round(cases.reduce((s, c) => s + c.latency_ms, 0) / cases.length) : 0;

  const latencies = cases.map((c) => c.latency_ms).sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] ?? 0;

  const cacheHitRate = cases.length > 0
    ? Math.round(cases.filter((c) => c.cache_hit).length / cases.length * 1000) / 1000
    : 0;
  const flowHitRate = cases.length > 0
    ? Math.round(cases.reduce((s, c) => s + c.flow_hit_rate, 0) / cases.length * 1000) / 1000
    : 0;
  const fileHitRate = cases.length > 0
    ? Math.round(cases.reduce((s, c) => s + c.file_hit_rate, 0) / cases.length * 1000) / 1000
    : 0;
  const precisionAt5 = cases.length > 0
    ? Math.round(cases.reduce((s, c) => s + c.precision_at_k, 0) / cases.length * 1000) / 1000
    : 0;
  const qualityScores = cases
    .map((c) => c.quality_score)
    .filter((s): s is number => s !== undefined && s >= 0);

  return {
    name,
    repo: repoSlug,
    language,
    framework,
    live: true,
    llmEnhanced,
    llmLabel,
    cardCount,
    dbPath: llmLabel
      ? `benchmarks/${slugify(repoSlug)}-${llmLabel}.db`
      : `benchmarks/${slugify(repoSlug)}.db`,
    stats: {
      queries_tested: queriesTested,
      avg_tokens_with_codeprism: avgCodeprism,
      avg_tokens_without: avgNaive,
      token_reduction_pct: tokenReduction,
      avg_latency_ms: avgLatency,
      p50_latency_ms: p50,
      p95_latency_ms: p95,
      p99_latency_ms: p99,
      cache_hit_rate: cacheHitRate,
      flow_hit_rate: flowHitRate,
      file_hit_rate: fileHitRate,
      precision_at_5: precisionAt5,
      ...(qualityScores.length > 0
        ? { avg_quality_score: Math.round(qualityScores.reduce((s, v) => s + v, 0) / qualityScores.length) }
        : {}),
    },
    cases,
  };
}

async function appendProjectToBenchmarks(project: BenchmarkProject): Promise<void> {
  let file: BenchmarkFile;
  try {
    const raw = await readFile(BENCHMARKS_PATH, "utf-8");
    file = JSON.parse(raw);
  } catch {
    file = { generated_at: new Date().toISOString(), projects: [], aggregate: {} };
  }

  file.projects.push(project);
  file.generated_at = new Date().toISOString();

  const projects = file.projects;
  const totalQueries = projects.reduce((s, p) => s + (p.stats.queries_tested ?? 0), 0);
  file.aggregate = {
    total_projects: projects.length,
    total_queries: totalQueries,
    avg_token_reduction_pct: Math.round(
      projects.reduce((s, p) => s + (p.stats.token_reduction_pct ?? 0), 0) / projects.length * 10,
    ) / 10,
    avg_latency_ms: Math.round(
      projects.reduce((s, p) => s + (p.stats.avg_latency_ms ?? 0), 0) / projects.length,
    ),
    avg_flow_hit_rate: Math.round(
      projects.reduce((s, p) => s + (p.stats.flow_hit_rate ?? 0), 0) / projects.length * 1000,
    ) / 1000,
    avg_cache_hit_rate: Math.round(
      projects.reduce((s, p) => s + (p.stats.cache_hit_rate ?? 0), 0) / projects.length * 1000,
    ) / 1000,
  };

  await writeFile(BENCHMARKS_PATH, JSON.stringify(file, null, 2), "utf-8");
}

/**
 * LLM-as-judge evaluation: asks an LLM to score how well the returned cards
 * answer the original query. Returns a score 0-100.
 * Only called when the user provides their own LLM API key.
 */
async function evaluateCardQuality(
  query: string,
  cardContents: string[],
  llmConfig: LLMConfig,
): Promise<number> {
  if (cardContents.length === 0) return 0;

  const { createLLMProvider } = await import("../llm/provider.js");
  const providerMap: Record<string, string> = {
    gemini: "gemini",
    openai: "openai",
    deepseek: "deepseek",
    anthropic: "anthropic",
  };
  const llm = createLLMProvider({
    provider: (providerMap[llmConfig.provider] ?? "none") as "gemini" | "openai" | "deepseek" | "anthropic" | "none",
    apiKey: llmConfig.apiKey,
  });
  if (!llm) return -1;

  const prompt = [
    "You are evaluating a code search system. A developer asked a question and the system returned knowledge cards.",
    "",
    `Question: "${query}"`,
    "",
    "Returned cards:",
    cardContents.map((c, i) => `--- Card ${i + 1} ---\n${c.slice(0, 500)}`).join("\n\n"),
    "",
    "Score the relevance of these cards to the question on a scale of 0-100:",
    "- 0-20: Cards are completely irrelevant",
    "- 21-40: Cards are tangentially related but don't answer the question",
    "- 41-60: Cards contain some relevant information but miss key details",
    "- 61-80: Cards mostly answer the question with good context",
    "- 81-100: Cards precisely answer the question with complete, relevant context",
    "",
    "Respond with ONLY a number between 0 and 100.",
  ].join("\n");

  try {
    const response = await llm.generate(prompt, { maxTokens: 10 });
    const score = parseInt(response.trim(), 10);
    return Number.isNaN(score) ? -1 : Math.min(100, Math.max(0, score));
  } catch {
    return -1;
  }
}

function readBenchmarkFileSync(): BenchmarkFile | null {
  try {
    const raw = readFileSync(BENCHMARKS_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
