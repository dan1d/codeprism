/**
 * Semantic deduplication for extracted insights.
 *
 * Before inserting a new insight into the DB, we check if a semantically
 * equivalent insight already exists. If cosine similarity > DEDUP_THRESHOLD,
 * the existing insight receives a corroboration boost (+0.1 trust, capped at
 * +0.2 total) rather than creating a duplicate card.
 *
 * Embedding is done with the same local embedder used for card search,
 * keeping all inference in-process at zero external API cost.
 */

import { getEmbedder } from "../embeddings/local-embedder.js";
import type { ExtractedInsight } from "./extractor.js";

const DEDUP_THRESHOLD = 0.82;
const MAX_CORROBORATION_BOOST = 0.2;

export interface DeduplicatedInsight {
  insight: ExtractedInsight;
  /** ID of existing insight if this is a corroboration (no new card), undefined if new */
  corroboratesId?: string;
  /** Adjusted trust_score after corroboration boost */
  trustScore: number;
}

export interface StoredInsightEmbedding {
  id: string;
  statement: string;
  embedding: Float32Array;
  trustScore: number;
  corroborationCount: number;
}

/**
 * Computes cosine similarity between two Float32Array vectors.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Deduplicates a batch of new insights against the existing stored embeddings.
 *
 * For each new insight:
 *   - Embed the statement
 *   - Compare against existing embeddings
 *   - If similarity > DEDUP_THRESHOLD: return as corroboration (no new card)
 *   - Otherwise: return as new (insert new card)
 *
 * **Side-effect**: `existing` is mutated in-place. Newly accepted insights are
 * appended to `existing` so that later insights in the same batch can
 * corroborate them. Callers that share the `existing` array across calls must
 * be aware that it grows after each invocation.
 */
export async function deduplicateInsights(
  newInsights: ExtractedInsight[],
  existing: StoredInsightEmbedding[],
): Promise<DeduplicatedInsight[]> {
  const embedder = getEmbedder();
  const results: DeduplicatedInsight[] = [];

  for (const insight of newInsights) {
    const embedding = await embedder.embed(insight.statement, "query");

    let bestSim = 0;
    let bestExisting: StoredInsightEmbedding | undefined;

    for (const stored of existing) {
      const sim = cosineSimilarity(embedding, stored.embedding);
      if (sim > bestSim) {
        bestSim = sim;
        bestExisting = stored;
      }
    }

    if (bestSim > DEDUP_THRESHOLD && bestExisting) {
      // Corroboration boost: +0.1 per additional source, capped at +0.2
      const boostMultiplier = Math.min(bestExisting.corroborationCount + 1, 2);
      const boost = 0.1 * boostMultiplier;
      const boostedTrust = Math.min(bestExisting.trustScore + boost - (boostMultiplier - 1) * 0.1, 1.0);

      results.push({
        insight,
        corroboratesId: bestExisting.id,
        trustScore: boostedTrust,
      });

      // Update in-memory corroboration count so later insights in the batch see it
      bestExisting.corroborationCount += 1;
      bestExisting.trustScore = boostedTrust;
    } else {
      results.push({
        insight,
        trustScore: insight.confidence * 0.5, // initial trust = half confidence
      });

      // Add to existing so later insights in this batch can dedup against it
      existing.push({
        id: `pending-${results.length}`,
        statement: insight.statement,
        embedding,
        trustScore: insight.confidence * 0.5,
        corroborationCount: 0,
      });
    }
  }

  return results;
}
