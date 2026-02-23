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
 *
 * Safe: async git queries (never blocks event loop), all DB writes in a single transaction.
 * Never deletes cards that are valid on multiple branches.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { getDb } from "../db/connection.js";

const execAsync = promisify(exec);

export interface GCResult {
  repo: string;
  orphanedFileIndexRows: number;
  prunedBranchScopedCards: number;
  deletedBranchOnlyCards: number;
}

/**
 * Returns the set of branches that currently exist in a local git repo.
 * Includes local branches and remote-tracking branches (stripped of "origin/" prefix).
 * `main` and `master` are always included as a safe fallback if git is unreachable.
 *
 * NOTE: remote branch data reflects the last `git fetch`. Branches deleted on the
 * remote but not yet pruned locally will still appear as "live" — GC is therefore
 * conservative in that direction (safe, but orphaned data may linger until next fetch).
 */
async function liveBranches(repoPath: string): Promise<Set<string>> {
  const always = new Set(["main", "master"]);
  try {
    const [localResult, remoteResult] = await Promise.all([
      execAsync("git branch --format=%(refname:short)", {
        cwd: repoPath, timeout: 8_000,
      }),
      execAsync("git branch -r --format=%(refname:short)", {
        cwd: repoPath, timeout: 8_000,
      }),
    ]);

    const branches = new Set<string>(["main", "master"]);
    const allLines = [
      ...localResult.stdout.trim().split("\n"),
      ...remoteResult.stdout.trim().split("\n"),
    ];
    for (const line of allLines) {
      const b = line.trim().replace(/^origin\//, "");
      if (b) branches.add(b);
    }
    return branches;
  } catch {
    return always;
  }
}

/** Prevent concurrent GC runs for the same repo. */
const gcInProgress = new Set<string>();

/**
 * Runs branch GC for a single repository.
 * Returns early if GC is already running for this repo.
 */
export async function runBranchGC(repoName: string, repoPath: string): Promise<GCResult> {
  const result: GCResult = {
    repo: repoName,
    orphanedFileIndexRows: 0,
    prunedBranchScopedCards: 0,
    deletedBranchOnlyCards: 0,
  };

  if (gcInProgress.has(repoName)) return result;
  if (!existsSync(repoPath)) return result;

  gcInProgress.add(repoName);
  try {
    const live = await liveBranches(repoPath);
    const db = getDb();

    // ── Combined transaction: file_index cleanup + card pruning ─────────────
    // A single transaction ensures the two operations are always consistent.
    // Readers see either both changes or neither.

    // Gather file_index branches to delete (read outside tx for clarity)
    const fiRows = db
      .prepare("SELECT DISTINCT branch FROM file_index WHERE repo = ?")
      .all(repoName) as { branch: string }[];

    const deletedBranches = fiRows.map((r) => r.branch).filter((b) => b && !live.has(b));

    // H1 fix: use json_each for exact match instead of LIKE wildcard
    const scopedCards = db
      .prepare(
        `SELECT id, valid_branches FROM cards
         WHERE valid_branches IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM json_each(source_repos) WHERE value = ?
           )`,
      )
      .all(repoName) as { id: string; valid_branches: string }[];

    const delFileIndex = db.prepare("DELETE FROM file_index WHERE repo = ? AND branch = ?");
    const updateBranches = db.prepare(
      "UPDATE cards SET valid_branches = ?, stale = 1, updated_at = datetime('now') WHERE id = ?",
    );
    const deleteCard = db.prepare("DELETE FROM cards WHERE id = ?");

    // M4 fix: single combined transaction
    const tx = db.transaction(() => {
      for (const branch of deletedBranches) {
        const r = delFileIndex.run(repoName, branch);
        result.orphanedFileIndexRows += r.changes;
      }

      for (const card of scopedCards) {
        let branches: string[];
        try { branches = JSON.parse(card.valid_branches); }
        catch { continue; }

        const surviving = branches.filter((b) => live.has(b));
        if (surviving.length === branches.length) continue;

        if (surviving.length === 0) {
          deleteCard.run(card.id);
          result.deletedBranchOnlyCards++;
        } else {
          updateBranches.run(JSON.stringify(surviving), card.id);
          result.prunedBranchScopedCards++;
        }
      }
    });

    tx();
  } finally {
    gcInProgress.delete(repoName);
  }

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
 * Runs branch GC for all repos. Used on server startup and after merge events.
 */
export async function runAllBranchGC(repoMap: Map<string, string>): Promise<GCResult[]> {
  const results: GCResult[] = [];
  for (const [name, path] of repoMap) {
    try {
      results.push(await runBranchGC(name, path));
    } catch (err) {
      console.error(`[branch-gc] Error for ${name}:`, err instanceof Error ? err.message : err);
    }
  }
  return results;
}
