import type { Card } from "../db/schema.js";
import { getDb } from "../db/connection.js";
import { getEmbedder } from "../embeddings/local-embedder.js";
import { semanticSearch } from "./semantic.js";
import { keywordSearch } from "./keyword.js";

export interface SearchResult {
  card: Card;
  score: number;
  source: "semantic" | "keyword" | "both";
}

const CACHE_SIMILARITY_THRESHOLD = 0.92;
const CACHE_LOOKUP_LIMIT = 50;

/**
 * Checks the metrics table for a recent query whose embedding has cosine
 * similarity > 0.92 with the current query. If found, returns the same
 * cards that were served for that query (a semantic cache hit).
 */
export async function checkCache(
  query: string,
): Promise<SearchResult[] | null> {
  const embedding = await getEmbedder().embed(query);
  const db = getDb();

  const recentMetrics = db
    .prepare(
      "SELECT query_embedding, response_cards FROM metrics WHERE query_embedding IS NOT NULL ORDER BY timestamp DESC LIMIT ?",
    )
    .all(CACHE_LOOKUP_LIMIT) as {
    query_embedding: Buffer;
    response_cards: string;
  }[];

  for (const metric of recentMetrics) {
    const buf = metric.query_embedding;
    const stored = new Float32Array(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    );

    if (stored.length !== embedding.length) continue;

    let dot = 0;
    for (let i = 0; i < embedding.length; i++) {
      dot += embedding[i]! * stored[i]!;
    }

    if (dot > CACHE_SIMILARITY_THRESHOLD) {
      const cardIds: string[] = JSON.parse(metric.response_cards);
      if (cardIds.length === 0) return [];

      const placeholders = cardIds.map(() => "?").join(", ");
      const cards = db
        .prepare(`SELECT * FROM cards WHERE id IN (${placeholders})`)
        .all(...cardIds) as Card[];

      return cards.map((card) => ({
        card,
        score: 1,
        source: "both" as const,
      }));
    }
  }

  return null;
}

/**
 * Runs semantic and keyword search in parallel, then fuses the results
 * using a weighted scoring model:
 *
 *  - Semantic weight: 0.7 (score = 1 - distance, clamped to [0, 1])
 *  - Keyword weight:  0.3 (-rank, min-max normalized to [0, 1])
 *  - Cards appearing in both result sets receive a 1.2x score boost
 *
 * Increments `usage_count` on every returned card.
 */
export async function hybridSearch(
  query: string,
  options?: { branch?: string; limit?: number },
): Promise<SearchResult[]> {
  const limit = options?.limit ?? 5;
  const branch = options?.branch;

  const fetchLimit = limit * 3;
  const [semanticResults, keywordResults] = await Promise.all([
    semanticSearch(query, fetchLimit, branch),
    Promise.resolve(keywordSearch(query, fetchLimit)),
  ]);

  const scoreMap = new Map<
    string,
    { semantic?: number; keyword?: number }
  >();

  for (const sr of semanticResults) {
    const score = Math.max(0, Math.min(1, 1 - sr.distance));
    const entry = scoreMap.get(sr.cardId) ?? {};
    entry.semantic = score;
    scoreMap.set(sr.cardId, entry);
  }

  if (keywordResults.length > 0) {
    const rawScores = keywordResults.map((kr) => -kr.rank);
    const min = Math.min(...rawScores);
    const max = Math.max(...rawScores);
    const range = max - min;

    for (let i = 0; i < keywordResults.length; i++) {
      const kr = keywordResults[i]!;
      const normalized = range === 0 ? 1 : (rawScores[i]! - min) / range;
      const entry = scoreMap.get(kr.cardId) ?? {};
      entry.keyword = normalized;
      scoreMap.set(kr.cardId, entry);
    }
  }

  const combined: {
    cardId: string;
    score: number;
    source: "semantic" | "keyword" | "both";
  }[] = [];

  for (const [cardId, scores] of scoreMap) {
    const hasSemantic = scores.semantic !== undefined;
    const hasKeyword = scores.keyword !== undefined;
    const source: "semantic" | "keyword" | "both" =
      hasSemantic && hasKeyword
        ? "both"
        : hasSemantic
          ? "semantic"
          : "keyword";

    const semanticScore = scores.semantic ?? 0;
    const keywordScore = scores.keyword ?? 0;
    let score = 0.7 * semanticScore + 0.3 * keywordScore;

    if (source === "both") {
      score *= 1.2;
    }

    combined.push({ cardId, score, source });
  }

  combined.sort((a, b) => b.score - a.score);
  const topResults = combined.slice(0, limit);

  if (topResults.length === 0) return [];

  const db = getDb();
  const cardIds = topResults.map((r) => r.cardId);
  const placeholders = cardIds.map(() => "?").join(", ");
  const cards = db
    .prepare(`SELECT * FROM cards WHERE id IN (${placeholders})`)
    .all(...cardIds) as Card[];

  const cardMap = new Map(cards.map((c) => [c.id, c]));

  const updateStmt = db.prepare(
    "UPDATE cards SET usage_count = usage_count + 1 WHERE id = ?",
  );
  const incrementUsage = db.transaction((ids: string[]) => {
    for (const id of ids) updateStmt.run(id);
  });
  incrementUsage(cardIds);

  const results: SearchResult[] = [];
  for (const entry of topResults) {
    const card = cardMap.get(entry.cardId);
    if (card) {
      results.push({
        card: { ...card, usage_count: card.usage_count + 1 },
        score: entry.score,
        source: entry.source,
      });
    }
  }

  return results;
}
