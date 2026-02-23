import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, insertTestCard, type TestDb } from "../helpers/db.js";

let testDb: TestDb;

vi.mock("../../db/connection.js", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("../../indexer/doc-generator.js", () => ({
  patchMemoryDoc: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../search/repo-signals.js", () => ({
  getAllRepoSignalRecords: () => [],
}));

vi.mock("../../search/hybrid.js", () => ({
  hybridSearch: vi.fn().mockResolvedValue([]),
  checkCache: vi.fn().mockResolvedValue(null),
}));

describe("mcp/tools/knowledge — via service functions", () => {
  beforeEach(() => { testDb = createTestDb(); });
  afterEach(() => { testDb.close(); });

  describe("saveInsight", () => {
    it("inserts a dev_insight card via service function", async () => {
      const { saveInsight } = await import("../../services/cards.js");

      const { id } = saveInsight("architecture", "Service pattern", "We use the repository pattern.", ["src/repos/user.ts"]);

      const card = testDb.prepare("SELECT * FROM cards WHERE id = ?").get(id) as {
        flow: string; title: string; content: string; card_type: string; created_by: string; source_files: string;
      };

      expect(card.flow).toBe("architecture");
      expect(card.title).toBe("Service pattern");
      expect(card.card_type).toBe("dev_insight");
      expect(card.created_by).toBe("mcp_client");
      expect(JSON.parse(card.source_files)).toEqual(["src/repos/user.ts"]);
    });

    it("inserts with empty files when none provided", async () => {
      const { saveInsight } = await import("../../services/cards.js");

      const { id } = saveInsight("flow", "Title", "Content");

      const card = testDb.prepare("SELECT source_files FROM cards WHERE id = ?").get(id) as { source_files: string };
      expect(JSON.parse(card.source_files)).toEqual([]);
    });
  });

  describe("verifyCard", () => {
    it("increments verification_count and sets verified_at", async () => {
      const { verifyCard } = await import("../../services/cards.js");

      const id = insertTestCard(testDb, { title: "Verifiable" });
      const found = verifyCard(id);

      expect(found).toBe(true);

      const card = testDb.prepare("SELECT verified_at, verification_count FROM cards WHERE id = ?").get(id) as {
        verified_at: string; verification_count: number;
      };
      expect(card.verified_at).toBeTruthy();
      expect(card.verification_count).toBe(1);
    });

    it("returns false for non-existent card", async () => {
      const { verifyCard } = await import("../../services/cards.js");
      expect(verifyCard("nonexistent")).toBe(false);
    });
  });

  describe("listFlows", () => {
    it("returns flow summaries from cards table", async () => {
      const { listFlows } = await import("../../services/cards.js");

      insertTestCard(testDb, { id: "c1", flow: "auth" });
      insertTestCard(testDb, { id: "c2", flow: "auth" });
      insertTestCard(testDb, { id: "c3", flow: "billing" });

      const flows = listFlows();

      expect(flows.length).toBe(2);
      const authFlow = flows.find((f) => f.flow === "auth");
      expect(authFlow?.cardCount).toBe(2);
    });

    it("excludes conv_insight cards", async () => {
      const { listFlows } = await import("../../services/cards.js");

      insertTestCard(testDb, { id: "c1", flow: "auth", card_type: "flow" });
      insertTestCard(testDb, { id: "c2", flow: "auth", card_type: "conv_insight" });

      const flows = listFlows();
      const authFlow = flows.find((f) => f.flow === "auth");
      expect(authFlow?.cardCount).toBe(1);
    });

    it("includes avgHeat field", async () => {
      const { listFlows } = await import("../../services/cards.js");

      insertTestCard(testDb, { id: "c1", flow: "auth" });
      const flows = listFlows();
      expect(flows[0]).toHaveProperty("avgHeat");
    });
  });

  describe("promoteInsight", () => {
    it("returns promoted:false when insight is not found", async () => {
      const { promoteInsight } = await import("../../services/cards.js");

      const result = promoteInsight("nonexistent", true);
      expect(result.promoted).toBe(false);
    });
  });
});
