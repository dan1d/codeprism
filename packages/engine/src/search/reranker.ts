import type { SearchResult } from "./hybrid.js";

const MODEL_ID = "Xenova/ms-marco-MiniLM-L-6-v2";
const MAX_PASSAGE_CHARS = 512;

// Lazy-loaded singleton pipeline
let _pipe: unknown = null;
let _initPromise: Promise<unknown> | null = null;

async function getPipeline(): Promise<unknown> {
  if (_pipe) return _pipe;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      const { pipeline } = await import("@huggingface/transformers");
      _pipe = await pipeline("text-classification", MODEL_ID);
      return _pipe;
    } catch (err) {
      // Clear the cached promise so the next search attempt can retry
      _initPromise = null;
      throw err;
    }
  })();

  return _initPromise;
}

/**
 * Score query-passage pairs using the ms-marco cross-encoder.
 * Returns a relevance probability in [0, 1] for each result.
 * Falls back to normalised hybrid scores on any error.
 */
export async function crossEncoderScore(
  query: string,
  results: SearchResult[],
): Promise<number[]> {
  if (results.length === 0) return [];

  try {
    const pipe = await getPipeline() as (
      input: Array<{ text: string; text_pair: string }>,
      opts: { function_to_apply: string },
    ) => Promise<Array<{ label: string; score: number } | Array<{ label: string; score: number }>>>;

    const pairs = results.map((r) => ({
      text: query.slice(0, 256),
      text_pair: `${r.card.title}\n${r.card.content}`.slice(0, MAX_PASSAGE_CHARS),
    }));

    const outputs = await pipe(pairs, { function_to_apply: "sigmoid" });

    return outputs.map((output) => {
      // ms-marco outputs either a single object or an array per input
      const items = Array.isArray(output) ? output : [output];
      // Prefer LABEL_1 (relevant class); fall back to first item
      const relevant = items.find((o) => o.label === "LABEL_1") ?? items[0];
      return relevant?.score ?? 0;
    });
  } catch (err) {
    // Non-critical — fall back to normalised hybrid scores
    console.warn("[reranker] Cross-encoder unavailable, using hybrid scores:", (err as Error).message);
    const max = Math.max(...results.map((r) => r.score), 1e-9);
    return results.map((r) => r.score / max);
  }
}

/**
 * Rerank search results using the cross-encoder blended with hybrid scores.
 *
 * Scores are blended: final = wHybrid * normalised_hybrid + wCe * cross_encoder.
 * Weights are automatically normalised so they always sum to 1.
 * Candidate list is capped at `candidateCap` before inference to bound latency.
 *
 * Returns top-K results sorted by final score.
 */
export async function crossEncoderRerank(
  query: string,
  results: SearchResult[],
  topK: number,
  weights = { hybrid: 0.4, ce: 0.6 },
  candidateCap = 30,
): Promise<SearchResult[]> {
  if (results.length === 0) return [];
  if (results.length <= topK) return results;

  // Cap candidates — tail entries add noise after cross-encoder, not signal
  const cap = Math.max(topK, candidateCap);
  const candidates = results.length > cap ? results.slice(0, cap) : results;

  const ceScores = await crossEncoderScore(query, candidates);
  const maxHybrid = Math.max(...candidates.map((r) => r.score), 1e-9);

  // Normalise weights so they always sum to 1
  const total = (weights.hybrid + weights.ce) || 1;
  const wH = weights.hybrid / total;
  const wC = weights.ce / total;

  const reranked = candidates.map((r, i) => ({
    ...r,
    score: wH * (r.score / maxHybrid) + wC * (ceScores[i] ?? 0),
  }));

  reranked.sort((a, b) => b.score - a.score);
  return reranked.slice(0, topK);
}

/**
 * Warm the cross-encoder model in the background at server startup.
 * Prevents cold-start latency on the first real query.
 */
export function warmReranker(): void {
  getPipeline().catch((err) =>
    console.warn("[reranker] Warmup failed:", (err as Error).message),
  );
}
