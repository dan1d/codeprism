import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, insertTestCard, type TestDb } from "../helpers/db.js";

let testDb: TestDb;

vi.mock("../../db/connection.js", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("../../search/repo-signals.js", () => ({
  getAllRepoSignalRecords: () => [],
}));

describe("mcp/tools/operations — via service functions", () => {
  beforeEach(() => { testDb = createTestDb(); });
  afterEach(() => { testDb.close(); });

  describe("getRecentQueries", () => {
    it("returns recent queries from card_interactions", async () => {
      const { getRecentQueries } = await import("../../services/search.js");

      insertTestCard(testDb, { id: "c1", title: "Auth Card" });
      testDb.prepare(
        `INSERT INTO card_interactions (query, card_id, outcome, session_id)
         VALUES (?, ?, 'viewed', 'sess1')`,
      ).run("how does auth work", "c1");

      const rows = getRecentQueries(10);

      expect(rows).toHaveLength(1);
      expect(rows[0]!.query).toBe("how does auth work");
      expect(rows[0]!.matchedCards).toBe(1);
      expect(rows[0]!.cardTitles).toContain("Auth Card");
    });

    it("returns empty array when no interactions", async () => {
      const { getRecentQueries } = await import("../../services/search.js");
      expect(getRecentQueries()).toEqual([]);
    });
  });

  describe("listSearchConfig / getSearchConfigEntry / setSearchConfigEntry", () => {
    it("stores and retrieves config entries via service functions", async () => {
      const { setSearchConfigEntry, getSearchConfigEntry } = await import("../../services/instance.js");

      setSearchConfigEntry("hub_penalty", "0.5");
      expect(getSearchConfigEntry("hub_penalty")).toBe("0.5");
    });

    it("lists all config entries", async () => {
      const { setSearchConfigEntry, listSearchConfig } = await import("../../services/instance.js");

      setSearchConfigEntry("key1", "val1");
      setSearchConfigEntry("key2", "val2");

      const rows = listSearchConfig();
      expect(rows).toHaveLength(2);
      expect(rows[0]!.key).toBe("key1");
    });

    it("returns undefined for non-existent key", async () => {
      const { getSearchConfigEntry } = await import("../../services/instance.js");
      expect(getSearchConfigEntry("nope")).toBeUndefined();
    });
  });

  describe("getWorkspaceStatus", () => {
    it("aggregates card stats per repo", async () => {
      const { getWorkspaceStatus } = await import("../../services/repos.js");

      insertTestCard(testDb, { id: "c1", source_repos: '["app-backend"]' });
      insertTestCard(testDb, { id: "c2", source_repos: '["app-backend"]', stale: 1 });
      insertTestCard(testDb, { id: "c3", source_repos: '["app-frontend"]' });

      const status = getWorkspaceStatus();

      expect(status.repos).toHaveLength(2);
      const backend = status.repos.find((r) => r.repo === "app-backend");
      expect(backend?.totalCards).toBe(2);
      expect(backend?.staleCards).toBe(1);
    });

    it("returns empty repos for empty DB", async () => {
      const { getWorkspaceStatus } = await import("../../services/repos.js");
      const status = getWorkspaceStatus();
      expect(status.repos).toEqual([]);
      expect(status.totalStale).toBe(0);
    });
  });

  describe("getStaleCardCount", () => {
    it("counts stale cards via service function", async () => {
      const { getStaleCardCount } = await import("../../services/reindex.js");

      insertTestCard(testDb, { id: "c1", stale: 1, source_repos: '["my-repo"]' });
      insertTestCard(testDb, { id: "c2", stale: 0, source_repos: '["my-repo"]' });
      insertTestCard(testDb, { id: "c3", stale: 1, source_repos: '["other"]' });

      expect(getStaleCardCount()).toBe(2);
      expect(getStaleCardCount("my-repo")).toBe(1);
    });
  });
});
