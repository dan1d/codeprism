import { getDb } from "../db/connection.js";

/**
 * Marks cards as stale when any of their source files appear in the
 * set of changed paths. Only non-stale cards whose `source_repos`
 * contain the given repo are considered.
 *
 * @returns Number of cards newly marked as stale.
 */
export function invalidateCards(changedFiles: string[], repo: string): number {
  if (changedFiles.length === 0) return 0;

  const db = getDb();

  const cards = db
    .prepare(
      `SELECT id, source_files FROM cards WHERE stale = 0 AND source_repos LIKE ?`,
    )
    .all(`%${repo}%`) as { id: string; source_files: string }[];

  const changedSet = new Set(changedFiles);
  const markStale = db.prepare(
    `UPDATE cards SET stale = 1, updated_at = datetime('now') WHERE id = ?`,
  );

  let invalidated = 0;

  for (const card of cards) {
    let sourceFiles: string[];
    try {
      sourceFiles = JSON.parse(card.source_files) as string[];
    } catch {
      continue;
    }

    if (sourceFiles.some((f) => changedSet.has(f))) {
      markStale.run(card.id);
      invalidated++;
    }
  }

  return invalidated;
}
