import { getDb } from "../db/connection.js";

export interface KeywordResult {
  cardId: string;
  rank: number;
}

/**
 * Performs full-text search against the `cards_fts` FTS5 virtual table.
 * Maps each FTS rowid back to the corresponding card ID in the `cards` table.
 */
export function keywordSearch(query: string, limit = 10): KeywordResult[] {
  const db = getDb();

  const rows = db
    .prepare(
      "SELECT rowid, rank FROM cards_fts WHERE cards_fts MATCH ? ORDER BY rank LIMIT ?",
    )
    .all(query, limit) as { rowid: number; rank: number }[];

  const idStmt = db.prepare("SELECT id FROM cards WHERE rowid = ?");
  const results: KeywordResult[] = [];

  for (const row of rows) {
    const card = idStmt.get(row.rowid) as { id: string } | undefined;
    if (card) {
      results.push({ cardId: card.id, rank: row.rank });
    }
  }

  return results;
}
