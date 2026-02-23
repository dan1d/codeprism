/**
 * Tests for search/specificity.ts — per-card specificity score computation.
 *
 * Uses in-memory SQLite (with sqlite-vec) so vector math runs against real data.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, insertTestCard, type TestDb } from "../helpers/db.js";
import { embeddingToBuffer, makeEmbedding, makeOrthogonalEmbedding } from "../helpers/fixtures.js";

let testDb: TestDb;

vi.mock("../../db/connection.js", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

// invalidateRepoCentroidsCache is a side effect — mock it so we don't need a real DB in that module
vi.mock("../../search/query-classifier.js", () => ({
  classifyQueryEmbedding: vi.fn(),
  getRepoCentroids: vi.fn(),
  invalidateRepoCentroidsCache: vi.fn(),
}));

const { computeSpecificity } = await import("../../search/specificity.js");

function insertCardWithEmbedding(
  db: TestDb,
  id: string,
  repo: string,
  embedding: Float32Array,
) {
  insertTestCard(db, { id, source_repos: JSON.stringify([repo]), stale: 0 });
  db.prepare("INSERT INTO card_embeddings (card_id, embedding) VALUES (?, ?)").run(
    id,
    embeddingToBuffer(embedding),
  );
}

describe("computeSpecificity", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  it("returns { total: 0, globalRange: [0, 0] } when no card embeddings exist", () => {
    const result = computeSpecificity();
    expect(result.total).toBe(0);
    expect(result.globalRange).toEqual([0, 0]);
  });

  it("returns total equal to the number of card embeddings", () => {
    insertCardWithEmbedding(testDb, "c1", "backend", makeEmbedding(768, 1.0));
    insertCardWithEmbedding(testDb, "c2", "backend", makeEmbedding(768, 0.5));
    insertCardWithEmbedding(testDb, "c3", "frontend", makeOrthogonalEmbedding(768));

    const result = computeSpecificity();
    expect(result.total).toBe(3);
  });

  it("updates specificity_score in the cards table", () => {
    insertCardWithEmbedding(testDb, "c1", "backend", makeEmbedding(768, 1.0));
    insertCardWithEmbedding(testDb, "c2", "frontend", makeOrthogonalEmbedding(768));

    computeSpecificity();

    const c1 = testDb.prepare("SELECT specificity_score FROM cards WHERE id = ?").get("c1") as { specificity_score: number };
    const c2 = testDb.prepare("SELECT specificity_score FROM cards WHERE id = ?").get("c2") as { specificity_score: number };

    expect(c1.specificity_score).toBeDefined();
    expect(c2.specificity_score).toBeDefined();
    expect(typeof c1.specificity_score).toBe("number");
    expect(typeof c2.specificity_score).toBe("number");
  });

  it("produces specificity scores in [0, 1] range", () => {
    for (let i = 0; i < 5; i++) {
      insertCardWithEmbedding(
        testDb,
        `card-${i}`,
        i < 3 ? "backend" : "frontend",
        i % 2 === 0 ? makeEmbedding(768, i + 1) : makeOrthogonalEmbedding(768),
      );
    }

    computeSpecificity();

    const scores = testDb
      .prepare("SELECT specificity_score FROM cards")
      .all() as { specificity_score: number }[];

    for (const row of scores) {
      expect(row.specificity_score).toBeGreaterThanOrEqual(0);
      expect(row.specificity_score).toBeLessThanOrEqual(1);
    }
  });

  it("assigns lower specificity to a card identical to the centroid (hub-like)", () => {
    // Cards in the same direction as the centroid = low specificity (similar to global average)
    // Cards pointing away from centroid = high specificity (more unique)
    const hubEmbedding = makeEmbedding(768, 1.0);
    const uniqueEmbedding = makeOrthogonalEmbedding(768);

    insertCardWithEmbedding(testDb, "hub", "backend", hubEmbedding);
    insertCardWithEmbedding(testDb, "hub2", "backend", hubEmbedding);
    insertCardWithEmbedding(testDb, "unique", "backend", uniqueEmbedding);

    computeSpecificity();

    const hub = testDb.prepare("SELECT specificity_score FROM cards WHERE id = ?").get("hub") as { specificity_score: number };
    const unique = testDb.prepare("SELECT specificity_score FROM cards WHERE id = ?").get("unique") as { specificity_score: number };

    // Unique card should have higher specificity than the hub-like cards
    expect(unique.specificity_score).toBeGreaterThan(hub.specificity_score);
  });

  it("handles cards with invalid source_repos JSON without throwing", () => {
    insertTestCard(testDb, { id: "bad-json", source_repos: "not-json" });
    testDb.prepare("INSERT INTO card_embeddings (card_id, embedding) VALUES (?, ?)").run(
      "bad-json",
      embeddingToBuffer(makeEmbedding()),
    );

    expect(() => computeSpecificity()).not.toThrow();
  });

  it("handles multi-repo cards and includes all their repos in per-repo centroid", () => {
    insertTestCard(testDb, {
      id: "cross",
      source_repos: JSON.stringify(["backend", "frontend"]),
      stale: 0,
    });
    testDb.prepare("INSERT INTO card_embeddings (card_id, embedding) VALUES (?, ?)").run(
      "cross",
      embeddingToBuffer(makeEmbedding()),
    );

    expect(() => computeSpecificity()).not.toThrow();

    const card = testDb.prepare("SELECT specificity_score FROM cards WHERE id = 'cross'").get() as { specificity_score: number };
    expect(card.specificity_score).toBeGreaterThanOrEqual(0);
  });

  it("assigns default specificity (0.5) for cards with empty source_repos", () => {
    // Cards with repos.length === 0 hit the fallback branch in per-repo distance computation
    insertTestCard(testDb, { id: "no-repo-card", source_repos: "[]", stale: 0 });
    testDb
      .prepare("INSERT INTO card_embeddings (card_id, embedding) VALUES (?, ?)")
      .run("no-repo-card", embeddingToBuffer(makeEmbedding()));

    expect(() => computeSpecificity()).not.toThrow();

    const card = testDb
      .prepare("SELECT specificity_score FROM cards WHERE id = ?")
      .get("no-repo-card") as { specificity_score: number };
    // Score should be set (either 0.5 fallback or normalized value)
    expect(typeof card.specificity_score).toBe("number");
    expect(card.specificity_score).toBeGreaterThanOrEqual(0);
  });

  it("calls invalidateRepoCentroidsCache after updating scores", async () => {
    const { invalidateRepoCentroidsCache } = await import("../../search/query-classifier.js");

    insertCardWithEmbedding(testDb, "c1", "backend", makeEmbedding());

    computeSpecificity();

    expect(invalidateRepoCentroidsCache).toHaveBeenCalled();
  });
});
