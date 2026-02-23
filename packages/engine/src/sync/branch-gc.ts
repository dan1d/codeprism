/**
 * Branch garbage collection.
 *
 * After a branch is deleted (merged PR, abandoned demo, closed feature),
 * its `file_index` rows and any branch-scoped cards become orphaned.
 * This module cleans them up.
 *
 * Run:
 *   - On server startup (for any branches deleted while the server was off)
 *   - After every merge/pull event (when the merged branch is typically deleted)
 *   - Optionally on a daily schedule via the watcher
 *
 * Safe: read-only git queries, all DB writes are inside transactions.
 * Never deletes cards that are valid on multiple branches — only removes
 * the deleted-branch entry from `valid_branches`.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { getDb } from "../db/connection.js";

interface GCResult {
  repo: string;
  orphanedFileIndexRows: number;
  prunedBranchScopedCards: number;
  deletedBranchOnlyCards: number;
}

/**
 * Returns the set of branches that currently exist in a local git repo.
 * Includes both local branches and remote-tracking branches (origin/*).
 * `main` and `master` are always included even if git is unreachable.
 */
function liveBranches(repoPath: string): Set<string> {
  const always = new Set(["main", "master"]);
  try {
    const local = execSync("git branch --format=%(refname:short)", {
      cwd: repoPath, encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"], timeout: 8_000,
    }).trim();

    const remote = execSync("git branch -r --format=%(refname:short)", {
      cwd: repoPath, encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"], timeout: 8_000,
    }).trim();

    const branches = new Set<string>(["main", "master"]);
    for (const line of [...local.split("\n"), ...remote.split("\n")]) {
      const b = line.trim().replace(/^origin\//, "");
      if (b) branches.add(b);
    }
    return branches;
  } catch {
    return always;
  }
}

/**
 * Runs branch GC for a single repository.
 */
export function runBranchGC(repoName: string, repoPath: string): GCResult {
  const result: GCResult = {
    repo: repoName,
    orphanedFileIndexRows: 0,
    prunedBranchScopedCards: 0,
    deletedBranchOnlyCards: 0,
  };

  if (!existsSync(repoPath)) return result;

  const live = liveBranches(repoPath);
  const db = getDb();

  // ── 1. Orphaned file_index rows ──────────────────────────────────────────
  // file_index is keyed by (path, repo, branch). Rows for deleted branches
  // are stale metadata that bloat the DB and confuse cross-branch queries.
  const fiRows = db
    .prepare("SELECT DISTINCT branch FROM file_index WHERE repo = ?")
    .all(repoName) as { branch: string }[];

  const deletedBranches = fiRows.map((r) => r.branch).filter((b) => b && !live.has(b));

  if (deletedBranches.length > 0) {
    const del = db.prepare("DELETE FROM file_index WHERE repo = ? AND branch = ?");
    const tx = db.transaction(() => {
      for (const branch of deletedBranches) {
        const r = del.run(repoName, branch);
        result.orphanedFileIndexRows += r.changes;
      }
    });
    tx();
  }

  // ── 2. Branch-scoped cards ───────────────────────────────────────────────
  // Cards with a non-null `valid_branches` JSON array are only meaningful on
  // those specific branches. When all branches in the list are deleted:
  //   - Remove the deleted branches from the array.
  //   - If the array becomes empty → delete the card entirely.
  //   - If branches remain → update valid_branches and mark stale.
  const scopedCards = db
    .prepare(
      "SELECT id, valid_branches FROM cards WHERE valid_branches IS NOT NULL AND source_repos LIKE ?",
    )
    .all(`%${repoName}%`) as { id: string; valid_branches: string }[];

  const updateBranches = db.prepare(
    "UPDATE cards SET valid_branches = ?, stale = 1, updated_at = datetime('now') WHERE id = ?",
  );
  const deleteCard = db.prepare("DELETE FROM cards WHERE id = ?");

  const tx2 = db.transaction(() => {
    for (const card of scopedCards) {
      let branches: string[];
      try { branches = JSON.parse(card.valid_branches); }
      catch { continue; }

      const surviving = branches.filter((b) => live.has(b));

      if (surviving.length === branches.length) continue; // nothing to do

      if (surviving.length === 0) {
        deleteCard.run(card.id);
        result.deletedBranchOnlyCards++;
      } else {
        updateBranches.run(JSON.stringify(surviving), card.id);
        result.prunedBranchScopedCards++;
      }
    }
  });
  tx2();

  if (
    result.orphanedFileIndexRows > 0 ||
    result.prunedBranchScopedCards > 0 ||
    result.deletedBranchOnlyCards > 0
  ) {
    console.log(
      `[branch-gc] ${repoName}: removed ${result.orphanedFileIndexRows} orphaned file_index rows, ` +
      `pruned ${result.prunedBranchScopedCards} branch-scoped cards, ` +
      `deleted ${result.deletedBranchOnlyCards} single-branch cards`,
    );
  }

  return result;
}

/**
 * Runs branch GC for all repos that have file_index data.
 * Used on server startup and after pull/merge events.
 *
 * @param repoMap - map of repo name → absolute path on disk
 */
export function runAllBranchGC(
  repoMap: Map<string, string>,
): GCResult[] {
  const results: GCResult[] = [];
  for (const [name, path] of repoMap) {
    try {
      results.push(runBranchGC(name, path));
    } catch (err) {
      console.error(`[branch-gc] Error for ${name}:`, err instanceof Error ? err.message : err);
    }
  }
  return results;
}
