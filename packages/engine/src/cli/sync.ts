/**
 * srcmap sync — git-aware post-merge knowledge base updater.
 *
 * Called automatically by git hooks (post-merge, post-checkout, post-rewrite)
 * or manually. Detects what changed since the last git operation, classifies
 * the current branch, and tells the running srcmap server to invalidate
 * affected cards.
 *
 * Branch classification drives the level of invalidation:
 *
 *   demo/*  / *-demo / *_demo  → skip  — demo branches never touch the KB
 *   main / master / develop / staging / epic/*  → full  — cross-repo propagation
 *   feature/* / fix/* / hotfix/* / bugfix/*     → lightweight — per-card staleness only
 *   anything else                               → lightweight (safe default)
 *
 * If the srcmap server is not reachable the command exits 0 silently — git
 * workflows must never be blocked by srcmap.
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SyncLevel = "skip" | "lightweight" | "full";

export interface SyncOptions {
  /** Override the detected port. Defaults to SRCMAP_PORT env or 4000. */
  port?: number;
  /** Force a specific event type instead of the auto-detected one. */
  eventType?: "save" | "merge" | "pull" | "rebase" | "checkout";
  /** Previous HEAD sha (passed by post-checkout hook as $1) to detect parent branch. */
  prevHead?: string;
  /** Explicitly name the repo (defaults to git remote inference). */
  repo?: string;
  /** Print what would happen without sending to the server. */
  dryRun?: boolean;
}

// ---------------------------------------------------------------------------
// Branch context extraction
// ---------------------------------------------------------------------------

export interface BranchContext {
  branch: string;
  /** Jira/Linear ticket ID extracted from the branch name, e.g. "ENG-123". Null if absent. */
  ticketId: string | null;
  /**
   * Human-readable context hint derived from the branch name.
   * Used as the MCP query when no ticket ID is available.
   *
   * Examples:
   *   "feature/ENG-123-billing-filter" → "billing filter"  (ticket ID is separate)
   *   "add-some-weird-thing"           → "add some weird thing"
   *   "epic/orlando_demo"              → "orlando demo"
   */
  contextHint: string;
  /** Epic name inferred from the parent branch, e.g. "orlando demo". Null if not from an epic. */
  epicBranch: string | null;
  syncLevel: SyncLevel;
}

const BRANCH_PREFIXES = /^(feature|fix|bugfix|hotfix|chore|refactor|task|epic|release|demo)\//i;
const TICKET_PATTERN = /\b([A-Z]{2,10}-\d+)\b/gi;
const WORD_SEPARATORS = /[/_-]+/g;

/**
 * Extracts structured context from a branch name.
 *
 * When no ticket ID is present, the branch words themselves become the context
 * hint and drive MCP searches automatically.
 *
 * @param branch     Current branch name (e.g. "add-some-weird-thing")
 * @param prevHead   Previous HEAD sha OR branch name from git checkout $1
 */
export function extractBranchContext(branch: string, prevHead?: string): BranchContext {
  const level = classifyBranch(branch);

  // Extract ticket ID(s), normalised to uppercase
  const ticketMatches = [...branch.matchAll(TICKET_PATTERN)];
  const ticketId = ticketMatches.length > 0 ? ticketMatches[0]![1]!.toUpperCase() : null;

  // Build a clean human-readable hint:
  // 1. Strip common prefixes (feature/, fix/, …)
  // 2. Remove ticket IDs (they go in ticketId field)
  // 3. Replace separators with spaces
  const stripped = branch
    .replace(BRANCH_PREFIXES, "")
    .replace(TICKET_PATTERN, " ")
    .replace(WORD_SEPARATORS, " ")
    .replace(/\s+/g, " ")
    .trim();
  const contextHint = stripped || branch.replace(WORD_SEPARATORS, " ").trim();

  // Detect epic parent branch.
  // prevHead may be a sha (from post-checkout $1) or a branch name.
  let epicBranch: string | null = null;
  if (prevHead) {
    // If it looks like a branch name (not a 7–40 char hex sha), use it directly
    const isSha = /^[0-9a-f]{7,40}$/.test(prevHead);
    const parentBranchName = isSha ? null : prevHead;
    const candidate = parentBranchName ?? "";
    if (candidate.toLowerCase().startsWith("epic/")) {
      epicBranch = candidate
        .replace(/^epic\//i, "")
        .replace(WORD_SEPARATORS, " ")
        .trim();
    }
  }

  // If the branch itself is an epic, its own name is the epic context
  if (!epicBranch && branch.toLowerCase().startsWith("epic/")) {
    epicBranch = branch
      .replace(/^epic\//i, "")
      .replace(WORD_SEPARATORS, " ")
      .trim();
  }

  return { branch, ticketId, contextHint, epicBranch, syncLevel: level };
}

interface ChangedFile {
  path: string;
  status: "added" | "modified" | "deleted";
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function git(cmd: string, cwd: string): string {
  try {
    return execSync(`git ${cmd}`, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10_000,
    }).trim();
  } catch {
    return "";
  }
}

function getCurrentBranch(cwd: string): string {
  return git("rev-parse --abbrev-ref HEAD", cwd) || "unknown";
}

function getCommitSha(cwd: string): string {
  return git("rev-parse --short HEAD", cwd);
}

function getRepoName(cwd: string, override?: string): string {
  if (override) return override;
  const remote = git("remote get-url origin", cwd);
  if (remote) {
    const m = remote.match(/([^/]+?)(?:\.git)?$/);
    if (m) return m[1]!;
  }
  return cwd.split("/").pop() ?? "unknown";
}

/**
 * Returns files changed between ORIG_HEAD and HEAD (set by git after merge/pull/rebase).
 * Falls back to the last commit diff if ORIG_HEAD is absent.
 */
function getChangedFiles(cwd: string): ChangedFile[] {
  // ORIG_HEAD is set by git after merge, pull, rebase
  const origHead = git("rev-parse ORIG_HEAD", cwd);
  const diffBase = origHead || "HEAD~1";

  const raw = git(`diff --name-status ${diffBase} HEAD`, cwd);
  if (!raw) return [];

  return raw
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const parts = line.split("\t");
      const code = parts[0] ?? "";
      // Renames produce two paths: R<score>\told\tnew
      // We report both the old path as deleted and the new as added.
      if (code.startsWith("R") && parts.length === 3) {
        return [
          { path: parts[1]!, status: "deleted" as const },
          { path: parts[2]!, status: "added" as const },
        ];
      }
      const path = parts[1];
      if (!path) return [];
      const status: ChangedFile["status"] = code.startsWith("A")
        ? "added"
        : code.startsWith("D")
        ? "deleted"
        : "modified";
      return [{ path, status }];
    });
}

// ---------------------------------------------------------------------------
// Branch classification
// ---------------------------------------------------------------------------

/**
 * Classifies a branch name into the level of KB invalidation to perform.
 *
 * | Level       | What it does                                                  |
 * |-------------|---------------------------------------------------------------|
 * | skip        | No-op. Demo/experimental branches don't touch the KB.         |
 * | lightweight | Mark affected cards stale only. No cross-repo propagation.    |
 * | full        | Full invalidation + cross-repo propagation + doc cascade.     |
 */
export function classifyBranch(branch: string): SyncLevel {
  const name = branch.toLowerCase().trim();

  // Demo branches are sandboxes — never update shared KB
  if (
    name.startsWith("demo/") ||
    name.endsWith("-demo") ||
    name.endsWith("_demo") ||
    name.includes("/demo/") ||
    name === "demo"
  ) {
    return "skip";
  }

  // Release / main integration branches → full treatment
  const FULL_BRANCHES = new Set([
    "main", "master", "develop", "development",
    "staging", "stage", "production", "prod",
    "release",
  ]);
  if (FULL_BRANCHES.has(name)) return "full";

  // Release tags and release branches
  if (name.startsWith("release/") || name.startsWith("hotfix/")) return "full";

  // Epic branches span multiple repos — always full
  if (name.startsWith("epic/")) return "full";

  // Regular feature/fix work — lightweight only
  if (
    name.startsWith("feature/") ||
    name.startsWith("fix/") ||
    name.startsWith("bugfix/") ||
    name.startsWith("chore/") ||
    name.startsWith("refactor/")
  ) {
    return "lightweight";
  }

  // Unknown branches: conservative default — lightweight, never skip
  return "lightweight";
}

// ---------------------------------------------------------------------------
// Server communication
// ---------------------------------------------------------------------------

interface SyncPayload {
  repo: string;
  branch: string;
  commitSha?: string;
  eventType: "save" | "merge" | "pull" | "rebase";
  changedFiles: Array<{ path: string; content: string; status: "added" | "modified" | "deleted" }>;
  devId?: string;
}

export interface CheckoutContextPayload {
  branch: string;
  repo: string;
  ticketId: string | null;
  contextHint: string;
  epicBranch: string | null;
}

async function post<T>(port: number, path: string, body: unknown): Promise<T> {
  const res = await fetch(`http://localhost:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Core sync logic
// ---------------------------------------------------------------------------

export async function runSync(cwd: string, opts: SyncOptions = {}): Promise<void> {
  const branch = getCurrentBranch(cwd);
  const repoName = getRepoName(cwd, opts.repo);
  const port = opts.port ?? Number(process.env["SRCMAP_PORT"] ?? 4000);
  const isCheckout = opts.eventType === "checkout";

  // ── Branch context (always extracted, even for skipped branches) ───────────
  //
  // On a checkout event we always update the active context so MCP queries
  // are automatically scoped — even when the branch itself has no ticket ID.
  //
  // demo/orlando  → contextHint="orlando", epicBranch=null, ticketId=null
  // add-weird     → contextHint="add weird", epicBranch="orlando demo" (from parent epic)
  // feature/ENG-23-foo → ticketId="ENG-23", contextHint="foo"
  // Resolve prevHead sha → branch name so epic detection works correctly.
  // git name-rev --name-only <sha> returns e.g. "epic/orlando_demo" or "HEAD~1"
  let resolvedPrevHead = opts.prevHead;
  if (resolvedPrevHead && /^[0-9a-f]{7,40}$/.test(resolvedPrevHead)) {
    const named = git(`name-rev --name-only ${resolvedPrevHead}`, cwd);
    // Only use it if it looks like a branch name (not "HEAD~N" or "undefined")
    if (named && !named.startsWith("HEAD") && named !== "undefined") {
      resolvedPrevHead = named.replace(/~\d+$/, "").replace(/\^\d+$/, "");
    }
  }

  const ctx = extractBranchContext(branch, resolvedPrevHead);

  if (isCheckout) {
    const label = [
      ctx.ticketId ?? null,
      ctx.epicBranch ? `[epic: ${ctx.epicBranch}]` : null,
      `"${ctx.contextHint}"`,
    ].filter(Boolean).join(" ");

    if (ctx.syncLevel === "skip") {
      console.log(`[srcmap sync] Branch "${branch}" is demo/experimental → context not stored.`);
      return;
    }

    console.log(`[srcmap sync] Checkout ${repoName}@${branch} — context: ${label}`);

    if (opts.dryRun) {
      console.log("[srcmap sync] dry-run — context would be stored:", ctx);
      return;
    }

    try {
      await post(port, "/api/context/checkout", {
        branch, repo: repoName,
        ticketId: ctx.ticketId,
        contextHint: ctx.contextHint,
        epicBranch: ctx.epicBranch,
      } satisfies CheckoutContextPayload);
      console.log("[srcmap sync] Context stored — MCP queries are now scoped automatically.");
    } catch {
      console.log("[srcmap sync] Server not reachable — context will be inferred on next query.");
    }
    return;
  }

  // ── Merge / pull / rebase / save events ───────────────────────────────────

  const level = ctx.syncLevel;

  if (level === "skip") {
    console.log(`[srcmap sync] Branch "${branch}" is a demo/experimental branch — skipping KB update.`);
    return;
  }

  const changedFiles = getChangedFiles(cwd);
  if (changedFiles.length === 0) {
    console.log(`[srcmap sync] No changed files detected for ${repoName}@${branch}.`);
    return;
  }

  const eventType: SyncPayload["eventType"] =
    (opts.eventType !== "checkout" ? opts.eventType : undefined) ??
    (level === "full" ? "merge" : "save");

  const commitSha = getCommitSha(cwd);

  const filesWithContent: SyncPayload["changedFiles"] = changedFiles.map((f) => {
    let content = "";
    if (f.status !== "deleted") {
      const absPath = existsSync(resolve(cwd, f.path))
        ? resolve(cwd, f.path)
        : join(cwd, f.path);
      try {
        content = readFileSync(absPath, "utf-8");
      } catch {
        content = "";
      }
    }
    return { path: f.path, content, status: f.status };
  });

  console.log(
    `[srcmap sync] ${repoName}@${branch} (${level}) — ${changedFiles.length} file(s) changed, eventType=${eventType}`,
  );

  if (opts.dryRun) {
    console.log("[srcmap sync] dry-run — not sending to server.");
    for (const f of changedFiles) console.log(`  ${f.status.padEnd(8)} ${f.path}`);
    return;
  }

  try {
    const result = await post<{ indexed: number; invalidated: number }>(port, "/api/sync", {
      repo: repoName, branch, commitSha, eventType, changedFiles: filesWithContent,
    });
    console.log(
      `[srcmap sync] Done — ${result.indexed} file(s) indexed, ${result.invalidated} card(s) marked stale.`,
    );
  } catch {
    console.log("[srcmap sync] Server not reachable — cards will be refreshed on next manual index.");
  }
}
