import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, insertTestCard, type TestDb } from "../helpers/db.js";

let testDb: TestDb;

vi.mock("../../db/connection.js", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("../../search/hybrid.js", () => ({
  hybridSearch: vi.fn().mockResolvedValue([]),
  checkCache: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../search/reranker.js", () => ({
  rerankResults: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../embeddings/local-embedder.js", () => ({
  getEmbedder: () => ({ embed: vi.fn().mockResolvedValue(new Float32Array(384)) }),
}));

vi.mock("../../search/query-classifier.js", () => ({
  classifyQueryEmbedding: () => ({ topRepo: null, confidence: 0 }),
}));

vi.mock("../../metrics/tracker.js", () => ({
  trackToolCall: vi.fn(),
}));

vi.mock("../../llm/provider.js", () => ({
  createLLMProvider: () => null,
}));

describe("mcp/tools/search — via service functions", () => {
  beforeEach(() => { testDb = createTestDb(); });
  afterEach(() => { testDb.close(); });

  describe("logViewedInteractions", () => {
    it("logs viewed interactions to card_interactions table", async () => {
      const { logViewedInteractions } = await import("../../services/search.js");

      insertTestCard(testDb, { id: "c1", title: "Test" });
      logViewedInteractions("test query", ["c1"], "sess-1");

      const rows = testDb.prepare("SELECT * FROM card_interactions").all() as Array<{
        query: string; card_id: string; outcome: string; session_id: string;
      }>;

      expect(rows).toHaveLength(1);
      expect(rows[0]!.query).toBe("test query");
      expect(rows[0]!.card_id).toBe("c1");
      expect(rows[0]!.outcome).toBe("viewed");
    });

    it("handles empty card IDs gracefully", async () => {
      const { logViewedInteractions } = await import("../../services/search.js");
      logViewedInteractions("test", [], "sess-1");

      const rows = testDb.prepare("SELECT * FROM card_interactions").all();
      expect(rows).toHaveLength(0);
    });
  });

  describe("ticket_files scoring logic", () => {
    it("file scoring accumulates across results", () => {
      const fileScores = new Map<string, number>();

      const mockResults = [
        { score: 0.9, files: ["src/auth.ts", "src/user.ts"] },
        { score: 0.7, files: ["src/auth.ts", "src/session.ts"] },
      ];

      for (const r of mockResults) {
        for (const f of r.files) {
          fileScores.set(f, (fileScores.get(f) || 0) + r.score);
        }
      }

      const sorted = [...fileScores.entries()].sort((a, b) => b[1] - a[1]);
      expect(sorted[0]![0]).toBe("src/auth.ts");
      expect(sorted[0]![1]).toBeCloseTo(1.6);
    });
  });

  describe("entity extraction", () => {
    it("extracts entities from natural language text", async () => {
      const { extractEntityNames } = await import("../../services/search.js");

      const entities = extractEntityNames("Fix the UserProfile component in the patient_records module");
      expect(entities).toContain("UserProfile");
      expect(entities).toContain("patient_records");
    });
  });

  describe("getRecentQueries", () => {
    it("returns recent queries with card titles", async () => {
      const { getRecentQueries } = await import("../../services/search.js");

      insertTestCard(testDb, { id: "c1", title: "Auth Card" });
      testDb.prepare(
        `INSERT INTO card_interactions (query, card_id, outcome, session_id)
         VALUES (?, ?, 'viewed', 'sess1')`,
      ).run("auth flow", "c1");

      const recent = getRecentQueries(5);
      expect(recent).toHaveLength(1);
      expect(recent[0]!.query).toBe("auth flow");
    });
  });

  describe("safeParseJsonArray", () => {
    it("parses valid JSON arrays", async () => {
      const { safeParseJsonArray } = await import("../../services/utils.js");
      expect(safeParseJsonArray('["a","b"]')).toEqual(["a", "b"]);
    });

    it("returns empty for invalid JSON", async () => {
      const { safeParseJsonArray } = await import("../../services/utils.js");
      expect(safeParseJsonArray("not json")).toEqual([]);
    });

    it("returns empty for non-string input", async () => {
      const { safeParseJsonArray } = await import("../../services/utils.js");
      expect(safeParseJsonArray(undefined)).toEqual([]);
      expect(safeParseJsonArray(null)).toEqual([]);
      expect(safeParseJsonArray(42)).toEqual([]);
    });
  });
});
