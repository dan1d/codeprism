import { getDb } from "../db/connection.js";
import { getEmbedder } from "../embeddings/local-embedder.js";

export interface SemanticResult {
  cardId: string;
  distance: number;
}

/**
 * Performs vector similarity search against the `card_embeddings` vec0 table
 * and, when available, the `card_title_embeddings` table. The effective
 * distance for each card is the minimum across both tables (dual-vector
 * retrieval), improving recall for short, specific queries.
 *
 * Optionally filters results to cards whose `valid_branches` JSON array
 * includes the given branch (cards with `null` branches are always included).
 */
export async function semanticSearch(
  query: string,
  limit = 10,
  branch?: string,
): Promise<SemanticResult[]> {
  const embedding = await getEmbedder().embed(query, "query");
  const db = getDb();

  const embeddingBuf = Buffer.from(
    embedding.buffer,
    embedding.byteOffset,
    embedding.byteLength,
  );

  const fetchLimit = branch ? limit * 3 : limit;

  // Query content embeddings (always present)
  const contentRows = db
    .prepare(
      "SELECT card_id, distance FROM card_embeddings WHERE embedding MATCH ? ORDER BY distance LIMIT ?",
    )
    .all(embeddingBuf, fetchLimit) as { card_id: string; distance: number }[];

  // Query title embeddings (added in migration v14 — graceful if absent)
  let titleRows: { card_id: string; distance: number }[] = [];
  try {
    titleRows = db
      .prepare(
        "SELECT card_id, distance FROM card_title_embeddings WHERE embedding MATCH ? ORDER BY distance LIMIT ?",
      )
      .all(embeddingBuf, fetchLimit) as { card_id: string; distance: number }[];
  } catch {
    // Table doesn't exist yet (pre-migration v14), skip silently
  }

  // Merge: take minimum distance per card across both tables
  const distMap = new Map<string, number>();
  for (const row of contentRows) distMap.set(row.card_id, row.distance);
  for (const row of titleRows) {
    const existing = distMap.get(row.card_id);
    if (existing === undefined || row.distance < existing) {
      distMap.set(row.card_id, row.distance);
    }
  }

  const rows = [...distMap.entries()]
    .map(([card_id, distance]) => ({ card_id, distance }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, fetchLimit);

  if (!branch) {
    return rows.slice(0, limit).map((r) => ({
      cardId: r.card_id,
      distance: r.distance,
    }));
  }

  const branchStmt = db.prepare(
    "SELECT valid_branches FROM cards WHERE id = ?",
  );
  const results: SemanticResult[] = [];

  for (const row of rows) {
    if (results.length >= limit) break;

    const card = branchStmt.get(row.card_id) as
      | { valid_branches: string | null }
      | undefined;
    if (!card) continue;

    if (card.valid_branches === null) {
      results.push({ cardId: row.card_id, distance: row.distance });
      continue;
    }

    const branches: string[] = JSON.parse(card.valid_branches);
    if (branches.includes(branch)) {
      results.push({ cardId: row.card_id, distance: row.distance });
    }
  }

  return results;
}
