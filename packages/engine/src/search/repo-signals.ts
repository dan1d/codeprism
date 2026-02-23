/**
 * repo-signals.ts
 *
 * Derives keyword signals per repository from:
 *   1. Detected stack profile (language + frameworks) — deterministic, always available
 *   2. File class-type distribution from file_index — structural, always available
 *   3. LLM-generated project docs (about, architecture, pages) — optional enrichment
 *      using cross-corpus TF-IDF so generic web-app terms don't dominate
 *
 * Design constraints:
 *   - Zero LLM calls at query time — all computation is at index time
 *   - Project-agnostic — no hardcoded repo names anywhere
 *   - Works for monoliths (single repo = BE + FE), microservices, Lambda, unknown stacks
 *   - Signals survive server restart (persisted in `repo_signals` table, migration v16)
 *   - Manual overrides are respected (locked = 1 rows are never overwritten)
 */

import { getDb } from "../db/connection.js";
import type { StackProfile } from "../indexer/stack-profiler.js";

// ---------------------------------------------------------------------------
// Lookup tables — all stack-specific signals derived deterministically
// ---------------------------------------------------------------------------

export const LANGUAGE_SIGNALS: Record<string, string[]> = {
  ruby:       ["ruby", "gem", "gemfile", "bundler", "rake"],
  python:     ["python", "pip", "requirements", "virtualenv"],
  go:         ["go", "golang", "goroutine"],
  typescript: ["typescript", "tsconfig"],
  javascript: ["javascript", "node"],
  php:        ["php", "composer", "artisan"],
  rust:       ["rust", "cargo", "crate", "trait"],
  java:       ["java", "maven", "gradle", "jvm", "spring"],
  unknown:    [],
};

export const FRAMEWORK_SIGNALS: Record<string, string[]> = {
  // Ruby
  rails:     ["rails", "controller", "model", "migration", "concern", "serializer",
               "job", "mailer", "activerecord", "active record", "has_many",
               "belongs_to", "scope", "validation", "callback", "association"],
  cuba:      ["cuba", "rum"],
  sinatra:   ["sinatra"],

  // Python
  django:    ["django", "orm", "queryset", "urlconf", "admin", "template", "migrations"],
  fastapi:   ["fastapi", "pydantic", "dependency", "router"],
  flask:     ["flask", "blueprint", "jinja", "werkzeug"],
  starlette: ["starlette", "asgi"],

  // JavaScript / TypeScript
  react:   ["react", "component", "hook", "jsx", "tsx", "props",
             "redux", "context", "usestate", "useeffect"],
  nextjs:  ["nextjs", "getserversideprops", "getstaticprops",
             "api route", "app router", "layout", "server component"],
  vue:     ["vue", "composable", "pinia", "vuex", "directive", "emit", "ref", "reactive"],
  express: ["express", "middleware", "app.get", "app.post"],
  fastify: ["fastify", "plugin"],

  // Go
  gin:   ["gin", "ginrouter"],
  echo:  ["echo", "echorouter"],
  fiber: ["fiber"],
  chi:   ["chi", "chirouter"],

  // Rust
  actix:  ["actix", "actixweb", "httpserver"],
  axum:   ["axum", "axumrouter", "extract"],
  rocket: ["rocket", "rocketroute", "fairing"],

  // PHP
  laravel: ["laravel", "eloquent", "blade", "facade", "service provider"],
};

// Frameworks that imply backend API logic
const BE_FRAMEWORKS = new Set([
  "rails", "cuba", "sinatra",
  "django", "fastapi", "flask", "starlette",
  "express", "fastify",
  "gin", "echo", "fiber", "chi",
  "actix", "axum", "rocket",
  "laravel",
  "nextjs", // Next.js has API routes
]);

// Frameworks that imply frontend rendering
const FE_FRAMEWORKS = new Set(["react", "nextjs", "vue"]);

// Pure backend languages — absence of any framework still implies API/server
const BACKEND_LANGUAGES = new Set(["ruby", "python", "go", "php", "rust", "java"]);

export const ROLE_SIGNALS: Record<"backend" | "frontend", string[]> = {
  backend:  ["backend", "api", "server", "endpoint", "database", "db"],
  frontend: ["frontend", "ui", "client", "component", "render", "stylesheet"],
};

export const LAMBDA_SIGNALS: string[] = [
  "lambda", "serverless", "function", "handler", "event", "trigger",
  "aws", "faas", "cloud function",
];

// Class type tags that indicate BE vs FE orientation
const BE_CLASS_TYPES = new Set(["model", "controller", "job", "service", "serializer",
                                 "concern", "middleware", "mailer"]);
const FE_CLASS_TYPES = new Set(["component", "store"]);

// ---------------------------------------------------------------------------
// Stop words for domain term extraction
// ---------------------------------------------------------------------------

/** Words excluded from domain term extraction — too common to be discriminative. */
const STOP_WORDS = new Set([
  // Common English
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "as", "is", "was", "are", "were", "be",
  "been", "being", "have", "has", "had", "do", "does", "did", "will",
  "would", "could", "should", "may", "might", "shall", "can", "that",
  "this", "these", "those", "it", "its", "they", "them", "their",
  "what", "which", "who", "when", "where", "why", "how", "all", "any",
  "both", "each", "few", "more", "most", "other", "some", "such",
  "not", "only", "same", "so", "than", "too", "very", "just", "also",
  "into", "over", "after", "then", "there", "about", "up", "out",
  // Generic programming / doc vocabulary (appear in every project's about page)
  "code", "file", "files", "function", "class", "method", "module",
  "package", "library", "framework", "type", "interface", "data", "value",
  "object", "string", "number", "list", "array", "map", "null", "true",
  "false", "new", "return", "import", "export", "const", "let", "var",
  "use", "used", "using", "provides", "handles", "manages", "allows",
  "enables", "supports", "contains", "includes", "implements", "extends",
  "based", "via", "per", "across", "within", "between", "during",
  "following", "example", "note", "system", "application", "app",
  "repo", "repository", "project", "source", "target", "request", "response",
  "error", "test", "spec", "config", "setting", "option", "user", "users",
  "create", "read", "update", "delete", "fetch", "send", "load", "save",
  "page", "view", "form", "table", "item", "field", "column", "row",
  "service",  // too generic — appears in every microservice about page
  "server",   // same
  "client",   // same
  "web",      // same
  "rest",     // same
  "http",     // same
  "json",     // same
  "auth",     // same (intentional short form; specific long forms like "authorization" pass through)
]);

/**
 * Generic tokens that appear in many repo names but carry no discriminative
 * signal at query time. Filtered from repo-name token generation.
 */
const REPO_NAME_STOPLIST = new Set([
  "api", "app", "web", "service", "core", "main", "server", "client",
  "backend", "frontend", "ui", "spa", "lib", "pkg", "base", "common",
  "shared", "platform", "portal", "gateway", "repo", "project",
]);

// ---------------------------------------------------------------------------
// Cross-corpus TF-IDF domain term extraction
// ---------------------------------------------------------------------------

/**
 * Extracts domain-specific terms using cross-corpus inverse document frequency.
 *
 * All repos' docs are loaded together so terms that appear in every repo's
 * about page (e.g. "authentication", "API", "user") are penalized by their
 * high document frequency. Only terms that are characteristic of ONE or FEW
 * repos survive — these are the actual domain signals (e.g. "prescription",
 * "billing_order", "blood_pressure", "pre_authorization").
 *
 * Algorithm:
 *   1. Extract candidate terms: 4+ char words, hyphenated, snake_case, CamelCase
 *   2. Count term frequency (TF) within each repo's doc set
 *   3. Count document frequency (DF) across all repos' doc sets
 *   4. TF-IDF = TF × log(N / DF + 1)  where N = total number of repos with docs
 *   5. Filter freq < 2 and apply STOP_WORDS
 *   6. Return top topN by TF-IDF score for each repo
 *
 * @param allRepoDocs - Map of repoName → array of doc content strings
 * @param topN        - Maximum domain signals to return per repo
 */
export function extractCrossCorpusDomainTerms(
  allRepoDocs: Map<string, string[]>,
  topN = 12,
): Map<string, string[]> {
  const N = allRepoDocs.size;
  if (N === 0) return new Map();

  // Step 1 + 2: TF per repo
  const repoTermFreq = new Map<string, Map<string, number>>();
  // Step 3: DF across all repos
  const docFreq = new Map<string, number>(); // term → number of repos that contain it

  for (const [repo, docs] of allRepoDocs) {
    const localFreq = new Map<string, number>();
    const repoText = docs.join("\n");
    const lower = repoText.toLowerCase();

    const addTerm = (term: string, weight: number) => {
      if (!STOP_WORDS.has(term) && term.length >= 4) {
        localFreq.set(term, (localFreq.get(term) ?? 0) + weight);
      }
    };

    // Single words (alpha-only, 4+ chars)
    for (const w of (lower.match(/\b[a-z]{4,}\b/g) ?? [])) {
      addTerm(w, 1);
    }
    // Hyphenated compounds (e.g. "pre-authorization") — weight ×2
    for (const t of (lower.match(/\b[a-z][a-z0-9]*(?:-[a-z][a-z0-9]+)+\b/g) ?? [])) {
      addTerm(t, 2);
    }
    // snake_case compounds (e.g. "blood_pressure") — weight ×2
    for (const t of (lower.match(/\b[a-z][a-z0-9]*(?:_[a-z][a-z0-9]+)+\b/g) ?? [])) {
      addTerm(t, 2);
    }
    // CamelCase proper nouns from original text — weight ×2
    for (const t of (repoText.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g) ?? [])) {
      const lower2 = t.toLowerCase();
      if (!STOP_WORDS.has(lower2) && lower2.length >= 4) {
        localFreq.set(lower2, (localFreq.get(lower2) ?? 0) + 2);
      }
    }

    repoTermFreq.set(repo, localFreq);

    // Count which terms appear in this repo (DF)
    for (const term of localFreq.keys()) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
  }

  // Step 4–6: TF-IDF per repo
  const result = new Map<string, string[]>();
  for (const [repo, localFreq] of repoTermFreq) {
    const scored: Array<[string, number]> = [];
    for (const [term, tf] of localFreq) {
      if (tf < 2) continue; // hapax legomena are noise
      const df = docFreq.get(term) ?? 1;
      const idf = Math.log((N + 1) / df); // standard smoothed IDF
      scored.push([term, tf * idf]);
    }
    scored.sort((a, b) => b[1] - a[1]);
    result.set(repo, scored.slice(0, topN).map(([term]) => term));
  }

  return result;
}

// ---------------------------------------------------------------------------
// Core signal generation — pure function, no DB/IO
// ---------------------------------------------------------------------------

export interface SignalSources {
  language: string[];
  framework: string[];
  role: string[];
  domain: string[];
  repoName: string[];
}

export interface GenerateRepoSignalsResult {
  signals: string[];
  sources: SignalSources;
}

/**
 * Derives keyword signals for a single repo from its detected stack profile,
 * file class-type distribution, and optional cross-corpus domain terms.
 *
 * Pure function — all DB I/O happens in {@link generateAndSaveAllRepoSignals}.
 */
export function generateRepoSignals(
  repoName: string,
  profile: StackProfile,
  domainTerms: string[],
  classTypeCounts: Record<string, number>,
): GenerateRepoSignalsResult {
  const allSignals = new Set<string>();
  const sources: SignalSources = {
    language: [], framework: [], role: [], domain: [], repoName: [],
  };

  const add = (sigs: string[], bucket: keyof SignalSources) => {
    for (const s of sigs) {
      allSignals.add(s);
      (sources[bucket] as string[]).push(s);
    }
  };

  // 1. Language base signals
  add(LANGUAGE_SIGNALS[profile.primaryLanguage] ?? [], "language");

  // 2. Framework signals
  for (const fw of profile.frameworks) {
    add(FRAMEWORK_SIGNALS[fw] ?? [], "framework");
  }

  // 3. Lambda signals
  if (profile.isLambda) add(LAMBDA_SIGNALS, "role");

  // 4. Role signals (backend / frontend)
  //    Primary source: detected frameworks
  //    Secondary source: language (backend languages → BE)
  //    Tertiary source: class-type distribution from parsed files
  const hasBeFramework = profile.frameworks.some((f) => BE_FRAMEWORKS.has(f));
  const hasFeFramework = profile.frameworks.some((f) => FE_FRAMEWORKS.has(f));
  const isBackendLang  = BACKEND_LANGUAGES.has(profile.primaryLanguage);

  // Class distribution: count BE vs FE class types
  let beCls = 0, feCls = 0;
  for (const [type, count] of Object.entries(classTypeCounts)) {
    if (BE_CLASS_TYPES.has(type)) beCls += count;
    if (FE_CLASS_TYPES.has(type)) feCls += count;
  }
  const totalCls = beCls + feCls;
  const beByClass = totalCls > 5 && beCls / totalCls > 0.40;
  const feByClass = totalCls > 5 && feCls / totalCls > 0.40;

  const addBe = hasBeFramework || (!hasFeFramework && isBackendLang) || beByClass;
  const addFe = hasFeFramework || feByClass;

  if (addBe) add(ROLE_SIGNALS.backend,  "role");
  if (addFe) add(ROLE_SIGNALS.frontend, "role");

  // 5. Cross-corpus TF-IDF domain terms (computed outside, passed in)
  add(domainTerms, "domain");

  // 6. Repo name tokens — filtered by stoplist to avoid noise from generic words
  const nameTokens = repoName
    .toLowerCase()
    .split(/[-_\s]+/)
    .filter((w) => w.length > 1 && !REPO_NAME_STOPLIST.has(w) && !STOP_WORDS.has(w));
  add(nameTokens, "repoName");

  return { signals: [...allSignals], sources };
}

// ---------------------------------------------------------------------------
// DB helpers (index-time only)
// ---------------------------------------------------------------------------

interface StoredProfile {
  primary_language: string;
  frameworks: string;
  is_lambda: number;
  package_manager: string;
  skill_ids: string;
}

function parseProfile(row: StoredProfile): StackProfile {
  const safeJsonParse = (s: string): string[] => {
    try { return JSON.parse(s) as string[]; } catch { return []; }
  };
  return {
    primaryLanguage: row.primary_language as StackProfile["primaryLanguage"],
    frameworks:      safeJsonParse(row.frameworks),
    isLambda:        row.is_lambda === 1,
    packageManager:  row.package_manager,
    skillIds:        safeJsonParse(row.skill_ids),
  };
}

/** Loads all repo profiles from DB. */
function getAllProfiles(): Map<string, StackProfile> {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM repo_profiles")
    .all() as Array<StoredProfile & { repo: string }>;
  const map = new Map<string, StackProfile>();
  for (const row of rows) map.set(row.repo, parseProfile(row));
  return map;
}

/** Loads relevant project_docs content for all repos in one query. */
function getAllDocContents(): Map<string, string[]> {
  const db = getDb();
  const RELEVANT = ["about", "architecture", "pages", "be_overview"];
  const placeholders = RELEVANT.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT repo, content FROM project_docs WHERE doc_type IN (${placeholders}) AND LENGTH(content) > 0`,
    )
    .all(...RELEVANT) as { repo: string; content: string }[];

  const map = new Map<string, string[]>();
  for (const row of rows) {
    const existing = map.get(row.repo) ?? [];
    existing.push(row.content);
    map.set(row.repo, existing);
  }
  return map;
}

/** Counts ClassInfo.type distribution across all parsed files for a repo. */
function getClassTypeCounts(repoName: string): Record<string, number> {
  const db = getDb();
  const rows = db
    .prepare("SELECT parsed_data FROM file_index WHERE repo = ?")
    .all(repoName) as { parsed_data: string }[];

  const counts: Record<string, number> = {};
  for (const row of rows) {
    try {
      const data = JSON.parse(row.parsed_data) as { classes?: { type?: string }[] };
      for (const cls of data.classes ?? []) {
        if (cls.type) counts[cls.type] = (counts[cls.type] ?? 0) + 1;
      }
    } catch { /* skip malformed */ }
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Index-time: batch generation + persistence
// ---------------------------------------------------------------------------

/**
 * Generates signals for all indexed repos in one batch call.
 *
 * Uses cross-corpus TF-IDF so that IDF is computed across ALL repos' docs
 * simultaneously — terms appearing in every repo's about page are penalized.
 *
 * Repos with `locked = 1` in the `repo_signals` table are skipped.
 * Call this after `saveRepoProfile()` and after `project_docs` are generated.
 */
export function generateAndSaveAllRepoSignals(): void {
  const db = getDb();

  const profiles = getAllProfiles();
  if (profiles.size === 0) return;

  // Load locked repo names to skip
  const lockedRows = db
    .prepare("SELECT repo FROM repo_signals WHERE locked = 1")
    .all() as { repo: string }[];
  const locked = new Set(lockedRows.map((r) => r.repo));

  // Load all doc contents for cross-corpus IDF
  const allDocContents = getAllDocContents();
  // Restrict IDF corpus to repos that have profiles (i.e. are indexed)
  const corpusDocs = new Map<string, string[]>();
  for (const [repo] of profiles) {
    corpusDocs.set(repo, allDocContents.get(repo) ?? []);
  }
  const domainTermsByRepo = extractCrossCorpusDomainTerms(corpusDocs);

  const upsert = db.prepare(`
    INSERT INTO repo_signals (repo, signals, signal_source, locked, generated_at)
    VALUES (?, ?, 'derived', 0, datetime('now'))
    ON CONFLICT(repo) DO UPDATE SET
      signals      = excluded.signals,
      signal_source = excluded.signal_source,
      generated_at = excluded.generated_at
    WHERE locked = 0
  `);

  const tx = db.transaction(() => {
    for (const [repoName, profile] of profiles) {
      if (locked.has(repoName)) {
        console.log(`  [repo-signals] ${repoName}: locked — skipping`);
        continue;
      }

      const classTypeCounts = getClassTypeCounts(repoName);
      const domainTerms     = domainTermsByRepo.get(repoName) ?? [];
      const { signals, sources } = generateRepoSignals(
        repoName, profile, domainTerms, classTypeCounts,
      );

      upsert.run(repoName, JSON.stringify(signals));

      console.log(
        `  [repo-signals] ${repoName}: ${signals.length} signals` +
        ` (lang:${sources.language.length} fw:${sources.framework.length}` +
        ` role:${sources.role.length} domain:${sources.domain.length}` +
        ` name:${sources.repoName.length})`,
      );
    }
  });

  tx();
  invalidateRepoSignalsCache();
}

// ---------------------------------------------------------------------------
// Query-time: cached load
// ---------------------------------------------------------------------------

let cachedSignals: Map<string, string[]> | null = null;

/**
 * Clears the in-memory signal cache. Called at the end of each indexing run.
 * Cross-process note: `index-repos.ts` and the MCP server are separate processes.
 * The server picks up new signals on next cache miss (after its own cache is cleared
 * on server restart, or after a TTL if TTL-based invalidation is added).
 */
export function invalidateRepoSignalsCache(): void {
  cachedSignals = null;
}

/**
 * Returns all stored repo signals as a Map<repoName, signals[]>.
 * Loaded from the `repo_signals` table once per process lifetime, then cached.
 * Returns an empty map — not null — if no signals exist yet, so callers
 * always receive a valid map and the embedding-classifier fallback takes over.
 */
export function loadRepoSignals(): Map<string, string[]> {
  if (cachedSignals !== null) return cachedSignals;

  const db = getDb();
  let rows: { repo: string; signals: string }[] = [];
  try {
    rows = db
      .prepare("SELECT repo, signals FROM repo_signals")
      .all() as { repo: string; signals: string }[];
  } catch {
    // Table not yet created (pre-migration v16 DB) — graceful empty
  }

  const result = new Map<string, string[]>();
  for (const row of rows) {
    try {
      const sigs = JSON.parse(row.signals) as string[];
      if (Array.isArray(sigs) && sigs.length > 0) result.set(row.repo, sigs);
    } catch { /* skip malformed */ }
  }

  cachedSignals = result;
  return result;
}

/**
 * Reads the full signal record for a repo including source breakdown
 * and lock status (used by the dashboard API).
 */
export interface RepoSignalRecord {
  repo: string;
  signals: string[];
  signalSource: "derived" | "manual";
  locked: boolean;
  generatedAt: string | null;
}

export function getAllRepoSignalRecords(): RepoSignalRecord[] {
  const db = getDb();
  let rows: { repo: string; signals: string; signal_source: string; locked: number; generated_at: string }[] = [];
  try {
    rows = db
      .prepare("SELECT repo, signals, signal_source, locked, generated_at FROM repo_signals ORDER BY repo")
      .all() as typeof rows;
  } catch {
    return [];
  }

  return rows.map((row) => {
    let signals: string[] = [];
    try { signals = JSON.parse(row.signals) as string[]; } catch { /* empty */ }
    return {
      repo:         row.repo,
      signals,
      signalSource: (row.signal_source ?? "derived") as "derived" | "manual",
      locked:       row.locked === 1,
      generatedAt:  row.generated_at ?? null,
    };
  });
}
