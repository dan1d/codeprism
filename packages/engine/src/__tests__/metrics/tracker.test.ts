/**
 * Tests for metrics/tracker.ts — tool call logging and recent query retrieval.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db.js";

let testDb: TestDb;

vi.mock("../../db/connection.js", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

const { trackToolCall, getRecentQueries } = await import("../../metrics/tracker.js");

describe("trackToolCall", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  it("inserts a metric row with correct values", () => {
    trackToolCall({
      query: "patient list",
      responseCards: ["card-1", "card-2"],
      responseTokens: 1200,
      cacheHit: false,
      latencyMs: 42,
      branch: "main",
      devId: "dev-abc",
    });

    const row = testDb
      .prepare("SELECT * FROM metrics WHERE query = 'patient list'")
      .get() as {
      query: string;
      response_tokens: number;
      cache_hit: number;
      latency_ms: number;
      branch: string;
      dev_id: string;
      response_cards: string;
    };

    expect(row).toBeDefined();
    expect(row.query).toBe("patient list");
    expect(row.response_tokens).toBe(1200);
    expect(row.cache_hit).toBe(0);
    expect(row.latency_ms).toBe(42);
    expect(row.branch).toBe("main");
    expect(row.dev_id).toBe("dev-abc");
    expect(JSON.parse(row.response_cards)).toEqual(["card-1", "card-2"]);
  });

  it("stores cache_hit=1 correctly", () => {
    trackToolCall({
      query: "cached query",
      responseCards: [],
      responseTokens: 0,
      cacheHit: true,
      latencyMs: 1,
    });

    const row = testDb
      .prepare("SELECT cache_hit FROM metrics WHERE query = 'cached query'")
      .get() as { cache_hit: number };

    expect(row.cache_hit).toBe(1);
  });

  it("allows null branch and devId", () => {
    trackToolCall({
      query: "anon query",
      responseCards: [],
      responseTokens: 100,
      cacheHit: false,
      latencyMs: 10,
    });

    const row = testDb
      .prepare("SELECT branch, dev_id FROM metrics WHERE query = 'anon query'")
      .get() as { branch: null; dev_id: null };

    expect(row.branch).toBeNull();
    expect(row.dev_id).toBeNull();
  });

  it("stores queryEmbedding buffer when provided", () => {
    const embeddingBuf = Buffer.from(new Float32Array(4).fill(0.5).buffer);

    trackToolCall({
      query: "embedded query",
      queryEmbedding: embeddingBuf,
      responseCards: [],
      responseTokens: 0,
      cacheHit: false,
      latencyMs: 5,
    });

    const row = testDb
      .prepare("SELECT query_embedding FROM metrics WHERE query = 'embedded query'")
      .get() as { query_embedding: Buffer | null };

    expect(row.query_embedding).toBeDefined();
    expect(row.query_embedding).not.toBeNull();
  });
});

describe("getRecentQueries", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  it("returns empty array when no metrics exist", () => {
    expect(getRecentQueries()).toEqual([]);
  });

  it("returns queries ordered newest-first", () => {
    testDb
      .prepare(
        `INSERT INTO metrics (query, response_cards, response_tokens, cache_hit, latency_ms, timestamp)
         VALUES (?, '[]', 0, 0, 1, ?)`,
      )
      .run("first query", "2025-01-01T00:00:00.000Z");

    testDb
      .prepare(
        `INSERT INTO metrics (query, response_cards, response_tokens, cache_hit, latency_ms, timestamp)
         VALUES (?, '[]', 0, 0, 1, ?)`,
      )
      .run("second query", "2025-06-01T00:00:00.000Z");

    const results = getRecentQueries(10);
    expect(results[0]?.query).toBe("second query");
    expect(results[1]?.query).toBe("first query");
  });

  it("respects the limit parameter", () => {
    for (let i = 0; i < 5; i++) {
      trackToolCall({
        query: `query-${i}`,
        responseCards: [],
        responseTokens: 0,
        cacheHit: false,
        latencyMs: 1,
      });
    }

    const results = getRecentQueries(3);
    expect(results).toHaveLength(3);
  });

  it("includes timestamp on each result", () => {
    trackToolCall({
      query: "timestamped",
      responseCards: [],
      responseTokens: 0,
      cacheHit: false,
      latencyMs: 1,
    });

    const results = getRecentQueries(1);
    expect(results[0]?.timestamp).toBeDefined();
    expect(typeof results[0]?.timestamp).toBe("string");
  });
});
