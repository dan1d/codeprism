import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db.js";

let testDb: TestDb;

vi.mock("../../db/connection.js", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("../../search/repo-signals.js", () => ({
  getAllRepoSignalRecords: () => [],
}));

const { listRepos, getRepoOverview, getRegisteredRepos, registerRepo, unregisterRepo, getRepoSignals } =
  await import("../../services/repos.js");

function seedRepoProfile(db: TestDb, repo: string) {
  db.prepare(
    `INSERT INTO repo_profiles (repo, primary_language, frameworks, skill_ids)
     VALUES (?, 'TypeScript', '["react"]', '["react"]')`,
  ).run(repo);
}

describe("repos service", () => {
  beforeEach(() => { testDb = createTestDb(); });
  afterEach(() => { testDb.close(); });

  describe("listRepos", () => {
    it("returns empty array for fresh DB", () => {
      expect(listRepos()).toEqual([]);
    });

    it("returns repo summaries with card stats", () => {
      seedRepoProfile(testDb, "my-app");
      testDb.prepare(
        `INSERT INTO cards (id, flow, title, content, card_type, source_files, source_repos, tags, identifiers, stale)
         VALUES ('c1', 'auth', 'Auth flow', 'content', 'flow', '[]', '["my-app"]', '[]', '', 0)`,
      ).run();

      const repos = listRepos();
      expect(repos).toHaveLength(1);
      expect(repos[0]!.repo).toBe("my-app");
      expect(repos[0]!.primaryLanguage).toBe("TypeScript");
      expect(repos[0]!.frameworks).toEqual(["react"]);
      expect(repos[0]!.cardCount).toBe(1);
      expect(repos[0]!.staleCards).toBe(0);
    });
  });

  describe("getRepoOverview", () => {
    it("returns null docs for repo with no docs", () => {
      const overview = getRepoOverview("missing-repo");
      expect(overview.about).toBeNull();
      expect(overview.pages).toBeNull();
      expect(overview.be_overview).toBeNull();
    });
  });

  describe("registered repos CRUD", () => {
    it("starts empty", () => {
      expect(getRegisteredRepos()).toEqual([]);
    });

    it("registers and lists a repo", () => {
      const result = registerRepo("test-repo", "/tmp");
      expect(result.name).toBe("test-repo");
      const repos = getRegisteredRepos();
      expect(repos).toHaveLength(1);
      expect(repos[0]!.name).toBe("test-repo");
    });

    it("rejects duplicate repo names", () => {
      registerRepo("dupe", "/tmp");
      expect(() => registerRepo("dupe", "/tmp")).toThrow(/already registered/);
    });

    it("unregisters a repo", () => {
      registerRepo("removable", "/tmp");
      expect(getRegisteredRepos()).toHaveLength(1);
      unregisterRepo("removable");
      expect(getRegisteredRepos()).toHaveLength(0);
    });
  });

  describe("getRepoSignals", () => {
    it("returns empty array (mocked)", () => {
      expect(getRepoSignals()).toEqual([]);
    });
  });
});
