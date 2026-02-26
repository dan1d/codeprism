/**
 * Tests for sync/receiver.ts — file change ingestion and staleness propagation.
 *
 * tree-sitter (parseFile) is mocked so no native binaries are needed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, insertTestCard, insertTestProjectDoc, type TestDb } from "../helpers/db.js";

let testDb: TestDb;

vi.mock("../../db/connection.js", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

// Mock tree-sitter — returns a minimal parse result without native binaries
vi.mock("../../indexer/tree-sitter.js", () => ({
  parseVirtualFile: vi.fn(async (path: string, repo: string) => ({
    path,
    repo,
    language: "ruby",
    fileRole: "domain",
    classes: [],
    associations: [],
    routes: [],
    imports: [],
    exports: [],
    functions: [],
    apiCalls: [],
    storeUsages: [],
    callbacks: [],
    validations: [],
  })),
}));

const { handleSync } = await import("../../sync/receiver.js");

describe("handleSync", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  it("indexes added files into file_index", async () => {
    const result = await handleSync({
      repo: "backend",
      branch: "main",
      changedFiles: [
        { path: "app/models/patient.rb", content: "class Patient; end", status: "added" },
      ],
    });

    expect(result.indexed).toBe(1);

    const row = testDb
      .prepare("SELECT path, repo FROM file_index WHERE path = ?")
      .get("app/models/patient.rb") as { path: string; repo: string } | undefined;

    expect(row).toBeDefined();
    expect(row!.repo).toBe("backend");
  });

  it("removes deleted files from file_index", async () => {
    // First, insert a file
    testDb
      .prepare(
        `INSERT INTO file_index (path, repo, branch, parsed_data) VALUES (?, ?, ?, '{}')`,
      )
      .run("app/models/old.rb", "backend", "main");

    await handleSync({
      repo: "backend",
      branch: "main",
      changedFiles: [
        { path: "app/models/old.rb", content: "", status: "deleted" },
      ],
    });

    const row = testDb
      .prepare("SELECT path FROM file_index WHERE path = ?")
      .get("app/models/old.rb");

    expect(row).toBeUndefined();
  });

  it("marks matching cards stale after sync", async () => {
    const cardId = insertTestCard(testDb, {
      source_files: '["app/models/patient.rb"]',
      source_repos: '["backend"]',
      stale: 0,
    });

    const result = await handleSync({
      repo: "backend",
      branch: "main",
      changedFiles: [
        { path: "app/models/patient.rb", content: "class Patient; end", status: "modified" },
      ],
    });

    expect(result.invalidated).toBe(1);

    const card = testDb
      .prepare("SELECT stale FROM cards WHERE id = ?")
      .get(cardId) as { stale: number };
    expect(card.stale).toBe(1);
  });

  it("does not mark cards stale from other repos", async () => {
    const cardId = insertTestCard(testDb, {
      source_files: '["app/models/patient.rb"]',
      source_repos: '["frontend"]',
      stale: 0,
    });

    await handleSync({
      repo: "backend",
      branch: "main",
      changedFiles: [
        { path: "app/models/patient.rb", content: "", status: "modified" },
      ],
    });

    const card = testDb
      .prepare("SELECT stale FROM cards WHERE id = ?")
      .get(cardId) as { stale: number };
    expect(card.stale).toBe(0);
  });

  it("invalidates architecture docs on save events when schema.rb changes", async () => {
    insertTestProjectDoc(testDb, { repo: "backend", doc_type: "architecture", stale: 0 });

    await handleSync({
      repo: "backend",
      branch: "main",
      eventType: "save",
      changedFiles: [
        { path: "db/schema.rb", content: "", status: "modified" },
      ],
    });

    const doc = testDb
      .prepare("SELECT stale FROM project_docs WHERE repo = ? AND doc_type = ?")
      .get("backend", "architecture") as { stale: number };

    // architecture docs are marked stale for any schema.rb change (save or merge)
    expect(doc.stale).toBe(1);
  });

  it("does not mark changelog stale on save events", async () => {
    insertTestProjectDoc(testDb, { repo: "backend", doc_type: "changelog", stale: 0 });

    await handleSync({
      repo: "backend",
      branch: "main",
      eventType: "save",
      changedFiles: [
        { path: "app/models/patient.rb", content: "", status: "modified" },
      ],
    });

    const doc = testDb
      .prepare("SELECT stale FROM project_docs WHERE repo = ? AND doc_type = ?")
      .get("backend", "changelog") as { stale: number };

    // changelog only goes stale on merge/pull events
    expect(doc.stale).toBe(0);
  });

  it("invalidates project docs on merge events", async () => {
    insertTestProjectDoc(testDb, { repo: "backend", doc_type: "architecture", stale: 0 });

    await handleSync({
      repo: "backend",
      branch: "main",
      eventType: "merge",
      changedFiles: [
        { path: "db/schema.rb", content: "", status: "modified" },
      ],
    });

    const doc = testDb
      .prepare("SELECT stale FROM project_docs WHERE repo = ? AND doc_type = ?")
      .get("backend", "architecture") as { stale: number };

    expect(doc.stale).toBe(1);
  });

  it("handles multiple file changes atomically", async () => {
    const result = await handleSync({
      repo: "backend",
      branch: "feature/auth",
      commitSha: "abc123",
      changedFiles: [
        { path: "app/models/user.rb", content: "class User; end", status: "added" },
        { path: "app/controllers/sessions_controller.rb", content: "class SessionsController; end", status: "modified" },
        { path: "app/models/old_model.rb", content: "", status: "deleted" },
      ],
    });

    expect(result.indexed).toBe(2);
  });

  it("upserts file_index on conflict", async () => {
    // Insert once
    await handleSync({
      repo: "backend",
      branch: "main",
      changedFiles: [
        { path: "app/models/patient.rb", content: "v1", status: "added" },
      ],
    });

    // Update same file
    await handleSync({
      repo: "backend",
      branch: "main",
      commitSha: "new-sha",
      changedFiles: [
        { path: "app/models/patient.rb", content: "v2", status: "modified" },
      ],
    });

    const rows = testDb
      .prepare("SELECT COUNT(*) AS count FROM file_index WHERE path = ?")
      .get("app/models/patient.rb") as { count: number };

    expect(rows.count).toBe(1);
  });

  it("handles empty changedFiles gracefully", async () => {
    const result = await handleSync({
      repo: "backend",
      branch: "main",
      changedFiles: [],
    });

    expect(result.indexed).toBe(0);
    expect(result.invalidated).toBe(0);
  });
});
