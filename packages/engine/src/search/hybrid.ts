import type { Card } from "../db/schema.js";
import { getDb } from "../db/connection.js";
import { getEmbedder } from "../embeddings/local-embedder.js";
import { semanticSearch } from "./semantic.js";
import { keywordSearch } from "./keyword.js";
import { classifyQueryEmbedding } from "./query-classifier.js";
import { rerankResults } from "./reranker.js";
import { loadRepoSignals } from "./repo-signals.js";

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
  const embedding = await getEmbedder().embed(query, "query");
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

const TYPE_BOOST: Record<string, number> = {
  model: 1.0,
  flow: 1.0,
  cross_service: 0.95,
  hub: 0.4,
  dev_insight: 1.1,
};

/**
 * Reciprocal Rank Fusion score across multiple retrieval lists.
 * Standard RRF formula: Σ 1/(k + rank_i), k=60 per Cormack et al. (2009).
 * A card appearing in two lists at rank 0 scores ~0.033 (vs 0.016 for one).
 */
export function computeRrfScore(ranks: number[], k = 60): number {
  return ranks.reduce((sum, rank) => sum + 1 / (k + rank), 0);
}

/**
 * Minimum number of signal hits before a repo earns a text-affinity boost.
 * A threshold of 2 prevents single spurious keyword matches (e.g. a query
 * containing the word "client") from distorting the affinity multiplier.
 */
const MIN_SIGNAL_HITS = 2;

/**
 * Counts how many keyword signals each repo matches against the query.
 * Signals are loaded from the `repo_signals` table (generated at index time
 * from detected stack profile + LLM docs). Returns an empty map if no signals
 * are stored — the embedding classifier handles affinity in that case.
 *
 * Requires at least MIN_SIGNAL_HITS matches before a repo earns a score entry,
 * preventing single-word false positives.
 */
function detectTextRepoAffinity(query: string): Map<string, number> {
  const lower = query.toLowerCase();
  const scores = new Map<string, number>();
  for (const [repo, signals] of loadRepoSignals()) {
    let hits = 0;
    for (const signal of signals) {
      if (lower.includes(signal)) hits++;
    }
    if (hits >= MIN_SIGNAL_HITS) scores.set(repo, hits);
  }
  return scores;
}

/**
 * Runs semantic and keyword search in parallel, then fuses results with:
 *  - Semantic weight: 0.7, keyword weight: 0.3
 *  - 1.2x boost for cards appearing in both result sets
 *  - Card-type multiplier (hubs penalized at 0.4x)
 *  - Usage-count logarithmic boost
 *  - Specificity_score boost (populated after centroid computation)
 *  - Repo-affinity multiplier (text signals + embedding-based classifier)
 *
 * @param semanticQuery - optional override for the query used in semantic
 *   search only (BM25 always uses the original query). Used for prefix-
 *   boosted embeddings in srcmap_context.
 */
export async function hybridSearch(
  query: string,
  options?: { branch?: string; limit?: number; semanticQuery?: string },
): Promise<SearchResult[]> {
  const limit = options?.limit ?? 5;
  const branch = options?.branch;
  const semanticQuery = options?.semanticQuery ?? query;

  const fetchLimit = limit * 4;
  const [semanticResults, keywordResults] = await Promise.all([
    semanticSearch(semanticQuery, fetchLimit, branch),
    Promise.resolve(keywordSearch(query, fetchLimit)),
  ]);

  // Build rank maps for RRF (position 0 = best match in each list)
  const semanticRankMap = new Map<string, number>();
  for (let i = 0; i < semanticResults.length; i++) {
    semanticRankMap.set(semanticResults[i]!.cardId, i);
  }
  const keywordRankMap = new Map<string, number>();
  for (let i = 0; i < keywordResults.length; i++) {
    keywordRankMap.set(keywordResults[i]!.cardId, i);
  }

  // Union of all candidate IDs from both retrieval lists
  const allCandidateIds = new Set<string>([
    ...semanticRankMap.keys(),
    ...keywordRankMap.keys(),
  ]);

  if (allCandidateIds.size === 0) return [];

  const db = getDb();
  const ids = [...allCandidateIds];
  const placeholders = ids.map(() => "?").join(", ");
  const allCards = db
    .prepare(`SELECT * FROM cards WHERE id IN (${placeholders})`)
    .all(...ids) as Card[];
  const cardMap = new Map(allCards.map((c) => [c.id, c]));

  // --- Repo affinity: both text and embedding run always, blended ---
  //
  // Text signals (fast, synchronous): precise for explicit keyword queries
  //   ("the Rails controller", "the Vue composable", "pre_authorization billing")
  // Embedding classifier (async, centroid-based): robust for semantic queries
  //   ("how does payment work?", "what handles device pairing?")
  //
  // Running both always and blending at 60/40 means neither becomes dead code.
  // When text signals are absent (fresh install / no signals generated yet),
  // only the embedding signal applies (multiplier weight shifts to 1.0 embedding).

  const textAffinity = detectTextRepoAffinity(query);
  const maxTextAffinity = textAffinity.size > 0 ? Math.max(...textAffinity.values()) : 0;

  // Embedding classifier — always attempt, non-blocking on failure
  let embeddingClassification: Map<string, number> | null = null;
  if (semanticResults.length > 0) {
    try {
      const qEmb = await getEmbedder().embed(semanticQuery, "query");
      const cls = classifyQueryEmbedding(qEmb);
      if (cls.confidence > 0.03 && cls.topRepo) {
        embeddingClassification = cls.scores;
      }
    } catch { /* non-critical — centroid cache may be cold */ }
  }

  const combined: {
    cardId: string;
    score: number;
    source: "semantic" | "keyword" | "both";
  }[] = [];

  for (const cardId of allCandidateIds) {
    const semRank = semanticRankMap.get(cardId);
    const kwRank  = keywordRankMap.get(cardId);

    const hasSemantic = semRank !== undefined;
    const hasKeyword  = kwRank  !== undefined;
    const source: "semantic" | "keyword" | "both" =
      hasSemantic && hasKeyword ? "both"
      : hasSemantic ? "semantic"
      : "keyword";

    // RRF base score — additive across lists, naturally rewards dual-list hits
    const ranks: number[] = [];
    if (semRank !== undefined) ranks.push(semRank);
    if (kwRank  !== undefined) ranks.push(kwRank);
    let score = computeRrfScore(ranks);

    const card = cardMap.get(cardId);
    if (!card) continue;

    score *= TYPE_BOOST[card.card_type] ?? 1.0;
    score *= 1 + 0.05 * Math.log2(1 + card.usage_count);

    const specificity = card.specificity_score;
    if (specificity != null) score *= 0.6 + 0.4 * specificity;

    // --- Blended repo-affinity multiplier ---
    // Parses the card's repo list once; both text and embedding paths use it.
    let cardRepos: string[] = [];
    try { cardRepos = JSON.parse(card.source_repos); } catch { /* skip */ }

    // Text-affinity component (0.6x–1.0x range, weight 0.60)
    let textMultiplier = 0.6; // base penalty for no match
    if (maxTextAffinity > 0) {
      let bestHits = 0;
      for (const repo of cardRepos) bestHits = Math.max(bestHits, textAffinity.get(repo) ?? 0);
      textMultiplier = 0.6 + 0.4 * (bestHits / maxTextAffinity);
    }

    // Embedding-affinity component (0.85x–1.15x range, weight 0.40)
    let embMultiplier = 1.0; // neutral when classifier unavailable
    if (embeddingClassification) {
      let maxSim = 0;
      for (const repo of cardRepos) maxSim = Math.max(maxSim, embeddingClassification.get(repo) ?? 0);
      const allSims = [...embeddingClassification.values()];
      const minSim  = Math.min(...allSims);
      const simRange = Math.max(...allSims) - minSim;
      const normalized = simRange > 0 ? (maxSim - minSim) / simRange : 0.5;
      embMultiplier = 0.85 + 0.30 * normalized;
    }

    // Blend: 60% text, 40% embedding. When text signals are absent (textAffinity.size === 0),
    // textMultiplier stays at its base 0.6, and embMultiplier carries the full signal.
    // Avoid double-penalizing by using max when no text signals are stored yet.
    const repoMultiplier = textAffinity.size > 0
      ? textMultiplier * 0.60 + embMultiplier * 0.40
      : embMultiplier; // no text signals → embedding only

    score *= repoMultiplier;

    combined.push({ cardId, score, source });
  }

  combined.sort((a, b) => b.score - a.score);

  // Read max_hub_cards from search_config (default 2) to prevent hub noise
  // Using Number.isNaN so that max_hub_cards=0 is honoured (fully suppress hubs)
  const hubCapRow = db
    .prepare("SELECT value FROM search_config WHERE key = 'max_hub_cards'")
    .get() as { value: string } | undefined;
  const parsedHubCap = hubCapRow ? parseInt(hubCapRow.value, 10) : NaN;
  const MAX_HUB_CARDS = Number.isNaN(parsedHubCap) ? 2 : parsedHubCap;

  // Build SearchResult[] from top candidates (up to 20) for optional reranking
  const RERANK_LIMIT = 20;
  const candidateResults: SearchResult[] = [];
  for (const entry of combined.slice(0, RERANK_LIMIT)) {
    const card = cardMap.get(entry.cardId);
    if (card) {
      candidateResults.push({ card, score: entry.score, source: entry.source });
    }
  }

  if (candidateResults.length === 0) return [];

  // Optional neural reranking — graceful: if model unavailable, keep RRF order
  let orderedResults = candidateResults;
  try {
    orderedResults = await rerankResults(query, candidateResults, limit * 2);
  } catch { /* Reranker unavailable, continue with RRF ordering */ }

  // Apply hub cap + limit on final ordered results
  const cappedResults: SearchResult[] = [];
  let hubCount = 0;
  for (const result of orderedResults) {
    if (result.card.card_type === "hub") {
      if (hubCount >= MAX_HUB_CARDS) continue;
      hubCount++;
    }
    cappedResults.push(result);
    if (cappedResults.length >= limit) break;
  }

  if (cappedResults.length === 0) return [];

  const resultCardIds = cappedResults.map((r) => r.card.id);
  const updateStmt = db.prepare(
    "UPDATE cards SET usage_count = usage_count + 1 WHERE id = ?",
  );
  const incrementUsage = db.transaction((cids: string[]) => {
    for (const id of cids) updateStmt.run(id);
  });
  incrementUsage(resultCardIds);

  return cappedResults.map((r) => ({
    ...r,
    card: { ...r.card, usage_count: r.card.usage_count + 1 },
  }));
}
