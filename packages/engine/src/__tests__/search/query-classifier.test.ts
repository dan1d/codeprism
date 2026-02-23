/**
 * Tests for search/query-classifier.ts — repo centroid loading and query classification.
 *
 * getDb() is mocked so we can seed embeddings without a real file system.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, insertTestCard, type TestDb } from "../helpers/db.js";
import { embeddingToBuffer, makeEmbedding, makeOrthogonalEmbedding } from "../helpers/fixtures.js";

let testDb: TestDb;

vi.mock("../../db/connection.js", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

const {
  getRepoCentroids,
  classifyQueryEmbedding,
  invalidateRepoCentroidsCache,
} = await import("../../search/query-classifier.js");

function insertCardWithEmbedding(
  db: TestDb,
  cardId: string,
  repo: string,
  embedding: Float32Array,
) {
  insertTestCard(db, {
    id: cardId,
    source_repos: JSON.stringify([repo]),
    stale: 0,
  });

  const buf = embeddingToBuffer(embedding);
  db.prepare(
    "INSERT INTO card_embeddings (card_id, embedding) VALUES (?, ?)",
  ).run(cardId, buf);
}

describe("invalidateRepoCentroidsCache", () => {
  beforeEach(() => {
    testDb = createTestDb();
    invalidateRepoCentroidsCache();
  });

  afterEach(() => {
    testDb.close();
    invalidateRepoCentroidsCache();
  });

  it("clears cached centroids so the next call re-queries the DB", () => {
    // Prime the cache with an empty DB
    const firstResult = getRepoCentroids();
    expect(firstResult.size).toBe(0);

    // Insert a card/embedding, then invalidate
    insertCardWithEmbedding(testDb, "c1", "backend", makeEmbedding());
    invalidateRepoCentroidsCache();

    // Now centroid should be loaded
    const secondResult = getRepoCentroids();
    expect(secondResult.size).toBe(1);
    expect(secondResult.has("backend")).toBe(true);
  });
});

describe("getRepoCentroids", () => {
  beforeEach(() => {
    testDb = createTestDb();
    invalidateRepoCentroidsCache();
  });

  afterEach(() => {
    testDb.close();
    invalidateRepoCentroidsCache();
  });

  it("returns empty map when no embeddings exist", () => {
    const centroids = getRepoCentroids();
    expect(centroids.size).toBe(0);
  });

  it("returns one centroid per repo", () => {
    insertCardWithEmbedding(testDb, "c1", "backend", makeEmbedding(768, 1.0));
    insertCardWithEmbedding(testDb, "c2", "frontend", makeEmbedding(768, 0.5));
    invalidateRepoCentroidsCache();

    const centroids = getRepoCentroids();
    expect(centroids.size).toBe(2);
    expect(centroids.has("backend")).toBe(true);
    expect(centroids.has("frontend")).toBe(true);
  });

  it("produces normalised centroid vectors (magnitude ≈ 1)", () => {
    insertCardWithEmbedding(testDb, "c1", "backend", makeEmbedding(768, 2.0));
    insertCardWithEmbedding(testDb, "c2", "backend", makeEmbedding(768, 3.0));
    invalidateRepoCentroidsCache();

    const centroids = getRepoCentroids();
    const centroid = centroids.get("backend")!;

    let norm = 0;
    for (let i = 0; i < centroid.length; i++) norm += centroid[i]! * centroid[i]!;
    expect(Math.sqrt(norm)).toBeCloseTo(1, 2);
  });

  it("skips cards with invalid source_repos JSON (covers catch-continue branch)", () => {
    // Insert a card with invalid JSON — should not throw; card is skipped
    insertTestCard(testDb, { id: "bad-json-card", source_repos: "not-valid-json", stale: 0 });
    testDb
      .prepare("INSERT INTO card_embeddings (card_id, embedding) VALUES (?, ?)")
      .run("bad-json-card", embeddingToBuffer(makeEmbedding()));
    // Also insert a valid card so the result is non-empty
    insertCardWithEmbedding(testDb, "valid-card", "backend", makeEmbedding(768, 1.0));
    invalidateRepoCentroidsCache();

    // Should not throw and should still return the valid card's repo
    const centroids = getRepoCentroids();
    expect(centroids.has("backend")).toBe(true);
  });

  it("excludes stale cards from centroid computation", () => {
    insertTestCard(testDb, {
      id: "stale-card",
      source_repos: '["backend"]',
      stale: 1,
    });
    testDb.prepare("INSERT INTO card_embeddings (card_id, embedding) VALUES (?, ?)").run(
      "stale-card",
      embeddingToBuffer(makeEmbedding()),
    );
    invalidateRepoCentroidsCache();

    const centroids = getRepoCentroids();
    expect(centroids.size).toBe(0);
  });

  it("caches the result on repeated calls", () => {
    insertCardWithEmbedding(testDb, "c1", "backend", makeEmbedding());
    invalidateRepoCentroidsCache();

    const first = getRepoCentroids();
    const second = getRepoCentroids();
    expect(first).toBe(second); // same reference
  });
});

describe("classifyQueryEmbedding", () => {
  beforeEach(() => {
    testDb = createTestDb();
    invalidateRepoCentroidsCache();
  });

  afterEach(() => {
    testDb.close();
    invalidateRepoCentroidsCache();
  });

  it("returns null topRepo when no centroids available", () => {
    const result = classifyQueryEmbedding(makeEmbedding());
    expect(result.topRepo).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.scores.size).toBe(0);
  });

  it("returns the correct top repo for a highly similar query", () => {
    // backend cards are all pointing in the +1 direction
    insertCardWithEmbedding(testDb, "be1", "backend", makeEmbedding(768, 1.0));
    insertCardWithEmbedding(testDb, "be2", "backend", makeEmbedding(768, 1.0));
    // frontend cards are orthogonal (zero similarity to backend query)
    insertCardWithEmbedding(testDb, "fe1", "frontend", makeOrthogonalEmbedding(768));
    invalidateRepoCentroidsCache();

    // A query embedding that aligns with backend
    const queryEmbedding = makeEmbedding(768, 1.0);
    const result = classifyQueryEmbedding(queryEmbedding);

    expect(result.topRepo).toBe("backend");
    expect(result.scores.get("backend")).toBeGreaterThan(0.9);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("provides a score for each repo", () => {
    insertCardWithEmbedding(testDb, "c1", "repo-a", makeEmbedding());
    insertCardWithEmbedding(testDb, "c2", "repo-b", makeEmbedding());
    invalidateRepoCentroidsCache();

    const result = classifyQueryEmbedding(makeEmbedding());
    expect(result.scores.has("repo-a")).toBe(true);
    expect(result.scores.has("repo-b")).toBe(true);
  });

  it("confidence is 1.0 when only one repo exists", () => {
    insertCardWithEmbedding(testDb, "c1", "only-repo", makeEmbedding());
    invalidateRepoCentroidsCache();

    const result = classifyQueryEmbedding(makeEmbedding());
    expect(result.confidence).toBe(1);
  });

  it("handles zero-vector embeddings gracefully (covers mag=0 and denom=0 branches)", () => {
    // A card with all-zero embedding → centroid will be zero → mag=0 → skip normalization
    const zeroEmb = new Float32Array(768).fill(0);  // all zeros
    insertTestCard(testDb, { id: "zero-card", source_repos: '["zero-repo"]', stale: 0 });
    testDb
      .prepare("INSERT INTO card_embeddings (card_id, embedding) VALUES (?, ?)")
      .run("zero-card", Buffer.from(zeroEmb.buffer));
    invalidateRepoCentroidsCache();

    // getRepoCentroids should handle mag=0 without throwing (covers if (mag > 0) false branch)
    const centroids = getRepoCentroids();
    // Even if zero-repo centroid exists, classifyQueryEmbedding covers denom=0 in cosine
    const result = classifyQueryEmbedding(makeEmbedding());
    expect(result).toBeDefined();
    expect(typeof result.confidence).toBe("number");
  });
});
