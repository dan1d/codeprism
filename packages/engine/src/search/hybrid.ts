import type { Card } from "../db/schema.js";
import { getDb } from "../db/connection.js";
import { getEmbedder } from "../embeddings/local-embedder.js";
import { semanticSearch } from "./semantic.js";
import { keywordSearch } from "./keyword.js";
import { classifyQueryEmbedding } from "./query-classifier.js";

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

const TYPE_BOOST: Record<string, number> = {
  model: 1.0,
  flow: 1.0,
  cross_service: 0.95,
  hub: 0.4,
  dev_insight: 1.1,
};

/**
 * Text-signal keywords that suggest a query belongs to a specific repo.
 * Generic and project-agnostic -- teams can use search_config to extend.
 */
const REPO_SIGNALS: Record<string, string[]> = {
  "biobridge-frontend": [
    "frontend", "react", "component", "redux", "slice", "store",
    "modal", "button", "form", "table", "page", "layout", "hook",
    "ui", "render", "css", "style", "tsx", "jsx",
  ],
  "biobridge-backend": [
    "backend", "rails", "controller", "model", "migration", "job",
    "serializer", "concern", "mailer", "route", "middleware",
    "active record", "association", "validation", "callback",
  ],
  "bp-monitor-frontend": ["bp-monitor", "vue", "bp monitor"],
  "bp-monitor-api": ["bp-monitor-api", "cuba", "bp monitor api"],
};

/**
 * Counts how many keyword signals in `REPO_SIGNALS` each repo matches
 * against the query. Returns an empty map if no signals are found.
 */
function detectTextRepoAffinity(query: string): Map<string, number> {
  const lower = query.toLowerCase();
  const scores = new Map<string, number>();
  for (const [repo, signals] of Object.entries(REPO_SIGNALS)) {
    let hits = 0;
    for (const signal of signals) {
      if (lower.includes(signal)) hits++;
    }
    if (hits > 0) scores.set(repo, hits);
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

  const allCandidateIds = new Set<string>();
  const scoreMap = new Map<
    string,
    { semantic?: number; keyword?: number }
  >();

  for (const sr of semanticResults) {
    const score = Math.max(0, Math.min(1, 1 - sr.distance));
    const entry = scoreMap.get(sr.cardId) ?? {};
    entry.semantic = score;
    scoreMap.set(sr.cardId, entry);
    allCandidateIds.add(sr.cardId);
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
      allCandidateIds.add(kr.cardId);
    }
  }

  if (allCandidateIds.size === 0) return [];

  const db = getDb();
  const ids = [...allCandidateIds];
  const placeholders = ids.map(() => "?").join(", ");
  const allCards = db
    .prepare(`SELECT * FROM cards WHERE id IN (${placeholders})`)
    .all(...ids) as Card[];
  const cardMap = new Map(allCards.map((c) => [c.id, c]));

  // Compute repo affinity from text signals (cheap, synchronous)
  const textAffinity = detectTextRepoAffinity(query);

  // Supplement with embedding-based classification when text signals are weak
  let embeddingClassification: Map<string, number> | null = null;
  if (textAffinity.size === 0 && semanticResults.length > 0) {
    try {
      const qEmb = await getEmbedder().embed(semanticQuery);
      const cls = classifyQueryEmbedding(qEmb);
      if (cls.confidence > 0.03 && cls.topRepo) {
        embeddingClassification = cls.scores;
      }
    } catch { /* non-critical */ }
  }

  const combinedAffinity = textAffinity.size > 0 ? textAffinity : null;
  const maxTextAffinity = combinedAffinity
    ? Math.max(...combinedAffinity.values())
    : 0;

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

    if (source === "both") score *= 1.2;

    const card = cardMap.get(cardId);
    if (!card) continue;

    const typeBoost = TYPE_BOOST[card.card_type] ?? 1.0;
    score *= typeBoost;

    const usageBoost = 1 + 0.05 * Math.log2(1 + card.usage_count);
    score *= usageBoost;

    const specificity = card.specificity_score;
    if (specificity != null) {
      score *= 0.6 + 0.4 * specificity;
    }

    // Repo-affinity scoring (text-signal based)
    if (combinedAffinity && maxTextAffinity > 0) {
      let cardRepos: string[] = [];
      try { cardRepos = JSON.parse(card.source_repos); } catch { /* skip */ }
      let repoScore = 0;
      for (const repo of cardRepos) {
        repoScore = Math.max(repoScore, combinedAffinity.get(repo) ?? 0);
      }
      const repoMultiplier = 0.6 + 0.4 * (repoScore / maxTextAffinity);
      score *= repoMultiplier;
    } else if (embeddingClassification) {
      // Fallback: embedding-based classification (softer, 0.85-1.15 range)
      let cardRepos: string[] = [];
      try { cardRepos = JSON.parse(card.source_repos); } catch { /* skip */ }
      let maxSim = 0;
      for (const repo of cardRepos) {
        maxSim = Math.max(maxSim, embeddingClassification.get(repo) ?? 0);
      }
      const allSims = [...embeddingClassification.values()];
      const minSim = Math.min(...allSims);
      const simRange = Math.max(...allSims) - minSim;
      const normalized = simRange > 0 ? (maxSim - minSim) / simRange : 0.5;
      score *= 0.85 + 0.3 * normalized;
    }

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

  const cappedResults: typeof combined = [];
  let hubCount = 0;
  for (const entry of combined) {
    const card = cardMap.get(entry.cardId);
    if (card?.card_type === "hub") {
      if (hubCount >= MAX_HUB_CARDS) continue;
      hubCount++;
    }
    cappedResults.push(entry);
    if (cappedResults.length >= limit) break;
  }
  const topResults = cappedResults;

  if (topResults.length === 0) return [];

  const resultCardIds = topResults.map((r) => r.cardId);
  const updateStmt = db.prepare(
    "UPDATE cards SET usage_count = usage_count + 1 WHERE id = ?",
  );
  const incrementUsage = db.transaction((cids: string[]) => {
    for (const id of cids) updateStmt.run(id);
  });
  incrementUsage(resultCardIds);

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
