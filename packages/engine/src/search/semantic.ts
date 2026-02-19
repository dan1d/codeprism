import { getDb } from "../db/connection.js";
import { getEmbedder } from "../embeddings/local-embedder.js";

export interface SemanticResult {
  cardId: string;
  distance: number;
}

/**
 * Performs vector similarity search against the `card_embeddings` vec0 table.
 * Optionally filters results to cards whose `valid_branches` JSON array
 * includes the given branch (cards with `null` branches are always included).
 */
export async function semanticSearch(
  query: string,
  limit = 10,
  branch?: string,
): Promise<SemanticResult[]> {
  const embedding = await getEmbedder().embed(query);
  const db = getDb();

  const embeddingBuf = Buffer.from(
    embedding.buffer,
    embedding.byteOffset,
    embedding.byteLength,
  );

  const fetchLimit = branch ? limit * 3 : limit;

  const rows = db
    .prepare(
      "SELECT card_id, distance FROM card_embeddings WHERE embedding MATCH ? ORDER BY distance LIMIT ?",
    )
    .all(embeddingBuf, fetchLimit) as { card_id: string; distance: number }[];

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
