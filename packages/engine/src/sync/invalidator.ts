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

// ---------------------------------------------------------------------------
// Project doc invalidation — triggered on git pull / merge
// ---------------------------------------------------------------------------

/**
 * Which doc types are affected by changes to particular file patterns.
 * Order matters: first match wins for a given file.
 */
const DOC_INVALIDATION_RULES: Array<{ pattern: RegExp; docTypes: string[] }> = [
  { pattern: /schema\.rb$/i,           docTypes: ["architecture", "rules"] },
  { pattern: /config\/routes\.rb$/i,   docTypes: ["architecture"] },
  { pattern: /\/routes\//i,            docTypes: ["architecture"] },
  { pattern: /\/models\//i,            docTypes: ["about", "architecture", "rules"] },
  { pattern: /\/policies\//i,          docTypes: ["rules"] },
  { pattern: /\/concerns\//i,          docTypes: ["rules"] },
  { pattern: /package\.json$/i,        docTypes: ["readme"] },
  { pattern: /Gemfile(\.lock)?$/i,     docTypes: ["readme"] },
  { pattern: /\.(scss|css|less|sass)$/i, docTypes: ["styles"] },
  { pattern: /\.(js|ts|jsx|tsx|rb|py|go|java)$/i, docTypes: ["code_style"] },
];

/**
 * Marks project_docs as stale when changed files affect them.
 * Called alongside `invalidateCards()` on every git pull / merge event.
 *
 * @returns Number of docs newly marked as stale.
 */
export function invalidateProjectDocs(
  changedFiles: string[],
  repo: string,
  isMergeEvent = false,
): number {
  if (changedFiles.length === 0) return 0;

  const db = getDb();

  // Collect all doc types that need to be staled
  const staleDocTypes = new Set<string>();

  for (const file of changedFiles) {
    for (const rule of DOC_INVALIDATION_RULES) {
      if (rule.pattern.test(file)) {
        for (const dt of rule.docTypes) staleDocTypes.add(dt);
        break; // only apply first matching rule per file
      }
    }
  }

  // Specialist depends on about+architecture+rules — cascade staleness
  const SPECIALIST_TRIGGERS = new Set(["about", "architecture", "rules"]);
  if ([...staleDocTypes].some((t) => SPECIALIST_TRIGGERS.has(t))) {
    staleDocTypes.add("specialist");
  }
  // Changelog only goes stale on merge/pull events, not on individual file saves,
  // because a changelog summarises completed commits, not in-progress work.
  if (
    isMergeEvent &&
    changedFiles.some((f) => /\.(rb|ts|tsx|js|jsx|py|go|java|php|rs)$/i.test(f))
  ) {
    staleDocTypes.add("changelog");
  }

  if (staleDocTypes.size === 0) return 0;

  const placeholders = [...staleDocTypes].map(() => "?").join(", ");
  const result = db
    .prepare(
      `UPDATE project_docs SET stale = 1, updated_at = datetime('now')
       WHERE repo = ? AND doc_type IN (${placeholders}) AND stale = 0`,
    )
    .run(repo, ...[...staleDocTypes]);

  let totalChanges = result.changes;

  // Cascade: workspace specialist synthesizes all per-repo specialists,
  // so it must go stale whenever any per-repo specialist does.
  if (staleDocTypes.has("specialist")) {
    const wsResult = db.prepare(
      `UPDATE project_docs SET stale = 1, updated_at = datetime('now')
       WHERE repo = '__workspace__' AND doc_type = 'specialist' AND stale = 0`,
    ).run();
    totalChanges += wsResult.changes;
  }

  return totalChanges;
}

// ---------------------------------------------------------------------------
// Cross-repo staleness propagation
// ---------------------------------------------------------------------------

/**
 * When BE models/controllers change, FE cross_service cards that reference those
 * endpoints via graph_edges may become stale. This function finds those cards
 * in other repos and marks them stale.
 *
 * @returns Number of cross-repo cards newly marked as stale.
 */
export function propagateCrossRepoStaleness(changedFiles: string[], sourceRepo: string): number {
  if (changedFiles.length === 0) return 0;

  const db = getDb();

  // Find FE files that are targets of api_endpoint edges from the changed BE files
  const fileListJson = JSON.stringify(changedFiles);
  const affectedTargets = db
    .prepare(
      `SELECT DISTINCT target_file FROM graph_edges
       WHERE relation = 'api_endpoint'
       AND source_file IN (SELECT value FROM json_each(?))`,
    )
    .all(fileListJson) as { target_file: string }[];

  if (affectedTargets.length === 0) return 0;

  const markStale = db.prepare(
    `UPDATE cards SET stale = 1, updated_at = datetime('now')
     WHERE stale = 0
       AND card_type = 'cross_service'
       AND source_repos NOT LIKE ?
       AND EXISTS (
         SELECT 1 FROM json_each(source_files) sf WHERE sf.value = ?
       )`,
  );

  let totalStaled = 0;

  for (const { target_file } of affectedTargets) {
    const result = markStale.run(`%${sourceRepo}%`, target_file);
    totalStaled += result.changes;
  }

  return totalStaled;
}
