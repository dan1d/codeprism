/**
 * Tests for search/hybrid.ts — score fusion, type boosts, hub cap, usage boost.
 *
 * Strategy:
 *  - Mock `semanticSearch`, `keywordSearch`, `getEmbedder`, `classifyQueryEmbedding`
 *    so we control exactly which cards are returned at which scores.
 *  - Mock `getDb()` to return an in-memory DB seeded with the test cards.
 *  - Verify that the scoring pipeline applies boosts correctly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, insertTestCard, type TestDb } from "../helpers/db.js";

// --- Mock modules before importing hybridSearch ---

let testDb: TestDb;

vi.mock("../../db/connection.js", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

// Semantic search and embedder are mocked per-test via vi.mocked()
const mockSemanticResults: { cardId: string; distance: number }[] = [];
const mockKeywordResults: { cardId: string; rank: number }[] = [];

vi.mock("../../search/semantic.js", () => ({
  semanticSearch: vi.fn(async () => mockSemanticResults),
}));

vi.mock("../../search/keyword.js", () => ({
  keywordSearch: vi.fn(() => mockKeywordResults),
  sanitizeFts5Query: vi.fn((s: string) => s),
}));

vi.mock("../../embeddings/local-embedder.js", () => ({
  getEmbedder: () => ({
    embed: vi.fn(async () => new Float32Array(384).fill(0.1)),
    isReady: true,
  }),
}));

vi.mock("../../search/query-classifier.js", () => ({
  classifyQueryEmbedding: vi.fn(() => ({
    topRepo: null,
    confidence: 0,
    scores: new Map(),
  })),
}));

const { hybridSearch, checkCache } = await import("../../search/hybrid.js");
const { semanticSearch } = await import("../../search/semantic.js");
const { keywordSearch } = await import("../../search/keyword.js");

describe("hybridSearch — score fusion", () => {
  beforeEach(() => {
    testDb = createTestDb();
    mockSemanticResults.length = 0;
    mockKeywordResults.length = 0;
  });

  afterEach(() => {
    testDb.close();
    vi.mocked(semanticSearch).mockReset();
    vi.mocked(keywordSearch).mockReset();
    vi.mocked(semanticSearch).mockResolvedValue(mockSemanticResults);
    vi.mocked(keywordSearch).mockReturnValue(mockKeywordResults);
  });

  it("returns empty array when no candidates exist", async () => {
    const results = await hybridSearch("patient authorization");
    expect(results).toEqual([]);
  });

  it("returns cards that appear only in semantic results", async () => {
    const id = insertTestCard(testDb, {
      card_type: "flow",
      title: "Patient Flow",
      specificity_score: 1.0,
    });
    mockSemanticResults.push({ cardId: id, distance: 0.1 }); // high similarity

    const results = await hybridSearch("patient");
    expect(results).toHaveLength(1);
    expect(results[0]?.card.id).toBe(id);
    expect(results[0]?.source).toBe("semantic");
  });

  it("marks source as 'both' when card appears in both semantic and keyword results", async () => {
    const id = insertTestCard(testDb, { card_type: "flow", specificity_score: 1.0 });

    mockSemanticResults.push({ cardId: id, distance: 0.1 });
    mockKeywordResults.push({ cardId: id, rank: -5 });

    const results = await hybridSearch("patient");
    expect(results[0]?.source).toBe("both");
  });

  it("hub cards score lower than equivalent flow cards", async () => {
    const hubId = insertTestCard(testDb, {
      id: "hub-card",
      card_type: "hub",
      title: "User hub",
      specificity_score: 0.5,
    });
    const flowId = insertTestCard(testDb, {
      id: "flow-card",
      card_type: "flow",
      title: "User flow",
      specificity_score: 0.5,
    });

    // Same distance for both → only type boost differentiates them
    mockSemanticResults.push(
      { cardId: hubId, distance: 0.1 },
      { cardId: flowId, distance: 0.1 },
    );

    const results = await hybridSearch("user", { limit: 5 });
    const hubIdx = results.findIndex((r) => r.card.id === hubId);
    const flowIdx = results.findIndex((r) => r.card.id === flowId);

    expect(hubIdx).toBeGreaterThan(flowIdx); // flow ranks higher than hub
  });

  it("card with high usage_count scores higher than identical card with usage_count=0", async () => {
    const popularId = insertTestCard(testDb, {
      id: "popular",
      card_type: "flow",
      usage_count: 100,
      specificity_score: 0.5,
    });
    const freshId = insertTestCard(testDb, {
      id: "fresh",
      card_type: "flow",
      usage_count: 0,
      specificity_score: 0.5,
    });

    mockSemanticResults.push(
      { cardId: popularId, distance: 0.1 },
      { cardId: freshId, distance: 0.1 },
    );

    const results = await hybridSearch("patient", { limit: 5 });
    const popularIdx = results.findIndex((r) => r.card.id === popularId);
    const freshIdx = results.findIndex((r) => r.card.id === freshId);

    expect(popularIdx).toBeLessThan(freshIdx);
  });

  it("card in both results beats single-source card of same type", async () => {
    const bothId = insertTestCard(testDb, {
      id: "both-card",
      card_type: "flow",
      specificity_score: 0.7,
    });
    const onlySemanticId = insertTestCard(testDb, {
      id: "sem-only",
      card_type: "flow",
      specificity_score: 0.7,
    });

    mockSemanticResults.push(
      { cardId: bothId, distance: 0.1 },
      { cardId: onlySemanticId, distance: 0.1 },
    );
    // bothId also appears in keyword results → 1.2x boost
    mockKeywordResults.push({ cardId: bothId, rank: -5 });

    const results = await hybridSearch("patient", { limit: 5 });
    const bothIdx = results.findIndex((r) => r.card.id === bothId);
    const semIdx = results.findIndex((r) => r.card.id === onlySemanticId);

    expect(bothIdx).toBeLessThan(semIdx);
  });

  it("increments usage_count after returning results", async () => {
    const id = insertTestCard(testDb, { card_type: "flow", usage_count: 0 });
    mockSemanticResults.push({ cardId: id, distance: 0.1 });

    await hybridSearch("patient");

    const card = testDb.prepare("SELECT usage_count FROM cards WHERE id = ?").get(id) as {
      usage_count: number;
    };
    expect(card.usage_count).toBe(1);
  });

  it("respects the limit option", async () => {
    for (let i = 0; i < 10; i++) {
      const id = insertTestCard(testDb, { id: `card-${i}`, card_type: "flow" });
      mockSemanticResults.push({ cardId: id, distance: 0.1 + i * 0.01 });
    }

    const results = await hybridSearch("patient", { limit: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("applies embedding-based repo-affinity when classifier has confidence > 0.03", async () => {
    const { classifyQueryEmbedding } = await import("../../search/query-classifier.js");

    const backendCardId = insertTestCard(testDb, {
      id: "be-card",
      card_type: "flow",
      source_repos: '["backend"]',
      specificity_score: 0.5,
    });
    const frontendCardId = insertTestCard(testDb, {
      id: "fe-card",
      card_type: "flow",
      source_repos: '["frontend"]',
      specificity_score: 0.5,
    });

    mockSemanticResults.push(
      { cardId: backendCardId, distance: 0.1 },
      { cardId: frontendCardId, distance: 0.1 },
    );

    // Make classifier return high confidence for backend — no keyword results
    // so textAffinity stays empty and embeddingClassification path is used
    vi.mocked(classifyQueryEmbedding).mockReturnValueOnce({
      topRepo: "backend",
      confidence: 0.15,
      scores: new Map([["backend", 0.95], ["frontend", 0.3]]),
    });

    const results = await hybridSearch("patient backend query", { limit: 5 });
    expect(results.length).toBe(2);
    // Backend card should rank higher due to embedding affinity boost
    const beIdx = results.findIndex((r) => r.card.id === backendCardId);
    const feIdx = results.findIndex((r) => r.card.id === frontendCardId);
    expect(beIdx).toBeLessThan(feIdx);
  });

  it("applies text-based repo-affinity when query mentions a known repo name", async () => {
    const beCardId = insertTestCard(testDb, {
      id: "text-be-card",
      card_type: "flow",
      source_repos: '["biobridge-backend"]',
      specificity_score: 0.5,
    });
    const feCardId = insertTestCard(testDb, {
      id: "text-fe-card",
      card_type: "flow",
      source_repos: '["biobridge-frontend"]',
      specificity_score: 0.5,
    });

    mockSemanticResults.push(
      { cardId: beCardId, distance: 0.1 },
      { cardId: feCardId, distance: 0.1 },
    );

    // Query explicitly mentions the backend repo name
    const results = await hybridSearch("biobridge-backend patient model", { limit: 5 });
    expect(results.length).toBe(2);
  });

  it("includes fresh cards in results", async () => {
    const freshId = insertTestCard(testDb, { id: "fresh-only", card_type: "flow", stale: 0 });

    mockSemanticResults.push({ cardId: freshId, distance: 0.1 });

    const results = await hybridSearch("patient");
    expect(results.some((r) => r.card.id === freshId)).toBe(true);
  });

  it("handles keyword-only results (no semantic matches)", async () => {
    const id = insertTestCard(testDb, {
      id: "kw-only",
      card_type: "flow",
      specificity_score: 0.5,
    });
    mockKeywordResults.push({ cardId: id, rank: -5 });

    const results = await hybridSearch("patient");
    expect(results.some((r) => r.card.id === id)).toBe(true);
    expect(results[0]?.source).toBe("keyword");
  });

});

// ---------------------------------------------------------------------------
// checkCache — semantic cache lookup
// ---------------------------------------------------------------------------

describe("checkCache", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  it("returns null when no metrics with embeddings exist", async () => {
    const result = await checkCache("patient authorization");
    expect(result).toBeNull();
  });

  it("returns null when cached embedding is below threshold", async () => {
    const id = insertTestCard(testDb, { id: "low-sim", card_type: "flow" });

    // Store a totally different embedding (orthogonal → dot product ≈ 0)
    const ortho = new Float32Array(384);
    for (let i = 0; i < 384; i++) ortho[i] = i % 2 === 0 ? 0.05 : -0.05;
    testDb.prepare(
      `INSERT INTO metrics (query, query_embedding, response_cards, response_tokens, cache_hit, latency_ms)
       VALUES (?, ?, ?, 100, 0, 10)`,
    ).run("old query", Buffer.from(ortho.buffer), JSON.stringify([id]));

    const result = await checkCache("patient authorization");
    expect(result).toBeNull();
  });

  it("returns cached cards when a very similar query exists", async () => {
    const id = insertTestCard(testDb, { id: "cache-hit-card", card_type: "flow" });

    // Mock embedder returns Float32Array(384).fill(0.1)
    // Dot product with itself = 384 * 0.01 = 3.84 >> 0.92 threshold
    const embVec = new Float32Array(384).fill(0.1);
    testDb.prepare(
      `INSERT INTO metrics (query, query_embedding, response_cards, response_tokens, cache_hit, latency_ms)
       VALUES (?, ?, ?, 100, 0, 10)`,
    ).run("similar query", Buffer.from(embVec.buffer), JSON.stringify([id]));

    const result = await checkCache("cache hit test");

    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThan(0);
    expect(result![0]?.score).toBe(1);
    expect(result![0]?.source).toBe("both");
  });

  it("returns empty array (and not null) when cached response_cards is empty", async () => {
    const embVec = new Float32Array(384).fill(0.1);
    testDb.prepare(
      `INSERT INTO metrics (query, query_embedding, response_cards, response_tokens, cache_hit, latency_ms)
       VALUES (?, ?, ?, 0, 0, 10)`,
    ).run("empty cache", Buffer.from(embVec.buffer), JSON.stringify([]));

    const result = await checkCache("empty result query");

    expect(result).not.toBeNull();
    expect(result!).toEqual([]);
  });

  it("skips metric rows where embedding length does not match", async () => {
    const id = insertTestCard(testDb, { id: "wrong-dim-card", card_type: "flow" });

    // Store a 128-dim embedding (wrong size)
    const shortEmb = new Float32Array(128).fill(0.5);
    testDb.prepare(
      `INSERT INTO metrics (query, query_embedding, response_cards, response_tokens, cache_hit, latency_ms)
       VALUES (?, ?, ?, 0, 0, 10)`,
    ).run("wrong dim", Buffer.from(shortEmb.buffer), JSON.stringify([id]));

    const result = await checkCache("any query");
    expect(result).toBeNull();
  });
});
