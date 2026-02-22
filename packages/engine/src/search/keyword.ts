import { getDb } from "../db/connection.js";

export interface KeywordResult {
  cardId: string;
  rank: number;
}

/**
 * Sanitizes raw text into a safe FTS5 query by stripping URLs, special
 * characters, and FTS5 operators, then quoting each remaining token.
 */
export function sanitizeFts5Query(raw: string): string {
  const cleaned = raw
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^a-zA-Z0-9_\s]/g, " ");

  const tokens = cleaned
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .slice(0, 30);

  if (tokens.length === 0) return "";

  return tokens.map((t) => `"${t}"`).join(" OR ");
}

/**
 * Performs full-text search against the `cards_fts` FTS5 virtual table.
 * Maps each FTS rowid back to the corresponding card ID in the `cards` table.
 */
export function keywordSearch(query: string, limit = 10): KeywordResult[] {
  const ftsQuery = sanitizeFts5Query(query);
  if (!ftsQuery) return [];

  const db = getDb();

  const rows = db
    .prepare(
      "SELECT rowid, bm25(cards_fts, 3.0, 1.0, 2.0, 2.0, 1.5) as rank FROM cards_fts WHERE cards_fts MATCH ? ORDER BY rank LIMIT ?",
    )
    .all(ftsQuery, limit) as { rowid: number; rank: number }[];

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
