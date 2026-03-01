import { pipeline } from "@huggingface/transformers";
import type { SearchResult } from "./hybrid.js";

/**
 * Cross-encoder reranker for codeprism_context.
 *
 * Default: jinaai/jina-reranker-v2-base-multilingual (~278MB, code-aware, macOS safe)
 *   - Trained for code search and agentic RAG (not just web search like ms-marco)
 *   - Supports up to 8K token context; no macOS ONNX mutex issues
 *   - Outputs a single relevance score per query-passage pair
 *
 * Override via env:
 *   CODEPRISM_RERANKER_MODEL=cross-encoder/ms-marco-MiniLM-L-12-v2  (67MB, faster)
 *   CODEPRISM_RERANKER_MODEL=mixedbread-ai/mxbai-rerank-xsmall-v1   (45MB, fast general)
 *   CODEPRISM_RERANKER_MODEL=BAAI/bge-reranker-v2-m3                 (GPU only, crashes macOS)
 *
 * Falls back gracefully to RRF ordering if model fails to load.
 */
const RERANKER_MODEL =
  process.env["CODEPRISM_RERANKER_MODEL"] ?? "jinaai/jina-reranker-v2-base-multilingual";

let rerankerPipeline: Awaited<ReturnType<typeof pipeline>> | null = null;
let loadFailed = false;

/** Eagerly warms up the reranker pipeline so first-query latency is lower. */
export function warmReranker(): void {
  if (loadFailed) return;
  pipeline("text-classification", RERANKER_MODEL, { dtype: "fp32" })
    .then((p) => { rerankerPipeline = p; })
    .catch(() => { loadFailed = true; /* non-fatal */ });
}

export async function rerankResults(
  query: string,
  candidates: SearchResult[],
  topK: number,
): Promise<SearchResult[]> {
  if (candidates.length <= 1) return candidates;
  if (loadFailed) return candidates.slice(0, topK);

  if (!rerankerPipeline) {
    try {
      rerankerPipeline = await pipeline("text-classification", RERANKER_MODEL, { dtype: "fp32" });
    } catch {
      loadFailed = true;
      return candidates.slice(0, topK);
    }
  }

  // Pass as proper (query, passage) pairs so the tokenizer inserts [SEP] correctly.
  // Title is included first so the model sees the card name prominently.
  // Content is capped at 2000 chars — jina-v2 supports up to 8K tokens, so we can
  // afford more context than ms-marco (which was limited to 512 tokens / ~1200 chars).
  const pairs = candidates.map((c) => ({
    text: query,
    text_pair: `${c.card.title}\n${c.card.content.slice(0, 2000)}`,
  }));

  let rawScores: Array<{ label: string; score: number } | Array<{ label: string; score: number }>>;
  try {
    rawScores = (await rerankerPipeline(pairs, { truncation: true })) as typeof rawScores;
  } catch {
    return candidates.slice(0, topK);
  }

  // Cross-encoders output binary classification (relevant/not-relevant).
  // Different models use different label conventions — we normalise to a single
  // [0,1] relevance score using a robust strategy:
  //   - Array output (returnAllScores mode): find LABEL_1 if present, else use max score.
  //     For ms-marco and jina-v2: LABEL_1 = relevant.
  //   - Single-label output: if LABEL_1, use score directly; else invert (1 - score).
  const relevanceScores = rawScores.map((r) => {
    if (Array.isArray(r)) {
      const l1 = r.find((x) => x.label === "LABEL_1");
      return l1 ? l1.score : Math.max(...r.map((x) => x.score));
    }
    const single = r as { label: string; score: number };
    return single.label === "LABEL_1" ? single.score : 1 - single.score;
  });

  return candidates
    .map((c, i) => ({ ...c, score: relevanceScores[i] ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
