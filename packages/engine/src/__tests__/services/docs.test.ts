import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, insertTestProjectDoc, type TestDb } from "../helpers/db.js";

let testDb: TestDb;

vi.mock("../../db/connection.js", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("../../llm/provider.js", () => ({
  createLLMProvider: () => null,
}));

vi.mock("../../indexer/doc-prompts.js", () => ({
  buildRefreshDocPrompt: () => "test prompt",
  buildFrameworkBaseline: () => "",
  DOC_SYSTEM_PROMPT: "test system prompt",
}));

vi.mock("../../skills/index.js", () => ({
  resolveSkills: () => [],
}));

const { listProjectDocs } = await import("../../services/docs.js");

describe("docs service", () => {
  beforeEach(() => { testDb = createTestDb(); });
  afterEach(() => { testDb.close(); });

  describe("listProjectDocs", () => {
    it("returns empty array for fresh DB", () => {
      expect(listProjectDocs()).toEqual([]);
    });

    it("returns all docs when no filters", () => {
      insertTestProjectDoc(testDb, { repo: "app1", doc_type: "about" });
      insertTestProjectDoc(testDb, { repo: "app2", doc_type: "about" });
      expect(listProjectDocs()).toHaveLength(2);
    });

    it("filters by repo", () => {
      insertTestProjectDoc(testDb, { repo: "app1", doc_type: "about" });
      insertTestProjectDoc(testDb, { repo: "app2", doc_type: "about" });
      const docs = listProjectDocs("app1");
      expect(docs).toHaveLength(1);
      expect(docs[0]!.repo).toBe("app1");
    });

    it("filters by repo and doc_type", () => {
      insertTestProjectDoc(testDb, { repo: "app1", doc_type: "about" });
      insertTestProjectDoc(testDb, { repo: "app1", doc_type: "architecture" });
      const docs = listProjectDocs("app1", "about");
      expect(docs).toHaveLength(1);
      expect(docs[0]!.doc_type).toBe("about");
    });

    it("returns empty when repo+type combo not found", () => {
      insertTestProjectDoc(testDb, { repo: "app1", doc_type: "about" });
      expect(listProjectDocs("app1", "architecture")).toEqual([]);
    });
  });
});
