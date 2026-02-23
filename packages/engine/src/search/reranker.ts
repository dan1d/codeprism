import { pipeline } from "@huggingface/transformers";
import type { SearchResult } from "./hybrid.js";

let rerankerPipeline: Awaited<ReturnType<typeof pipeline>> | null = null;

/**
 * Re-ranks a list of search candidates using a local cross-encoder model.
 * The model (`cross-encoder/ms-marco-MiniLM-L-6-v2`) scores each
 * (query, document) pair and sorts by relevance — no external API call.
 *
 * The pipeline is loaded lazily on first use and cached for subsequent calls.
 * If the model fails to load (e.g. offline, no cache), this function throws
 * so that the caller can fall back to the original ordering.
 */
export async function rerankResults(
  query: string,
  candidates: SearchResult[],
  topK: number,
): Promise<SearchResult[]> {
  if (candidates.length <= 1) return candidates;

  if (!rerankerPipeline) {
    rerankerPipeline = await pipeline(
      "text-classification",
      "cross-encoder/ms-marco-MiniLM-L-6-v2",
    );
  }

  const pairs = candidates.map(
    (c) => `${query} [SEP] ${c.card.title}\n${c.card.content.slice(0, 512)}`,
  );

  const scores = await rerankerPipeline(pairs, { truncation: true });

  return candidates
    .map((c, i) => ({
      ...c,
      score: Array.isArray(scores)
        ? ((scores[i] as { score: number }).score ?? 0)
        : 0,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
