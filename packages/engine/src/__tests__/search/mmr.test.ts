/**
 * Tests for mmr.ts — Maximal Marginal Relevance reranking.
 *
 * Strategy: mock `getDb()` to return an in-memory SQLite with card_embeddings
 * populated so we can control the embedding space precisely.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db.js";
import {
  makeCard,
  makeSearchResult,
  makeEmbedding,
  makeOrthogonalEmbedding,
  embeddingToBuffer,
} from "../helpers/fixtures.js";

// Mock the DB connection module so mmrRerank uses our in-memory DB.
let testDb: TestDb;
vi.mock("../../db/connection.js", () => ({
  getDb: () => testDb,
  closeDb: () => {
    if (testDb) testDb.close();
  },
}));

// Import AFTER mock is set up
const { mmrRerank } = await import("../../search/mmr.js");

const DIM = 768;

function insertEmbedding(db: TestDb, cardId: string, emb: Float32Array): void {
  db.prepare("INSERT INTO card_embeddings (card_id, embedding) VALUES (?, ?)").run(
    cardId,
    embeddingToBuffer(emb),
  );
}

describe("mmrRerank", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  it("returns results unchanged when count ≤ topK", () => {
    const cards = [makeCard(), makeCard(), makeCard()];
    const results = cards.map((c) => makeSearchResult(c, 0.9));

    const out = mmrRerank(results, 5);
    expect(out).toHaveLength(3);
    expect(out).toEqual(results);
  });

  it("returns empty array for empty input", () => {
    expect(mmrRerank([], 5)).toEqual([]);
  });

  it("selects top-K from results when no embeddings are available", () => {
    // No embeddings in DB → all maxSim = 0, falls back to pure relevance ordering
    const cards = [makeCard(), makeCard(), makeCard(), makeCard(), makeCard()];
    const scores = [0.9, 0.8, 0.7, 0.6, 0.5];
    const results = cards.map((c, i) => makeSearchResult(c, scores[i]!));

    const out = mmrRerank(results, 3);
    expect(out).toHaveLength(3);
    // Highest relevance should still be selected first (no diversity penalty)
    expect(out[0]?.card.id).toBe(cards[0]?.id);
  });

  it("top card by relevance wins when embeddings are orthogonal (no redundancy)", () => {
    const cardA = makeCard({ id: "card-a", title: "Card A" });
    const cardB = makeCard({ id: "card-b", title: "Card B" });
    const cardC = makeCard({ id: "card-c", title: "Card C" });

    insertEmbedding(testDb, "card-a", makeEmbedding(DIM, 1.0));
    insertEmbedding(testDb, "card-b", makeOrthogonalEmbedding(DIM));
    insertEmbedding(testDb, "card-c", makeEmbedding(DIM, -1.0));

    const results = [
      makeSearchResult(cardA, 0.9, "semantic"),
      makeSearchResult(cardB, 0.6, "semantic"),
      makeSearchResult(cardC, 0.3, "semantic"),
    ];

    const out = mmrRerank(results, 2);
    expect(out).toHaveLength(2);
    expect(out[0]?.card.id).toBe("card-a"); // highest relevance wins first
  });

  it("penalizes duplicate embeddings — only first of two identical cards selected", () => {
    const cardA = makeCard({ id: "card-dupe-a", title: "Original" });
    const cardB = makeCard({ id: "card-dupe-b", title: "Duplicate" });

    // Both have identical embeddings → cosine similarity = 1.0
    const sharedEmb = makeEmbedding(DIM, 1.0);
    insertEmbedding(testDb, "card-dupe-a", sharedEmb);
    insertEmbedding(testDb, "card-dupe-b", sharedEmb);

    const results = [
      makeSearchResult(cardA, 1.0, "semantic"),
      makeSearchResult(cardB, 0.99, "semantic"),
    ];

    // Both results, topK=2 → passthrough (len ≤ topK)
    // Need topK=1 to test the penalty
    const out = mmrRerank(results, 1);
    expect(out).toHaveLength(1);
    expect(out[0]?.card.id).toBe("card-dupe-a"); // highest relevance first
  });

  it("returns exactly topK items", () => {
    const cards = Array.from({ length: 10 }, (_, i) =>
      makeCard({ id: `card-${i}` }),
    );
    const results = cards.map((c, i) =>
      makeSearchResult(c, 1 - i * 0.05, "semantic"),
    );

    const out = mmrRerank(results, 5);
    expect(out).toHaveLength(5);
  });
});
