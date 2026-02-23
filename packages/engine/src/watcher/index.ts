/**
 * srcmap automatic watcher — zero-CLI knowledge base maintenance.
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
 *                           → git pull / merge / rebase detected
 *                             → handleSync(merge) + auto-reindex
 *
 * No CLI commands required. The developer just writes code and the KB stays fresh.
 *
 * NOTE: fs.watch recursive option works on macOS and Windows natively.
 * On Linux it requires the kernel inotify interface — works in most distros.
 * If fs.watch throws, each top-level directory is watched individually as fallback.
 */

import { watch, readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, extname, join, relative } from "node:path";
import type { FSWatcher } from "node:fs";
import { handleSync } from "../sync/receiver.js";
import { storeCheckoutContext } from "../services/context.js";
import { extractBranchContext } from "../cli/sync.js";
import { runIncrementalReindex, reindexState, getStaleCardCount } from "../services/reindex.js";
import { getDb } from "../db/connection.js";
import { runBranchGC } from "../sync/branch-gc.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Source file extensions that trigger re-sync when changed. */
const WATCH_EXTENSIONS = new Set([
  ".rb", ".erb", ".rake", ".ru",
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte",
  ".py", ".go", ".java", ".kt", ".php", ".rs",
  ".graphql", ".gql",
  ".sql", ".json", ".yaml", ".yml", ".toml",
]);

/** Filenames without extension that trigger re-sync. */
const WATCH_FILENAMES = new Set([
  "Gemfile", "Gemfile.lock", "schema.rb", "routes.rb",
  "package.json", "go.mod", "Cargo.toml", "pyproject.toml",
]);

/** Path segments that exclude a file from watching. */
const IGNORE_SEGMENTS = new Set([
  "node_modules", ".git", "dist", "build", "tmp", "log",
  ".next", ".nuxt", ".turbo", "coverage", "__pycache__",
  "vendor", ".cache", ".parcel-cache",
]);

/**
 * Number of stale cards that triggers an automatic background reindex.
 * Configurable via search_config key `auto_reindex_threshold`.
 */
const DEFAULT_THRESHOLD = 5;

/** Debounce window: collect file changes for this many ms before processing. */
const DEBOUNCE_MS = 1_200;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shouldWatchFile(filepath: string): boolean {
  const parts = filepath.split(/[/\\]/);
  if (parts.some((p) => IGNORE_SEGMENTS.has(p))) return false;
  const base = parts[parts.length - 1] ?? "";
  return WATCH_EXTENSIONS.has(extname(base)) || WATCH_FILENAMES.has(base);
}

function readGitHead(repoPath: string): string {
  try {
    const raw = readFileSync(join(repoPath, ".git", "HEAD"), "utf-8").trim();
    if (raw.startsWith("ref: refs/heads/")) return raw.slice("ref: refs/heads/".length);
    return raw.slice(0, 8); // detached HEAD
  } catch {
    return "";
  }
}

function getThreshold(): number {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM search_config WHERE key = 'auto_reindex_threshold'").get() as { value: string } | undefined;
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
  /** Pending changed files, keyed by absolute path. Cleared after debounce fires. */
  pending: Map<string, "added" | "modified" | "deleted">;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  /** Last known branch name — used to detect switches. */
  lastBranch: string;
}

// ---------------------------------------------------------------------------
// Debounced file-change handler
// ---------------------------------------------------------------------------

async function flushPending(repo: RepoWatcher): Promise<void> {
  if (repo.pending.size === 0) return;

  const changedFiles = [...repo.pending.entries()];
  repo.pending.clear();

  const branch = readGitHead(repo.path) || "unknown";

  // Read file contents for added/modified files
  const payload: Parameters<typeof handleSync>[0] = {
    repo: repo.name,
    branch,
    eventType: "save",
    changedFiles: changedFiles.map(([absPath, status]) => {
      let content = "";
      if (status !== "deleted") {
        try { content = readFileSync(absPath, "utf-8"); } catch { content = ""; }
      }
      return {
        path: relative(repo.path, absPath),
        content,
        status,
      };
    }),
  };

  try {
    const result = await handleSync(payload);
    if (result.invalidated > 0) {
      console.log(`[watcher] ${repo.name}@${branch} — ${result.invalidated} card(s) marked stale (${changedFiles.length} file(s) changed)`);
      maybeAutoReindex(repo.name);
    }
  } catch (err) {
    // Never let watcher errors surface — it's a background process
    console.error(`[watcher] sync error for ${repo.name}:`, err instanceof Error ? err.message : err);
  }
}

function scheduleFlush(repo: RepoWatcher): void {
  if (repo.debounceTimer) clearTimeout(repo.debounceTimer);
  repo.debounceTimer = setTimeout(() => {
    repo.debounceTimer = null;
    void flushPending(repo);
  }, DEBOUNCE_MS);
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
// Git event detection
// ---------------------------------------------------------------------------

function handleHeadChange(repo: RepoWatcher): void {
  const newBranch = readGitHead(repo.path);
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

  try {
    storeCheckoutContext({
      branch: newBranch,
      repo: repo.name,
      ticketId: ctx.ticketId,
      contextHint: ctx.contextHint,
      epicBranch: ctx.epicBranch,
    });
  } catch { /* non-blocking */ }
}

async function handleOrigHead(repo: RepoWatcher): Promise<void> {
  const origHeadPath = join(repo.path, ".git", "ORIG_HEAD");
  if (!existsSync(origHeadPath)) return;

  const branch = readGitHead(repo.path) || "unknown";
  const ctx = extractBranchContext(branch);
  if (ctx.syncLevel === "skip") return;

  const eventType = ctx.syncLevel === "full" ? "merge" : "pull";
  console.log(`[watcher] ${repo.name}@${branch} — git ${eventType} detected (ORIG_HEAD changed)`);

  try {
    // Get files changed by the merge/pull using git diff
    const raw = execSync("git diff --name-status ORIG_HEAD HEAD", {
      cwd: repo.path, encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"], timeout: 10_000,
    }).trim();

    if (!raw) return;

    const changedFiles = raw.split("\n").filter(Boolean).flatMap((line) => {
      const [code, ...pathParts] = line.split("\t");
      if (code?.startsWith("R") && pathParts.length === 2) {
        return [
          { path: pathParts[0]!, content: "", status: "deleted" as const },
          { path: pathParts[1]!, content: "", status: "added" as const },
        ];
      }
      const path = pathParts[0];
      if (!path) return [];
      const status = code?.startsWith("A") ? "added" as const : code?.startsWith("D") ? "deleted" as const : "modified" as const;
      // Read content for non-deleted files
      let content = "";
      if (status !== "deleted") {
        try { content = readFileSync(join(repo.path, path), "utf-8"); } catch { content = ""; }
      }
      return [{ path, content, status }];
    });

    if (changedFiles.length === 0) return;

    const result = await handleSync({ repo: repo.name, branch, eventType, changedFiles });
    console.log(`[watcher] ${repo.name}@${branch} merge sync: ${result.indexed} indexed, ${result.invalidated} stale`);
    if (result.invalidated > 0) maybeAutoReindex(repo.name);

    // After a merge/pull the source branch is often deleted — run GC to clean up orphaned data
    setImmediate(() => runBranchGC(repo.name, repo.path));
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
    } catch { /* git dir not watchable */ }
  }

  // Watch ORIG_HEAD for merge/pull/rebase events
  // ORIG_HEAD may not exist yet — watch the parent dir and react when it appears
  if (existsSync(gitDir)) {
    try {
      const w = watch(gitDir, (_event, filename) => {
        if (filename === "ORIG_HEAD") void handleOrigHead(repo);
      });
      watchers.push(w);
    } catch { /* ok */ }
  }

  return watchers;
}

function watchSourceFiles(repo: RepoWatcher): FSWatcher[] {
  const watchers: FSWatcher[] = [];

  const onFileEvent = (_event: string, filename: string | null) => {
    if (!filename) return;
    const absPath = resolve(repo.path, filename);
    if (!shouldWatchFile(absPath)) return;

    // Determine status: if file no longer exists → deleted
    const status = existsSync(absPath) ? "modified" : "deleted";
    repo.pending.set(absPath, status);
    scheduleFlush(repo);
  };

  try {
    // recursive: true works on macOS and Windows natively
    const w = watch(repo.path, { recursive: true }, onFileEvent);
    w.on("error", () => { /* silently ignore watch errors */ });
    watchers.push(w);
  } catch {
    // Fallback: watch known top-level subdirectories individually
    const TOP_DIRS = ["app", "src", "lib", "config", "db", "spec", "test", "packages"];
    for (const dir of TOP_DIRS) {
      const dirPath = join(repo.path, dir);
      if (!existsSync(dirPath)) continue;
      try {
        const w = watch(dirPath, { recursive: true }, onFileEvent);
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
 * @returns Cleanup function that stops all watchers.
 */
export function startWatcher(repos: Array<{ name: string; path: string }>): () => void {
  for (const repo of repos) {
    if (activeWatchers.has(repo.name)) continue;

    const state: RepoWatcher = {
      name: repo.name,
      path: repo.path,
      watchers: [],
      pending: new Map(),
      debounceTimer: null,
      lastBranch: readGitHead(repo.path),
    };

    state.watchers.push(...watchGitFiles(state));
    state.watchers.push(...watchSourceFiles(state));
    activeWatchers.set(repo.name, state);

    console.log(
      `[watcher] Watching ${repo.name} at ${repo.path}` +
      (state.lastBranch ? ` (branch: ${state.lastBranch})` : ""),
    );
  }

  return () => {
    for (const [name, repo] of activeWatchers) {
      if (repo.debounceTimer) clearTimeout(repo.debounceTimer);
      for (const w of repo.watchers) {
        try { w.close(); } catch { /* ok */ }
      }
      activeWatchers.delete(name);
    }
  };
}

/**
 * Adds a newly registered repo to the watcher at runtime.
 * Called when the user registers a new repo via the dashboard.
 */
export function watchNewRepo(repo: { name: string; path: string }): void {
  startWatcher([repo]);
}

export { maybeAutoReindex };
