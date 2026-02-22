import type { SearchResult } from "./hybrid.js";
import { getDb } from "../db/connection.js";

const LAMBDA = 0.7;

/**
 * Maximal Marginal Relevance re-ranking. Given a set of scored search results,
 * greedily selects items that maximize:
 *
 *   lambda * relevance - (1 - lambda) * max_similarity_to_already_selected
 *
 * This preserves relevance while penalizing redundancy -- especially useful
 * when multiple hub cards or similar flow cards appear in the results.
 */
export function mmrRerank(
  results: SearchResult[],
  topK: number,
): SearchResult[] {
  if (results.length <= topK) return results;

  const db = getDb();
  const embeddingMap = new Map<string, Float32Array>();

  for (const r of results) {
    const row = db
      .prepare("SELECT embedding FROM card_embeddings WHERE card_id = ?")
      .get(r.card.id) as { embedding: Buffer } | undefined;

    if (row) {
      const buf = row.embedding;
      embeddingMap.set(
        r.card.id,
        new Float32Array(
          buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        ),
      );
    }
  }

  const maxScore = Math.max(...results.map((r) => r.score), 1e-9);
  const normalizedScores = new Map(
    results.map((r) => [r.card.id, r.score / maxScore]),
  );

  const selected: SearchResult[] = [];
  const remaining = new Set(results.map((r) => r.card.id));
  const resultMap = new Map(results.map((r) => [r.card.id, r]));

  while (selected.length < topK && remaining.size > 0) {
    let bestId: string | null = null;
    let bestMmrScore = -Infinity;

    for (const candidateId of remaining) {
      const relevance = normalizedScores.get(candidateId) ?? 0;
      const candidateEmb = embeddingMap.get(candidateId);

      let maxSim = 0;
      if (candidateEmb) {
        for (const sel of selected) {
          const selEmb = embeddingMap.get(sel.card.id);
          if (selEmb) {
            maxSim = Math.max(maxSim, cosine(candidateEmb, selEmb));
          }
        }
      }

      const mmrScore = LAMBDA * relevance - (1 - LAMBDA) * maxSim;
      if (mmrScore > bestMmrScore) {
        bestMmrScore = mmrScore;
        bestId = candidateId;
      }
    }

    if (!bestId) break;

    remaining.delete(bestId);
    const result = resultMap.get(bestId);
    if (result) selected.push(result);
  }

  return selected;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}
