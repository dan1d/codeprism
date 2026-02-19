import { getDb } from "../db/connection.js";

export interface BranchRole {
  branch: string;
  role: "main" | "staging" | "development" | "demo" | "feature" | "unknown";
  confidence: number;
  mergesPerWeek: number;
}

/**
 * Persists a branch lifecycle event (push, merge, create, delete, etc.)
 * into the `branch_events` table for later role analysis.
 */
export function recordBranchEvent(event: {
  repo: string;
  branch: string;
  eventType: string;
  fromBranch?: string;
  commitSha?: string;
  devId?: string;
}): void {
  const db = getDb();

  db.prepare(
    `INSERT INTO branch_events (repo, branch, event_type, from_branch, commit_sha, dev_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    event.repo,
    event.branch,
    event.eventType,
    event.fromBranch ?? null,
    event.commitSha ?? null,
    event.devId ?? null,
  );
}

const DAYS_30_IN_WEEKS = 30 / 7;

/**
 * Classifies a branch name into a well-known role using naming conventions.
 */
function classifyByName(
  branch: string,
): BranchRole["role"] {
  const name = branch.toLowerCase();

  if (name === "main" || name === "master") return "main";
  if (name === "staging" || name === "stage") return "staging";
  if (name === "develop" || name === "development") return "development";
  if (name.startsWith("demo/")) return "demo";
  if (name.startsWith("feature/") || name.startsWith("fix/")) return "feature";

  return "unknown";
}

/**
 * Analyses the last 30 days of branch events for a repo and assigns a
 * role to each observed branch.
 *
 * Heuristics (in priority order):
 * 1. Well-known name patterns (main, staging, develop, demo/*, feature/*)
 * 2. Fallback: the unnamed branch with the highest merge count that has
 *    existed for more than 7 days is considered `main` with lower confidence.
 */
export function detectBranchRoles(repo: string): BranchRole[] {
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT branch, event_type, timestamp
       FROM branch_events
       WHERE repo = ? AND timestamp >= datetime('now', '-30 days')
       ORDER BY branch`,
    )
    .all(repo) as { branch: string; event_type: string; timestamp: string }[];

  const stats = new Map<
    string,
    { mergeCount: number; earliestEvent: string }
  >();

  for (const row of rows) {
    let entry = stats.get(row.branch);
    if (!entry) {
      entry = { mergeCount: 0, earliestEvent: row.timestamp };
      stats.set(row.branch, entry);
    }
    if (row.event_type === "merge") {
      entry.mergeCount++;
    }
    if (row.timestamp < entry.earliestEvent) {
      entry.earliestEvent = row.timestamp;
    }
  }

  const roles: BranchRole[] = [];

  let bestUnclassifiedMerges = 0;
  let bestUnclassifiedBranch: string | null = null;

  for (const [branch, entry] of stats) {
    const mergesPerWeek =
      Math.round((entry.mergeCount / DAYS_30_IN_WEEKS) * 100) / 100;
    const role = classifyByName(branch);

    if (role !== "unknown") {
      roles.push({
        branch,
        role,
        confidence: role === "main" ? 0.95 : role === "feature" ? 0.7 : 0.85,
        mergesPerWeek,
      });
    } else {
      if (entry.mergeCount > bestUnclassifiedMerges) {
        bestUnclassifiedMerges = entry.mergeCount;
        bestUnclassifiedBranch = branch;
      }
    }
  }

  // Fallback: highest-merge unclassified branch older than 7 days → likely main
  if (bestUnclassifiedBranch) {
    const entry = stats.get(bestUnclassifiedBranch)!;
    const ageMs = Date.now() - new Date(entry.earliestEvent).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const mergesPerWeek =
      Math.round((entry.mergeCount / DAYS_30_IN_WEEKS) * 100) / 100;

    roles.push({
      branch: bestUnclassifiedBranch,
      role: ageDays > 7 ? "main" : "unknown",
      confidence: ageDays > 7 ? 0.6 : 0.3,
      mergesPerWeek,
    });
  }

  return roles;
}
