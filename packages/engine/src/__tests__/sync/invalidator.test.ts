/**
 * Tests for sync/invalidator.ts — card and project doc staleness logic.
 *
 * Uses in-memory SQLite via createTestDb(); mocks getDb() to return it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, insertTestCard, insertTestProjectDoc, type TestDb } from "../helpers/db.js";

let testDb: TestDb;
vi.mock("../../db/connection.js", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

const { invalidateCards, invalidateProjectDocs, propagateCrossRepoStaleness } = await import(
  "../../sync/invalidator.js"
);

describe("invalidateCards", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  it("returns 0 when changedFiles is empty", () => {
    insertTestCard(testDb, { source_files: '["app/models/patient.rb"]', source_repos: '["my-repo"]' });
    expect(invalidateCards([], "my-repo")).toBe(0);
  });

  it("marks a matching card as stale", () => {
    const id = insertTestCard(testDb, {
      source_files: '["app/models/patient.rb", "app/controllers/patients_controller.rb"]',
      source_repos: '["my-repo"]',
      stale: 0,
    });

    const count = invalidateCards(["app/models/patient.rb"], "my-repo");
    expect(count).toBe(1);

    const card = testDb.prepare("SELECT stale FROM cards WHERE id = ?").get(id) as { stale: number };
    expect(card.stale).toBe(1);
  });

  it("does not mark a card stale when none of its source files match", () => {
    const id = insertTestCard(testDb, {
      source_files: '["app/models/patient.rb"]',
      source_repos: '["my-repo"]',
      stale: 0,
    });

    invalidateCards(["app/models/device.rb"], "my-repo");

    const card = testDb.prepare("SELECT stale FROM cards WHERE id = ?").get(id) as { stale: number };
    expect(card.stale).toBe(0);
  });

  it("does not touch cards from a different repo", () => {
    const id = insertTestCard(testDb, {
      source_files: '["app/models/patient.rb"]',
      source_repos: '["other-repo"]',
      stale: 0,
    });

    invalidateCards(["app/models/patient.rb"], "my-repo");

    const card = testDb.prepare("SELECT stale FROM cards WHERE id = ?").get(id) as { stale: number };
    expect(card.stale).toBe(0);
  });

  it("does not re-mark already-stale cards", () => {
    insertTestCard(testDb, {
      id: "stale-card",
      source_files: '["app/models/patient.rb"]',
      source_repos: '["my-repo"]',
      stale: 1,
    });

    const count = invalidateCards(["app/models/patient.rb"], "my-repo");
    expect(count).toBe(0);
  });

  it("returns the correct count when multiple cards match", () => {
    for (let i = 0; i < 3; i++) {
      insertTestCard(testDb, {
        id: `card-${i}`,
        source_files: '["app/models/patient.rb"]',
        source_repos: '["my-repo"]',
        stale: 0,
      });
    }

    const count = invalidateCards(["app/models/patient.rb"], "my-repo");
    expect(count).toBe(3);
  });
});

describe("invalidateProjectDocs", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  it("returns 0 when changedFiles is empty", () => {
    insertTestProjectDoc(testDb, { repo: "my-repo", doc_type: "architecture" });
    expect(invalidateProjectDocs([], "my-repo")).toBe(0);
  });

  it("marks architecture and rules stale when schema.rb changes", () => {
    insertTestProjectDoc(testDb, { repo: "my-repo", doc_type: "architecture", stale: 0 });
    insertTestProjectDoc(testDb, { repo: "my-repo", doc_type: "rules", stale: 0 });
    insertTestProjectDoc(testDb, { repo: "my-repo", doc_type: "about", stale: 0 });

    const count = invalidateProjectDocs(["db/schema.rb"], "my-repo");
    expect(count).toBe(2); // architecture + rules

    const archRow = testDb
      .prepare("SELECT stale FROM project_docs WHERE repo = ? AND doc_type = ?")
      .get("my-repo", "architecture") as { stale: number };
    expect(archRow.stale).toBe(1);

    const rulesRow = testDb
      .prepare("SELECT stale FROM project_docs WHERE repo = ? AND doc_type = ?")
      .get("my-repo", "rules") as { stale: number };
    expect(rulesRow.stale).toBe(1);

    const aboutRow = testDb
      .prepare("SELECT stale FROM project_docs WHERE repo = ? AND doc_type = ?")
      .get("my-repo", "about") as { stale: number };
    expect(aboutRow.stale).toBe(0); // not affected by schema.rb
  });

  it("marks styles stale when a .scss file changes", () => {
    insertTestProjectDoc(testDb, { repo: "my-repo", doc_type: "styles", stale: 0 });

    const count = invalidateProjectDocs(["app/assets/stylesheets/main.scss"], "my-repo");
    expect(count).toBe(1);
  });

  it("marks readme stale when package.json changes", () => {
    insertTestProjectDoc(testDb, { repo: "my-repo", doc_type: "readme", stale: 0 });

    const count = invalidateProjectDocs(["package.json"], "my-repo");
    expect(count).toBe(1);
  });

  it("marks about + architecture + rules stale when a model file changes", () => {
    insertTestProjectDoc(testDb, { repo: "my-repo", doc_type: "about", stale: 0 });
    insertTestProjectDoc(testDb, { repo: "my-repo", doc_type: "architecture", stale: 0 });
    insertTestProjectDoc(testDb, { repo: "my-repo", doc_type: "rules", stale: 0 });

    const count = invalidateProjectDocs(["app/models/patient.rb"], "my-repo");
    expect(count).toBe(3);
  });

  it("does not affect docs from a different repo", () => {
    insertTestProjectDoc(testDb, { repo: "other-repo", doc_type: "architecture", stale: 0 });

    invalidateProjectDocs(["db/schema.rb"], "my-repo");

    const row = testDb
      .prepare("SELECT stale FROM project_docs WHERE repo = ? AND doc_type = ?")
      .get("other-repo", "architecture") as { stale: number };
    expect(row.stale).toBe(0);
  });

  it("returns 0 when no matching docs exist", () => {
    const count = invalidateProjectDocs(["db/schema.rb"], "empty-repo");
    expect(count).toBe(0);
  });

  it("returns 0 when changed file matches no rule", () => {
    insertTestProjectDoc(testDb, { repo: "my-repo", doc_type: "about", stale: 0 });
    const count = invalidateProjectDocs(["some/random/file.jpg"], "my-repo");
    expect(count).toBe(0);
  });

  it("marks changelog stale on merge events when code files change", () => {
    insertTestProjectDoc(testDb, { repo: "my-repo", doc_type: "changelog", stale: 0 });

    const count = invalidateProjectDocs(["app/models/patient.rb"], "my-repo", true);
    expect(count).toBeGreaterThan(0);

    const row = testDb
      .prepare("SELECT stale FROM project_docs WHERE repo = ? AND doc_type = 'changelog'")
      .get("my-repo") as { stale: number };
    expect(row.stale).toBe(1);
  });

  it("does NOT mark changelog stale on save events", () => {
    insertTestProjectDoc(testDb, { repo: "my-repo", doc_type: "changelog", stale: 0 });

    invalidateProjectDocs(["app/models/patient.rb"], "my-repo", false);

    const row = testDb
      .prepare("SELECT stale FROM project_docs WHERE repo = ? AND doc_type = 'changelog'")
      .get("my-repo") as { stale: number };
    expect(row.stale).toBe(0);
  });

  it("cascades specialist staleness to workspace specialist", () => {
    insertTestProjectDoc(testDb, { repo: "my-repo", doc_type: "about", stale: 0 });
    insertTestProjectDoc(testDb, { repo: "my-repo", doc_type: "architecture", stale: 0 });
    insertTestProjectDoc(testDb, { repo: "my-repo", doc_type: "specialist", stale: 0 });
    insertTestProjectDoc(testDb, { repo: "__workspace__", doc_type: "specialist", stale: 0 });

    // about and architecture changes trigger specialist cascade
    invalidateProjectDocs(["app/models/patient.rb"], "my-repo", false);

    const wsRow = testDb
      .prepare("SELECT stale FROM project_docs WHERE repo = '__workspace__' AND doc_type = 'specialist'")
      .get() as { stale: number };
    expect(wsRow.stale).toBe(1);
  });
});

describe("propagateCrossRepoStaleness", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  it("returns 0 when no graph edges exist for the changed files", () => {
    insertTestCard(testDb, {
      card_type: "cross_service",
      source_files: '["app/controllers/api/v1/patients_controller.rb"]',
      source_repos: '["frontend"]',
      stale: 0,
    });

    const result = propagateCrossRepoStaleness(["app/models/patient.rb"], "backend");
    expect(result).toBe(0);
  });

  it("returns 0 when changedFiles is empty", () => {
    const result = propagateCrossRepoStaleness([], "backend");
    expect(result).toBe(0);
  });

  it("marks cross_service cards stale when a connected backend file changes", () => {
    // Insert a graph edge: backend file → frontend file (api_endpoint relation)
    testDb.prepare(
      `INSERT INTO graph_edges (source_file, target_file, relation, repo)
       VALUES (?, ?, ?, ?)`,
    ).run(
      "app/controllers/api/v1/patients_controller.rb",
      "src/api/patients.ts",
      "api_endpoint",
      "backend",
    );

    // Insert a cross_service card that references the frontend file
    const cardId = insertTestCard(testDb, {
      id: "cross-card",
      card_type: "cross_service",
      source_files: '["src/api/patients.ts"]',
      source_repos: '["frontend"]',
      stale: 0,
    });

    const result = propagateCrossRepoStaleness(
      ["app/controllers/api/v1/patients_controller.rb"],
      "backend",
    );
    expect(result).toBe(1);

    const card = testDb.prepare("SELECT stale FROM cards WHERE id = ?").get(cardId) as { stale: number };
    expect(card.stale).toBe(1);
  });
});
