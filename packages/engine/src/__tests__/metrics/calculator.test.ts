/**
 * Tests for metrics/calculator.ts — aggregate metrics computation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, insertTestCard, type TestDb } from "../helpers/db.js";

let testDb: TestDb;

vi.mock("../../db/connection.js", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

const { calculateMetrics } = await import("../../metrics/calculator.js");

function insertMetric(
  db: TestDb,
  opts: {
    query?: string;
    cacheHit?: boolean;
    latencyMs?: number;
    branch?: string;
    devId?: string;
    timestamp?: string;
  } = {},
) {
  db.prepare(
    `INSERT INTO metrics (query, response_cards, response_tokens, cache_hit, latency_ms, branch, dev_id, timestamp)
     VALUES (?, '[]', 100, ?, ?, ?, ?, ?)`,
  ).run(
    opts.query ?? "test query",
    opts.cacheHit ? 1 : 0,
    opts.latencyMs ?? 50,
    opts.branch ?? null,
    opts.devId ?? null,
    opts.timestamp ?? new Date().toISOString(),
  );
}

describe("calculateMetrics", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  it("returns zero counts on empty DB", () => {
    const summary = calculateMetrics();
    expect(summary.totalQueries).toBe(0);
    expect(summary.cacheHits).toBe(0);
    expect(summary.cacheHitRate).toBe(0);
    expect(summary.totalCards).toBe(0);
    expect(summary.totalFlows).toBe(0);
    expect(summary.staleCards).toBe(0);
    expect(summary.estimatedTokensSaved).toBe(0);
    expect(summary.estimatedCostSaved).toBe(0);
  });

  it("counts total queries correctly", () => {
    insertMetric(testDb, { query: "alpha" });
    insertMetric(testDb, { query: "beta" });
    insertMetric(testDb, { query: "gamma" });

    const summary = calculateMetrics();
    expect(summary.totalQueries).toBe(3);
  });

  it("calculates cache hit rate accurately", () => {
    insertMetric(testDb, { cacheHit: true });
    insertMetric(testDb, { cacheHit: true });
    insertMetric(testDb, { cacheHit: false });
    insertMetric(testDb, { cacheHit: false });

    const summary = calculateMetrics();
    expect(summary.cacheHits).toBe(2);
    expect(summary.cacheHitRate).toBeCloseTo(0.5);
  });

  it("estimates tokens saved from cache hits", () => {
    insertMetric(testDb, { cacheHit: true });
    insertMetric(testDb, { cacheHit: true });

    const summary = calculateMetrics();
    // AVG_TOKENS_PER_CACHE_HIT = 5000, 2 hits = 10000 tokens
    expect(summary.estimatedTokensSaved).toBe(10000);
    expect(summary.estimatedCostSaved).toBeGreaterThan(0);
  });

  it("counts cards, flows and stale cards from cards table", () => {
    insertTestCard(testDb, { flow: "billing", stale: 0 });
    insertTestCard(testDb, { flow: "billing", stale: 0 });
    insertTestCard(testDb, { flow: "patient", stale: 1 });

    const summary = calculateMetrics();
    expect(summary.totalCards).toBe(3);
    expect(summary.totalFlows).toBe(2);
    expect(summary.staleCards).toBe(1);
  });

  it("returns topQueries sorted by count descending", () => {
    insertMetric(testDb, { query: "billing" });
    insertMetric(testDb, { query: "billing" });
    insertMetric(testDb, { query: "patient" });

    const summary = calculateMetrics();
    expect(summary.topQueries[0]?.query).toBe("billing");
    expect(summary.topQueries[0]?.count).toBe(2);
    expect(summary.topQueries[1]?.query).toBe("patient");
  });

  it("returns topCards sorted by usage_count descending", () => {
    insertTestCard(testDb, { id: "low", flow: "f1", usage_count: 1 });
    insertTestCard(testDb, { id: "high", flow: "f2", usage_count: 99 });

    const summary = calculateMetrics();
    expect(summary.topCards[0]?.cardId).toBe("high");
    expect(summary.topCards[1]?.cardId).toBe("low");
  });

  it("returns devStats grouped by devId", () => {
    insertMetric(testDb, { devId: "alice", cacheHit: true });
    insertMetric(testDb, { devId: "alice", cacheHit: false });
    insertMetric(testDb, { devId: "bob", cacheHit: false });

    const summary = calculateMetrics();
    const alice = summary.devStats.find((d) => d.devId === "alice");
    const bob = summary.devStats.find((d) => d.devId === "bob");

    expect(alice?.queries).toBe(2);
    expect(alice?.cacheHits).toBe(1);
    expect(bob?.queries).toBe(1);
    expect(bob?.cacheHits).toBe(0);
  });

  it("respects period.from filter", () => {
    const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    insertMetric(testDb, { query: "old", timestamp: past });
    insertMetric(testDb, { query: "new" });

    const summary = calculateMetrics({ from: new Date().toISOString() });
    expect(summary.totalQueries).toBe(1);

    const all = calculateMetrics({ from: past, to: future });
    expect(all.totalQueries).toBe(2);
  });

  it("returns queriesByDay with one entry per day", () => {
    insertMetric(testDb, { query: "a", cacheHit: false });
    insertMetric(testDb, { query: "b", cacheHit: true });

    const summary = calculateMetrics();
    expect(summary.queriesByDay.length).toBeGreaterThanOrEqual(1);
    const today = summary.queriesByDay[0]!;
    expect(today.total).toBeGreaterThanOrEqual(2);
  });
});
