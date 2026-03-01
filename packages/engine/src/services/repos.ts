import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { getDb } from "../db/connection.js";
import { getAllRepoSignalRecords } from "../search/repo-signals.js";
import { safeParseJsonArray } from "./utils.js";

/* ------------------------------------------------------------------ */
/*  Git hook installation                                               */
/* ------------------------------------------------------------------ */

const HOOK_MARKER = "# codeprism-managed";

/**
 * Generates the hook script body. Uses the env-provided port with fallback to 4000.
 * The hook fires on merge into main/master — it calls the codeprism reindex API
 * in the background (fire-and-forget) so it never blocks git operations.
 */
function hookScript(): string {
  const port = process.env["CODEPRISM_PORT"] ?? "4000";
  return `#!/bin/sh
${HOOK_MARKER}
# Automatically triggers codeprism re-index when a branch is merged into main/master.
# Installed by codeprism — safe to delete if you prefer to manage re-indexing manually.
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
  curl -s -X POST "http://localhost:${port}/api/reindex-stale" \\
    -H "Content-Type: application/json" \\
    --max-time 5 >/dev/null 2>&1 &
fi
`;
}

/**
 * Installs (or updates) the codeprism post-merge git hook in a repo.
 * - If no hook exists: creates it.
 * - If a codeprism-managed hook exists: overwrites (idempotent / port update).
 * - If a custom (non-codeprism) hook exists: appends a call to a sidecar script
 *   so the user's existing hook is preserved.
 */
export function installGitHook(repoPath: string): void {
  const hooksDir = join(repoPath, ".git", "hooks");
  if (!existsSync(hooksDir)) return; // not a git repo

  mkdirSync(hooksDir, { recursive: true });

  const hookPath = join(hooksDir, "post-merge");
  const script = hookScript();

  if (!existsSync(hookPath)) {
    writeFileSync(hookPath, script, "utf-8");
    chmodSync(hookPath, 0o755);
    return;
  }

  const existing = readFileSync(hookPath, "utf-8");
  if (existing.includes(HOOK_MARKER)) {
    // Overwrite our own managed hook (e.g. port changed)
    writeFileSync(hookPath, script, "utf-8");
    chmodSync(hookPath, 0o755);
    return;
  }

  // Custom hook present — append a sourced sidecar rather than overwriting
  const sidecarPath = join(hooksDir, "post-merge.codeprism");
  writeFileSync(sidecarPath, script, "utf-8");
  chmodSync(sidecarPath, 0o755);
  if (!existing.includes("post-merge.codeprism")) {
    const appended = existing.trimEnd() + "\n\n# codeprism hook\n\"$(dirname \"$0\")/post-merge.codeprism\"\n";
    writeFileSync(hookPath, appended, "utf-8");
  }
}

/**
 * Removes the codeprism-managed hook (or sidecar) from a repo on unregister.
 */
export function removeGitHook(repoPath: string): void {
  const hooksDir = join(repoPath, ".git", "hooks");
  const hookPath = join(hooksDir, "post-merge");
  const sidecarPath = join(hooksDir, "post-merge.codeprism");

  try { if (existsSync(sidecarPath)) unlinkSync(sidecarPath); } catch { /* ignore */ }

  if (existsSync(hookPath)) {
    try {
      const content = readFileSync(hookPath, "utf-8");
      if (content.includes(HOOK_MARKER)) unlinkSync(hookPath);
    } catch { /* ignore */ }
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

export function listRepos(): RepoSummary[] {
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

  return rows.map((r) => {
    const cs = cardStatsByRepo.get(r.repo);
    return {
      repo: r.repo,
      primaryLanguage: r.primaryLanguage,
      frameworks: safeParseJsonArray(r.frameworks),
      skillIds: safeParseJsonArray(r.skillIds),
      cardCount: cs?.cardCount ?? 0,
      staleCards: cs?.staleCards ?? 0,
      indexedFiles: r.indexedFiles,
      lastIndexedAt: r.lastIndexedAt,
    };
  });
}

export function getRepoOverview(repo: string): {
  about: unknown;
  pages: unknown;
  be_overview: unknown;
} {
  const db = getDb();
  const fetchDoc = (docType: string) =>
    db
      .prepare("SELECT id, repo, doc_type, title, content, updated_at FROM project_docs WHERE repo = ? AND doc_type = ?")
      .get(repo, docType) ?? null;

  return {
    about: fetchDoc("about"),
    pages: fetchDoc("pages"),
    be_overview: fetchDoc("be_overview"),
  };
}

export function getRepoBranches(repo: string): unknown[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT branch, event_type, from_branch, MAX(timestamp) AS lastSeen, COUNT(*) AS eventCount
       FROM branch_events WHERE repo = ?
       GROUP BY branch, event_type ORDER BY lastSeen DESC`,
    )
    .all(repo);
}

export function getRepoSignals(): unknown[] {
  return getAllRepoSignalRecords();
}

export function getRegisteredRepos(): Array<{ name: string; path: string }> {
  const db = getDb();
  const row = db.prepare("SELECT value FROM search_config WHERE key = 'extra_repos'").get() as { value: string } | undefined;
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function registerRepo(name: string, path: string): { name: string; path: string } {
  const sanitized = name.trim().replace(/[^a-zA-Z0-9_-]/g, "-");
  const repoPath = resolve(path.trim());

  if (!existsSync(repoPath)) {
    throw new Error(`Path does not exist: ${repoPath}`);
  }

  const db = getDb();
  const repos = getRegisteredRepos();

  if (repos.find((r) => r.name === sanitized)) {
    throw new Error(`Repository "${sanitized}" is already registered`);
  }

  repos.push({ name: sanitized, path: repoPath });
  db.prepare("INSERT OR REPLACE INTO search_config (key, value) VALUES ('extra_repos', ?)")
    .run(JSON.stringify(repos));

  return { name: sanitized, path: repoPath };
}

export function unregisterRepo(name: string): void {
  const db = getDb();
  const repos = getRegisteredRepos();
  const filtered = repos.filter((r) => r.name !== name);
  db.prepare("INSERT OR REPLACE INTO search_config (key, value) VALUES ('extra_repos', ?)")
    .run(JSON.stringify(filtered));
}

// ---------------------------------------------------------------------------
// Workspace status (used by MCP codeprism_workspace_status)
// ---------------------------------------------------------------------------

export interface WorkspaceRepoStatus {
  repo: string;
  totalCards: number;
  staleCards: number;
  lastCommit: string | null;
  stack: string;
  skillIds: string[];
  staleDocTypes: string[];
}

export interface WorkspaceStatus {
  repos: WorkspaceRepoStatus[];
  crossRepoEdges: Array<{ sourceRepo: string; edgeCount: number }>;
  totalStale: number;
}

export function getWorkspaceStatus(): WorkspaceStatus {
  const db = getDb();

  const repoStats = db
    .prepare(
      `SELECT
        json_each.value as repo,
        COUNT(c.id) as total_cards,
        SUM(c.stale) as stale_cards,
        MAX(c.source_commit) as last_commit
      FROM cards c, json_each(c.source_repos)
      WHERE json_each.value != ''
      GROUP BY json_each.value
      ORDER BY total_cards DESC`,
    )
    .all() as Array<{ repo: string; total_cards: number; stale_cards: number; last_commit: string | null }>;

  const profiles = db
    .prepare("SELECT repo, primary_language, frameworks, skill_ids FROM repo_profiles")
    .all() as Array<{ repo: string; primary_language: string; frameworks: string; skill_ids: string }>;
  const profileMap = new Map(profiles.map((p) => [p.repo, p]));

  const crossRepoEdges = db
    .prepare(
      `SELECT ge.repo as source_repo, COUNT(*) as edge_count
      FROM graph_edges ge WHERE ge.relation = 'api_endpoint'
      GROUP BY ge.repo ORDER BY edge_count DESC LIMIT 10`,
    )
    .all() as Array<{ source_repo: string; edge_count: number }>;

  const staleDocs = db
    .prepare("SELECT repo, doc_type FROM project_docs WHERE stale = 1 AND repo != '__memory__'")
    .all() as Array<{ repo: string; doc_type: string }>;

  const repos = repoStats.map((stat) => {
    const profile = profileMap.get(stat.repo);
    return {
      repo: stat.repo,
      totalCards: stat.total_cards,
      staleCards: stat.stale_cards ?? 0,
      lastCommit: stat.last_commit,
      stack: profile?.primary_language ?? "unknown",
      skillIds: safeParseJsonArray(profile?.skill_ids),
      staleDocTypes: staleDocs.filter((d) => d.repo === stat.repo).map((d) => d.doc_type),
    };
  });

  return {
    repos,
    crossRepoEdges: crossRepoEdges.map((e) => ({ sourceRepo: e.source_repo, edgeCount: e.edge_count })),
    totalStale: repoStats.reduce((sum, r) => sum + (r.stale_cards ?? 0), 0),
  };
}
