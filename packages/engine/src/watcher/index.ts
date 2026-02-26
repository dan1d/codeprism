/**
 * codeprism automatic watcher — zero-CLI knowledge base maintenance.
 *
 * Started at server boot. Watches every registered repo for:
 *
 *   1. Source file changes  → debounced in-process handleSync
 *                             → auto-reindex when stale card count ≥ threshold
 *
 *   2. .git/HEAD change     → branch switch detected, context stored automatically
 *                             so MCP queries are scoped without any manual command
 *
 *   3. .git/ORIG_HEAD created / changes
 *                           → git pull / merge detected (deduped with 500 ms debounce)
 *                             → handleSync(merge) + auto-reindex
 *
 * No CLI commands required. The developer just writes code and the KB stays fresh.
 *
 * Platform notes:
 *   - fs.watch recursive option works natively on macOS and Windows.
 *   - On Linux, kernel inotify is used. If recursive watch fails, falls back to
 *     watching known top-level subdirectories individually.
 *   - git worktrees (.git as a file) are not yet supported for git-event detection
 *     (source file watching still works).
 *
 * Multi-tenant: disabled automatically when CODEPRISM_MULTI_TENANT=true because
 *   watcher callbacks run outside the Fastify request context (no tenant DB scope).
 */

import { watch, existsSync } from "node:fs";
import { readFile, readFileSync } from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { resolve, extname, join, relative } from "node:path";
import type { FSWatcher } from "node:fs";
import { handleSync } from "../sync/receiver.js";
import { storeCheckoutContext } from "../services/context.js";
import { extractBranchContext } from "../cli/sync.js";
import { runIncrementalReindex, reindexState, getStaleCardCount } from "../services/reindex.js";
import { getDb } from "../db/connection.js";
import { runBranchGC } from "../sync/branch-gc.js";

const execAsync = promisify(exec);
const readFileAsync = promisify(readFile);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const WATCH_EXTENSIONS = new Set([
  ".rb", ".erb", ".rake", ".ru",
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte",
  ".py", ".go", ".java", ".kt", ".php", ".rs",
  ".graphql", ".gql",
  ".sql", ".json", ".yaml", ".yml", ".toml",
]);

const WATCH_FILENAMES = new Set([
  "Gemfile", "Gemfile.lock", "schema.rb", "routes.rb",
  "package.json", "go.mod", "Cargo.toml", "pyproject.toml",
]);

const IGNORE_SEGMENTS = new Set([
  "node_modules", ".git", "dist", "build", "tmp", "log",
  ".next", ".nuxt", ".turbo", "coverage", "__pycache__",
  "vendor", ".cache", ".parcel-cache",
]);

const DEFAULT_THRESHOLD = 5;
const DEBOUNCE_MS = 1_200;
const ORIG_HEAD_DEBOUNCE_MS = 500;

/** Flush immediately when pending queue exceeds this size (file storm guard). */
const MAX_PENDING = 500;

/** Skip content for files larger than this (avoids reading generated bundles etc.). */
const MAX_FILE_BYTES = 1_024 * 1_024; // 1 MB

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shouldWatchFile(filepath: string): boolean {
  const parts = filepath.split(/[/\\]/);
  if (parts.some((p) => IGNORE_SEGMENTS.has(p))) return false;
  const base = parts[parts.length - 1] ?? "";
  return WATCH_EXTENSIONS.has(extname(base)) || WATCH_FILENAMES.has(base);
}

function readGitHeadSync(repoPath: string): string {
  try {
    const raw = readFileSync(join(repoPath, ".git", "HEAD"), "utf-8").trim();
    if (raw.startsWith("ref: refs/heads/")) return raw.slice("ref: refs/heads/".length);
    return raw.slice(0, 8); // detached HEAD
  } catch {
    return "";
  }
}

/** Cached prepared statement for threshold reads. Created lazily, once per DB instance. */
let _thresholdStmt: { get: () => unknown } | null = null;

function getThreshold(): number {
  try {
    const db = getDb();
    if (!_thresholdStmt) {
      _thresholdStmt = db.prepare("SELECT value FROM search_config WHERE key = 'auto_reindex_threshold'");
    }
    const row = _thresholdStmt.get() as { value: string } | undefined;
    const n = parseInt(row?.value ?? "", 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_THRESHOLD;
  } catch {
    return DEFAULT_THRESHOLD;
  }
}

// ---------------------------------------------------------------------------
// Per-repo watcher state
// ---------------------------------------------------------------------------

interface RepoWatcher {
  name: string;
  path: string;
  watchers: FSWatcher[];
  /** Pending changed files, keyed by absolute path (inside repo.path only). */
  pending: Map<string, "added" | "modified" | "deleted">;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  origHeadTimer: ReturnType<typeof setTimeout> | null;
  /** Last known branch name — used to detect switches. */
  lastBranch: string;
}

// ---------------------------------------------------------------------------
// Auto-reindex
// ---------------------------------------------------------------------------

function maybeAutoReindex(repoName?: string): void {
  if (reindexState.status === "running") return;
  const threshold = getThreshold();
  const staleCount = getStaleCardCount(repoName);
  if (staleCount >= threshold) {
    console.log(`[watcher] ${staleCount} stale card(s) ≥ threshold ${threshold} — triggering auto-reindex for ${repoName ?? "all repos"}`);
    runIncrementalReindex(repoName);
  }
}

// ---------------------------------------------------------------------------
// Debounced file-change handler (C1, H6 fixed: async I/O)
// ---------------------------------------------------------------------------

async function flushPending(repo: RepoWatcher): Promise<void> {
  if (repo.pending.size === 0) return;

  const changedFiles = [...repo.pending.entries()];
  repo.pending.clear();

  const branch = readGitHeadSync(repo.path) || "unknown";

  // H6 fix: read files asynchronously with a concurrency cap
  const MAX_CONCURRENT_READS = 8;
  const withContent: { path: string; content: string; status: "added" | "modified" | "deleted" }[] = [];

  for (let i = 0; i < changedFiles.length; i += MAX_CONCURRENT_READS) {
    const batch = changedFiles.slice(i, i + MAX_CONCURRENT_READS);
    const batchResults = await Promise.all(
      batch.map(async ([absPath, status]) => {
        let content = "";
        if (status !== "deleted") {
          try {
            const buf = await readFileAsync(absPath);
            if (buf.byteLength <= MAX_FILE_BYTES) content = buf.toString("utf-8");
          } catch { content = ""; }
        }
        return { path: relative(repo.path, absPath), content, status };
      }),
    );
    withContent.push(...batchResults);
  }

  try {
    const result = await handleSync({
      repo: repo.name,
      branch,
      eventType: "save",
      changedFiles: withContent,
    });
    if (result.invalidated > 0) {
      console.log(`[watcher] ${repo.name}@${branch} — ${result.invalidated} card(s) marked stale (${changedFiles.length} file(s) changed)`);
      maybeAutoReindex(repo.name);
    }
  } catch (err) {
    console.error(`[watcher] sync error for ${repo.name}:`, err instanceof Error ? err.message : err);
  }
}

function scheduleFlush(repo: RepoWatcher): void {
  // H5 fix: force immediate flush when pending Map hits the cap
  if (repo.pending.size >= MAX_PENDING) {
    if (repo.debounceTimer) { clearTimeout(repo.debounceTimer); repo.debounceTimer = null; }
    void flushPending(repo);
    return;
  }
  if (repo.debounceTimer) clearTimeout(repo.debounceTimer);
  repo.debounceTimer = setTimeout(() => {
    repo.debounceTimer = null;
    void flushPending(repo);
  }, DEBOUNCE_MS);
}

// ---------------------------------------------------------------------------
// Git event detection
// ---------------------------------------------------------------------------

function handleHeadChange(repo: RepoWatcher): void {
  const newBranch = readGitHeadSync(repo.path);
  if (!newBranch || newBranch === repo.lastBranch) return;

  const prevBranch = repo.lastBranch;
  repo.lastBranch = newBranch;

  const ctx = extractBranchContext(newBranch, prevBranch);

  if (ctx.syncLevel === "skip") {
    console.log(`[watcher] ${repo.name}: checked out demo branch "${newBranch}" — context not updated`);
    return;
  }

  console.log(
    `[watcher] ${repo.name}: branch → "${newBranch}"` +
    (ctx.ticketId ? ` (ticket: ${ctx.ticketId})` : "") +
    (ctx.epicBranch ? ` (epic: ${ctx.epicBranch})` : "") +
    ` — context updated automatically`,
  );

  // M6 fix: log errors instead of silently swallowing them
  try {
    storeCheckoutContext({
      branch: newBranch,
      repo: repo.name,
      ticketId: ctx.ticketId,
      contextHint: ctx.contextHint,
      epicBranch: ctx.epicBranch,
    });
  } catch (err) {
    console.error(`[watcher] failed to store checkout context for ${repo.name}:`, err instanceof Error ? err.message : err);
  }
}

// H4 fix: debounced, deduped ORIG_HEAD handler
function scheduleOrigHead(repo: RepoWatcher): void {
  if (repo.origHeadTimer) clearTimeout(repo.origHeadTimer);
  repo.origHeadTimer = setTimeout(() => {
    repo.origHeadTimer = null;
    void handleOrigHead(repo);
  }, ORIG_HEAD_DEBOUNCE_MS);
}

async function handleOrigHead(repo: RepoWatcher): Promise<void> {
  const origHeadPath = join(repo.path, ".git", "ORIG_HEAD");
  if (!existsSync(origHeadPath)) return;

  const branch = readGitHeadSync(repo.path) || "unknown";
  const ctx = extractBranchContext(branch);
  if (ctx.syncLevel === "skip") return;

  const eventType = ctx.syncLevel === "full" ? "merge" : "pull";
  console.log(`[watcher] ${repo.name}@${branch} — git ${eventType} detected (ORIG_HEAD changed)`);

  try {
    // C1 fix: async git diff — does not block the event loop
    const { stdout } = await execAsync("git diff --name-status ORIG_HEAD HEAD", {
      cwd: repo.path, timeout: 10_000,
    });
    const raw = stdout.trim();
    if (!raw) return;

    const changedFiles: { path: string; content: string; status: "added" | "modified" | "deleted" }[] = [];
    for (const line of raw.split("\n").filter(Boolean)) {
      const [code, ...pathParts] = line.split("\t");
      if (code?.startsWith("R") && pathParts.length === 2) {
        changedFiles.push({ path: pathParts[0]!, content: "", status: "deleted" });
        changedFiles.push({ path: pathParts[1]!, content: "", status: "added" });
        continue;
      }
      const filePath = pathParts[0];
      if (!filePath) continue;
      const status = code?.startsWith("A") ? "added" : code?.startsWith("D") ? "deleted" : "modified";
      let content = "";
      if (status !== "deleted") {
        try {
          const buf = await readFileAsync(join(repo.path, filePath));
          if (buf.byteLength <= MAX_FILE_BYTES) content = buf.toString("utf-8");
        } catch { content = ""; }
      }
      changedFiles.push({ path: filePath, content, status: status as "added" | "modified" | "deleted" });
    }

    if (changedFiles.length === 0) return;

    const result = await handleSync({ repo: repo.name, branch, eventType, changedFiles });
    console.log(`[watcher] ${repo.name}@${branch} merge sync: ${result.indexed} indexed, ${result.invalidated} stale`);
    if (result.invalidated > 0) maybeAutoReindex(repo.name);

    // After a merge/pull the source branch is often deleted — run GC asynchronously
    void runBranchGC(repo.name, repo.path);
  } catch (err) {
    console.error(`[watcher] merge sync error for ${repo.name}:`, err instanceof Error ? err.message : err);
  }
}

// ---------------------------------------------------------------------------
// Watcher setup
// ---------------------------------------------------------------------------

function watchGitFiles(repo: RepoWatcher): FSWatcher[] {
  const gitDir = join(repo.path, ".git");
  const watchers: FSWatcher[] = [];

  // Watch HEAD for branch switches
  const headPath = join(gitDir, "HEAD");
  if (existsSync(headPath)) {
    try {
      const w = watch(headPath, () => handleHeadChange(repo));
      watchers.push(w);
    } catch { /* HEAD not watchable */ }
  }

  // Watch .git/ dir to detect ORIG_HEAD creation (merge/pull/rebase events).
  // H4 fix: throttled via scheduleOrigHead debounce.
  if (existsSync(gitDir)) {
    try {
      const w = watch(gitDir, (_event, filename) => {
        if (filename === "ORIG_HEAD") scheduleOrigHead(repo);
      });
      watchers.push(w);
    } catch { /* ok */ }
  }

  return watchers;
}

function watchSourceFiles(repo: RepoWatcher): FSWatcher[] {
  const watchers: FSWatcher[] = [];

  const onFileEvent = (event: string, filename: string | null) => {
    if (!filename) return;

    // C2 fix: validate that the resolved path stays within repo.path
    const absPath = resolve(repo.path, filename);
    const repoRoot = repo.path.endsWith("/") ? repo.path : `${repo.path}/`;
    if (!absPath.startsWith(repoRoot) && absPath !== repo.path) return;

    if (!shouldWatchFile(absPath)) return;

    // M3 fix: distinguish new files (rename event + exists) from modifications
    const exists = existsSync(absPath);
    const status = !exists ? "deleted" : event === "rename" ? "added" : "modified";
    repo.pending.set(absPath, status);
    scheduleFlush(repo);
  };

  try {
    const w = watch(repo.path, { recursive: true }, onFileEvent);
    w.on("error", () => { /* silently ignore watch errors */ });
    watchers.push(w);
  } catch {
    // Linux fallback: watch known top-level subdirectories + repo root for manifest files
    const TOP_DIRS = [".", "app", "src", "lib", "config", "db", "spec", "test", "packages"];
    for (const dir of TOP_DIRS) {
      const dirPath = join(repo.path, dir);
      if (!existsSync(dirPath)) continue;
      try {
        // L2 fix: include "." so root-level Gemfile, package.json etc. are caught
        const w = watch(dirPath, { recursive: dir !== "." }, onFileEvent);
        w.on("error", () => {});
        watchers.push(w);
      } catch { /* ok */ }
    }
  }

  return watchers;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const activeWatchers = new Map<string, RepoWatcher>();

/**
 * Starts watching a set of repositories.
 * Safe to call multiple times — repos already watched are skipped.
 *
 * @returns Cleanup function that stops **only** the watchers registered by this call.
 */
export function startWatcher(repos: Array<{ name: string; path: string }>): () => void {
  // C3 fix: disable in multi-tenant mode (watcher has no tenant DB context)
  if (process.env["CODEPRISM_MULTI_TENANT"] === "true") {
    console.warn("[watcher] Multi-tenant mode active — automatic file watching disabled. Watchers would write to the wrong tenant DB.");
    return () => {};
  }

  // H2 fix: track only the names added by this call, not the full singleton map
  const addedNames = new Set<string>();

  for (const repo of repos) {
    if (activeWatchers.has(repo.name)) continue;

    const state: RepoWatcher = {
      name: repo.name,
      path: repo.path,
      watchers: [],
      pending: new Map(),
      debounceTimer: null,
      origHeadTimer: null,
      lastBranch: readGitHeadSync(repo.path),
    };

    state.watchers.push(...watchGitFiles(state));
    state.watchers.push(...watchSourceFiles(state));
    activeWatchers.set(repo.name, state);
    addedNames.add(repo.name);

    console.log(
      `[watcher] Watching ${repo.name} at ${repo.path}` +
      (state.lastBranch ? ` (branch: ${state.lastBranch})` : ""),
    );
  }

  // H2 fix: closure only closes repos it registered
  return () => {
    for (const name of addedNames) {
      const repo = activeWatchers.get(name);
      if (!repo) continue;
      if (repo.debounceTimer) clearTimeout(repo.debounceTimer);
      if (repo.origHeadTimer) clearTimeout(repo.origHeadTimer);
      for (const w of repo.watchers) {
        try { w.close(); } catch { /* ok */ }
      }
      activeWatchers.delete(name);
    }
    addedNames.clear();
  };
}

/**
 * Starts watching a newly registered repo at runtime (no server restart required).
 * Called from the dashboard-api register endpoint.
 */
export function watchNewRepo(repo: { name: string; path: string }): void {
  startWatcher([repo]);
}

/**
 * H3 fix: Stops watching a specific repo and cleans up all its resources.
 * Called when a repo is unregistered via the dashboard.
 */
export function stopWatchingRepo(name: string): void {
  const repo = activeWatchers.get(name);
  if (!repo) return;
  if (repo.debounceTimer) clearTimeout(repo.debounceTimer);
  if (repo.origHeadTimer) clearTimeout(repo.origHeadTimer);
  for (const w of repo.watchers) {
    try { w.close(); } catch { /* ok */ }
  }
  activeWatchers.delete(name);
  console.log(`[watcher] Stopped watching ${name}`);
}

export { maybeAutoReindex };
