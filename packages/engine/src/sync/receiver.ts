import { getDb } from "../db/connection.js";
import { parseFile } from "../indexer/tree-sitter.js";
import { invalidateCards } from "./invalidator.js";

export interface SyncPayload {
  repo: string;
  branch: string;
  commitSha?: string;
  changedFiles: {
    path: string;
    content: string;
    status: "added" | "modified" | "deleted";
  }[];
  devId?: string;
}

/**
 * Processes a batch of file changes received from the VS Code extension.
 *
 * Added/modified files are parsed with tree-sitter and upserted into
 * `file_index`. Deleted files are removed. Any cards whose source files
 * overlap with the changed set are marked stale.
 */
export async function handleSync(
  payload: SyncPayload,
): Promise<{ indexed: number; invalidated: number }> {
  const db = getDb();

  const changedPaths = payload.changedFiles.map((f) => f.path);

  // Phase 1: parse all non-deleted files (async I/O)
  const parsed = new Map<string, string>();

  for (const file of payload.changedFiles) {
    if (file.status === "deleted") continue;

    let data = "{}";
    try {
      const result = await parseFile(file.path, payload.repo);
      data = JSON.stringify(result);
    } catch {
      data = JSON.stringify({ path: file.path, repo: payload.repo });
    }
    parsed.set(file.path, data);
  }

  // Phase 2: batch DB writes inside a transaction
  const upsert = db.prepare(`
    INSERT INTO file_index (path, repo, branch, commit_sha, parsed_data, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT (path, repo, branch)
    DO UPDATE SET commit_sha  = excluded.commit_sha,
                  parsed_data = excluded.parsed_data,
                  updated_at  = excluded.updated_at
  `);

  const remove = db.prepare(
    `DELETE FROM file_index WHERE path = ? AND repo = ? AND branch = ?`,
  );

  let indexed = 0;

  const applyChanges = db.transaction(() => {
    for (const file of payload.changedFiles) {
      if (file.status === "deleted") {
        remove.run(file.path, payload.repo, payload.branch);
        continue;
      }

      upsert.run(
        file.path,
        payload.repo,
        payload.branch,
        payload.commitSha ?? "",
        parsed.get(file.path) ?? "{}",
      );
      indexed++;
    }
  });

  applyChanges();

  // Phase 3: mark affected cards as stale
  const invalidated = invalidateCards(changedPaths, payload.repo);

  return { indexed, invalidated };
}
