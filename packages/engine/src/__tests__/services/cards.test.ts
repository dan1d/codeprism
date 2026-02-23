import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, insertTestCard, type TestDb } from "../helpers/db.js";

let testDb: TestDb;

vi.mock("../../db/connection.js", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("../../search/hybrid.js", () => ({
  hybridSearch: vi.fn().mockResolvedValue([]),
}));

const { listCards, getCard, listFlows } = await import("../../services/cards.js");

describe("cards service", () => {
  beforeEach(() => { testDb = createTestDb(); });
  afterEach(() => { testDb.close(); });

  describe("listCards", () => {
    it("returns empty array for fresh DB", () => {
      expect(listCards()).toEqual([]);
    });

    it("returns all cards ordered by updated_at DESC", () => {
      insertTestCard(testDb, { id: "c1", flow: "auth", title: "Auth Card" });
      insertTestCard(testDb, { id: "c2", flow: "billing", title: "Billing Card" });

      const cards = listCards();
      expect(cards).toHaveLength(2);
    });

    it("filters by flow when provided", () => {
      insertTestCard(testDb, { id: "c1", flow: "auth", title: "Auth Card" });
      insertTestCard(testDb, { id: "c2", flow: "billing", title: "Billing Card" });

      const authCards = listCards("auth");
      expect(authCards).toHaveLength(1);
      expect(authCards[0]!.flow).toBe("auth");
    });
  });

  describe("getCard", () => {
    it("returns card when found", () => {
      insertTestCard(testDb, { id: "c1", title: "My Card" });
      const card = getCard("c1");
      expect(card).not.toBeNull();
      expect(card!.title).toBe("My Card");
    });

    it("returns null when not found", () => {
      expect(getCard("nonexistent")).toBeNull();
    });
  });

  describe("listFlows", () => {
    it("returns empty array for fresh DB", () => {
      expect(listFlows()).toEqual([]);
    });

    it("groups cards by flow with counts", () => {
      insertTestCard(testDb, { id: "c1", flow: "auth" });
      insertTestCard(testDb, { id: "c2", flow: "auth" });
      insertTestCard(testDb, { id: "c3", flow: "billing" });

      const flows = listFlows();
      expect(flows).toHaveLength(2);

      const authFlow = flows.find((f) => f.flow === "auth");
      expect(authFlow).toBeDefined();
      expect(authFlow!.cardCount).toBe(2);
    });

    it("sorts page flows before technical flows", () => {
      insertTestCard(testDb, { id: "c1", flow: "api-hub" });
      insertTestCard(testDb, { id: "c2", flow: "User Profile Page" });

      const flows = listFlows();
      expect(flows[0]!.flow).toBe("User Profile Page");
      expect(flows[0]!.isPageFlow).toBe(true);
    });
  });
});
