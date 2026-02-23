import { randomUUID } from "node:crypto";
import { getDb } from "../db/connection.js";
import type { Card } from "../db/schema.js";
import { hybridSearch, checkCache, type SearchResult } from "../search/hybrid.js";
import { rerankResults as crossEncoderRerank } from "../search/reranker.js";
import { trackToolCall } from "../metrics/tracker.js";
import { getEmbedder } from "../embeddings/local-embedder.js";
import { classifyQueryEmbedding } from "../search/query-classifier.js";
import { createLLMProvider } from "../llm/provider.js";
import { safeParseJsonArray } from "./utils.js";

export { type SearchResult } from "../search/hybrid.js";

const MAX_CARD_LINES = 40;
const MAX_TOTAL_LINES = 300;

// ---------------------------------------------------------------------------
// search_config — loaded fresh per call to avoid multi-tenant leakage.
// SQLite internally caches prepared statements so this is sub-ms.
// ---------------------------------------------------------------------------

export function getSearchConfig(): Map<string, number> {
  try {
    const rows = getDb()
      .prepare("SELECT key, value FROM search_config")
      .all() as { key: string; value: string }[];
    return new Map(rows.map((r) => [r.key, parseFloat(r.value)]));
  } catch {
    return new Map();
  }
}

export function getSearchConfigValue(key: string, fallback: number): number {
  const v = getSearchConfig().get(key);
  return v !== undefined && !Number.isNaN(v) ? v : fallback;
}

/**
 * No-op kept for API compatibility. Caches are no longer module-scoped
 * so there is nothing to invalidate.
 */
export function invalidateSearchConfig(): void {
  // intentionally empty — no module-level cache to bust
}

// ---------------------------------------------------------------------------
// Card formatting
// ---------------------------------------------------------------------------

export type CardSummary = Pick<Card, "id" | "flow" | "title" | "content" | "source_files" | "card_type" | "specificity_score" | "usage_count"> & {
  stale?: number;
  verified_at?: string | null;
  verification_count?: number;
};

export function truncateContent(content: string, maxLines: number): string {
  const lines = content.split("\n");
  if (lines.length <= maxLines) return content;
  return lines.slice(0, maxLines).join("\n") + "\n\n_(truncated)_";
}

export function shortenPath(p: string): string {
  const parts = p.split("/");
  const repoIdx = parts.findIndex((_seg, i) =>
    i > 0 && (parts[i + 1] === "app" || parts[i + 1] === "src" || parts[i + 1] === "lib" || parts[i + 1] === "packages"),
  );
  if (repoIdx >= 0) return parts.slice(repoIdx).join("/");
  return parts.length > 3 ? parts.slice(-3).join("/") : p;
}

export function formatCards(cards: CardSummary[], totalLinesBudget = MAX_TOTAL_LINES): string {
  const parts: string[] = [];
  let linesUsed = 0;

  for (let i = 0; i < cards.length; i++) {
    const r = cards[i]!;
    const trimmed = truncateContent(r.content, MAX_CARD_LINES);

    const files = safeParseJsonArray(r.source_files);
    const fileList = files.slice(0, 5).map((f) => shortenPath(f)).join(", ");
    const moreFiles = files.length > 5 ? ` +${files.length - 5} more` : "";

    let confidence = "likely valid";
    if (r.stale) confidence = "\u26a0 needs verification";
    else if (r.verified_at) confidence = `\u2713 verified (${r.verification_count ?? 0}x)`;

    const block =
      `### ${i + 1}. ${r.title}\n` +
      `**Flow:** ${r.flow} | **Type:** ${r.card_type} | **Confidence:** ${confidence}\n` +
      `**Files:** ${fileList}${moreFiles}\n\n${trimmed}`;

    const blockLines = block.split("\n").length;
    if (linesUsed + blockLines > totalLinesBudget && parts.length > 0) {
      parts.push(`\n_(${cards.length - i} more cards omitted for brevity)_`);
      break;
    }

    parts.push(block);
    linesUsed += blockLines;
  }

  return parts.join("\n\n---\n\n");
}

export function prioritizeCards(cards: CardSummary[]): CardSummary[] {
  const typeOrder: Record<string, number> = {
    model: 0,
    flow: 1,
    cross_service: 2,
    hub: 3,
    dev_insight: 1,
  };
  return [...cards].sort((a, b) => {
    const oa = typeOrder[a.card_type] ?? 4;
    const ob = typeOrder[b.card_type] ?? 4;
    return oa - ob;
  });
}

// ---------------------------------------------------------------------------
// Repo prefix / semantic query building — loaded fresh per call
// ---------------------------------------------------------------------------

function loadRepoPrefixes(): Record<string, string> {
  try {
    const rows = getDb()
      .prepare("SELECT repo, primary_language, frameworks FROM repo_profiles")
      .all() as { repo: string; primary_language: string; frameworks: string }[];

    const prefixes: Record<string, string> = {};
    for (const row of rows) {
      const frameworks = safeParseJsonArray(row.frameworks);
      const parts = [row.primary_language, ...frameworks].filter(Boolean).join(" ");
      prefixes[row.repo] = `${parts} ${row.repo}: `;
    }
    return prefixes;
  } catch {
    return {};
  }
}

export async function buildSemanticQuery(query: string): Promise<string> {
  try {
    const raw = await getEmbedder().embed(query);
    const cls = classifyQueryEmbedding(raw);
    if (cls.topRepo && cls.confidence > 0.05) {
      const prefixes = loadRepoPrefixes();
      const prefix = prefixes[cls.topRepo];
      if (prefix) return prefix + query;
    }
  } catch { /* non-critical */ }
  return query;
}

export async function buildHydeQuery(description: string): Promise<string> {
  if (description.length <= 200) return buildSemanticQuery(description);

  const llm = createLLMProvider();
  if (!llm) return buildSemanticQuery(description);

  const hydeTimeoutMs = getSearchConfigValue("hyde_timeout_ms", 1500);

  // Note: when the timeout wins the race, the LLM call continues in the
  // background until it completes or errors. AbortController support depends
  // on the LLM provider implementation.
  const hydeCall = (async () => {
    try {
      const hypothetical = await llm.generate(
        `Write a concise technical knowledge card (3\u20135 sentences) that directly answers this developer question about a codebase:\n\n"${description.slice(0, 600)}"\n\nWrite as if describing an existing system. Use technical terms naturally (models, controllers, services, components, associations, routes). Be specific.`,
        { maxTokens: 200, temperature: 0.1 },
      );
      if (hypothetical && hypothetical.trim().length > 20) return hypothetical.trim();
    } catch { /* non-critical */ }
    return null;
  })();

  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), hydeTimeoutMs));
  const result = await Promise.race([hydeCall, timeout]);
  return result ?? buildSemanticQuery(description);
}

// ---------------------------------------------------------------------------
// Graph expansion
// ---------------------------------------------------------------------------

export function expandWithGraphNeighbours(results: SearchResult[]): SearchResult[] {
  if (results.length === 0) return results;

  const db = getDb();
  const top5 = results.slice(0, 5);
  const sourceFiles = new Set<string>();
  for (const r of top5) {
    safeParseJsonArray(r.card.source_files).forEach((f) => sourceFiles.add(f));
  }

  if (sourceFiles.size === 0) return results;

  const fileListJson = JSON.stringify([...sourceFiles]);
  const existingIdsJson = JSON.stringify(results.map((r) => r.card.id));

  const neighbours = db
    .prepare(
      `SELECT DISTINCT c.* FROM cards c
       WHERE c.stale = 0
         AND EXISTS (
           SELECT 1 FROM json_each(c.source_files) sf
           WHERE sf.value IN (
             SELECT ge.target_file FROM graph_edges ge
               WHERE ge.source_file IN (SELECT j.value FROM json_each(?))
             UNION
             SELECT ge.source_file FROM graph_edges ge
               WHERE ge.target_file IN (SELECT j.value FROM json_each(?))
           )
         )
         AND c.id NOT IN (SELECT j.value FROM json_each(?))
       LIMIT 5`,
    )
    .all(fileListJson, fileListJson, existingIdsJson) as Card[];

  return [
    ...results,
    ...neighbours.map((card) => ({ card, score: 0.3, source: "semantic" as const })),
  ];
}

// ---------------------------------------------------------------------------
// Interaction logging — prepared fresh each call to avoid cross-tenant leakage
// ---------------------------------------------------------------------------

export function logViewedInteractions(query: string, cardIds: string[], sessionId: string): void {
  if (cardIds.length === 0) return;
  try {
    const db = getDb();
    const stmt = db.prepare(
      `INSERT INTO card_interactions (query, card_id, outcome, session_id)
       VALUES (?, ?, 'viewed', ?)`,
    );
    const tx = db.transaction(() => {
      for (const id of cardIds) stmt.run(query, id, sessionId);
    });
    tx();
  } catch { /* non-critical */ }
}

// ---------------------------------------------------------------------------
// Core search pipeline
// ---------------------------------------------------------------------------

export async function searchAndTrack(
  query: string,
  branch?: string,
  limit = 5,
  sessionId = randomUUID(),
  devId?: string,
): Promise<{ cards: CardSummary[]; results: SearchResult[]; cardIds: string[]; cacheHit: boolean }> {
  const start = Date.now();

  const cached = await checkCache(query);
  if (cached && cached.length > 0) {
    const cards = cached.map((r) => r.card);
    const elapsed = Date.now() - start;
    const cachedCardIds = cards.map((c) => c.id);
    trackToolCall({
      query,
      responseCards: cachedCardIds,
      responseTokens: cards.reduce((sum, c) => sum + c.content.length / 4, 0),
      cacheHit: true,
      latencyMs: elapsed,
      branch,
      devId,
    });
    logViewedInteractions(query, cachedCardIds, sessionId);
    return { cards, results: cached, cardIds: cachedCardIds, cacheHit: true };
  }

  const semanticQuery = await buildSemanticQuery(query);
  const candidates = await hybridSearch(query, { branch, limit: limit * 4, semanticQuery });
  const expanded = expandWithGraphNeighbours(candidates);
  const results = await crossEncoderRerank(query, expanded, limit);

  const elapsed = Date.now() - start;

  let embedding: Buffer | null = null;
  try {
    const raw = await getEmbedder().embed(query);
    embedding = Buffer.from(raw.buffer);
  } catch { /* non-critical */ }

  const cardIds = results.map((r) => r.card.id);
  trackToolCall({
    query,
    queryEmbedding: embedding,
    responseCards: cardIds,
    responseTokens: results.reduce((sum, r) => sum + r.card.content.length / 4, 0),
    cacheHit: false,
    latencyMs: elapsed,
    branch,
    devId,
  });
  logViewedInteractions(query, cardIds, sessionId);

  return {
    cards: results.map((r) => r.card),
    results,
    cardIds,
    cacheHit: false,
  };
}

// ---------------------------------------------------------------------------
// Recent queries
// ---------------------------------------------------------------------------

export interface RecentQuery {
  query: string;
  matchedCards: number;
  cardTitles: string | null;
  lastAsked: string;
  askCount: number;
}

export function getRecentQueries(limit = 10): RecentQuery[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT
        ci.query,
        COUNT(DISTINCT ci.card_id) AS matchedCards,
        GROUP_CONCAT(DISTINCT c.title) AS cardTitles,
        MAX(ci.timestamp) AS lastAsked,
        COUNT(*) AS askCount
      FROM card_interactions ci
        LEFT JOIN cards c ON c.id = ci.card_id
      GROUP BY ci.query
      ORDER BY lastAsked DESC
      LIMIT ?`,
    )
    .all(limit) as RecentQuery[];
}

// ---------------------------------------------------------------------------
// Entity extraction
// ---------------------------------------------------------------------------

const ENGLISH_STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "ought", "to", "of",
  "in", "for", "on", "with", "at", "by", "from", "as", "into", "through",
  "during", "before", "after", "between", "out", "off", "over", "under",
  "again", "then", "once", "here", "there", "when", "where", "why", "how",
  "all", "each", "every", "both", "few", "more", "most", "other", "some",
  "such", "no", "not", "only", "own", "same", "so", "than", "too", "very",
  "just", "because", "but", "and", "or", "if", "while", "that", "this",
  "these", "those", "it", "its", "we", "they", "them", "their", "i", "you",
  "he", "she", "what", "which", "who", "whom", "also", "get", "like",
  "about", "above", "below", "up", "down",
]);

export function extractEntityNames(text: string): string[] {
  const cleaned = text.replace(/https?:\/\/\S+/g, "");
  const entities: string[] = [];

  const snakeCase = cleaned.match(/[a-z][a-z0-9]*(?:_[a-z0-9]+)+/g) ?? [];
  entities.push(...snakeCase);

  const pascalCase = cleaned.match(/[A-Z][a-z]+(?:[A-Z][a-z]+)+/g) ?? [];
  entities.push(...pascalCase);

  const words = cleaned
    .replace(/[^a-zA-Z0-9_\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !ENGLISH_STOP_WORDS.has(w.toLowerCase()));

  const freq = new Map<string, number>();
  for (const w of words) {
    const lower = w.toLowerCase();
    freq.set(lower, (freq.get(lower) || 0) + 1);
  }

  const topWords = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w]) => w);

  entities.push(...topWords);

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const e of entities) {
    const lower = e.toLowerCase();
    if (!seen.has(lower) && !ENGLISH_STOP_WORDS.has(lower) && e.length > 2) {
      seen.add(lower);
      unique.push(e);
    }
  }

  return unique.slice(0, 5);
}
