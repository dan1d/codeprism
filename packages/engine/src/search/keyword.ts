import { getDb } from "../db/connection.js";

export interface KeywordResult {
  cardId: string;
  rank: number;
}

/**
 * FTS5 operators that must be excluded to prevent query injection.
 * Tokens are left unquoted so the Porter stemmer can apply its stemming rules
 * (quoted tokens in FTS5 bypass tokenizers and do exact-match only).
 */
const FTS5_OPERATORS = new Set(["AND", "OR", "NOT", "NEAR"]);

/**
 * Sanitizes raw text into a safe FTS5 query by stripping URLs, special
 * characters, and FTS5 boolean operators, then joining tokens unquoted with OR.
 *
 * Tokens are intentionally NOT quoted so the Porter stemmer configured in
 * migration v15 can stem them — "authorization" will match "authorized",
 * "authorizes", etc. FTS5 operator injection is prevented by an explicit
 * blocklist rather than quoting.
 */
export function sanitizeFts5Query(raw: string): string {
  // Split CamelCase so identifier queries match FTS tokens better
  // (e.g. ActivityPub::ActorSerializer -> Activity Pub Actor Serializer).
  const camelSplit = raw.replace(/([a-z])([A-Z])/g, "$1 $2");

  const cleaned = camelSplit
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^a-zA-Z0-9_\s]/g, " ");

  const tokens = cleaned
    .split(/\s+/)
    .filter((t) => t.length > 1 && !FTS5_OPERATORS.has(t.toUpperCase()))
    .slice(0, 30);

  if (tokens.length === 0) return "";

  // Unquoted tokens — Porter stemmer in cards_fts will apply
  return tokens.join(" OR ");
}

export { FTS5_OPERATORS };

/**
 * Performs full-text search against the `cards_fts` FTS5 virtual table.
 * Maps each FTS rowid back to the corresponding card ID in the `cards` table.
 */
export function keywordSearch(query: string, limit = 10): KeywordResult[] {
  const ftsQuery = sanitizeFts5Query(query);
  if (!ftsQuery) return [];

  const db = getDb();

  // Column order: title(3.0), content(1.0), flow(2.0), source_repos(2.0), tags(1.5), identifiers(4.0)
  // identifiers gets the highest weight — exact class/route names deserve maximum BM25 credit
  const rows = db
    .prepare(
      "SELECT rowid, bm25(cards_fts, 3.0, 1.0, 2.0, 2.0, 1.5, 4.0) as rank FROM cards_fts WHERE cards_fts MATCH ? ORDER BY rank LIMIT ?",
    )
    .all(ftsQuery, limit) as { rowid: number; rank: number }[];

  if (rows.length === 0) return [];

  // Resolve all rowids in a single query instead of N individual lookups
  const placeholders = rows.map(() => "?").join(",");
  const cardRows = db
    .prepare(`SELECT id, rowid FROM cards WHERE rowid IN (${placeholders})`)
    .all(...rows.map((r) => r.rowid)) as { id: string; rowid: number }[];

  const rowidToId = new Map(cardRows.map((c) => [c.rowid, c.id]));

  return rows.flatMap((row) => {
    const cardId = rowidToId.get(row.rowid);
    return cardId ? [{ cardId, rank: row.rank }] : [];
  });
}
