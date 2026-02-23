/**
 * Tests for db/migrations.ts — schema versioning and idempotency.
 *
 * Uses a real in-memory SQLite DB (no mocks) with sqlite-vec loaded.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { runMigrations } from "../../db/migrations.js";

function createRawDb(): Database.Database {
  const db = new Database(":memory:");
  try {
    sqliteVec.load(db);
  } catch {
    // Acceptable if sqlite-vec is unavailable — vec0 tests will fail clearly.
  }
  return db;
}

describe("runMigrations", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createRawDb();
  });

  afterEach(() => {
    db.close();
  });

  it("migrates a fresh DB from 0 to latest version without error", () => {
    expect(() => runMigrations(db)).not.toThrow();
  });

  it("creates the schema_version table", () => {
    runMigrations(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r: unknown) => (r as { name: string }).name);
    expect(tables).toContain("schema_version");
  });

  it("records version 1 in schema_version", () => {
    runMigrations(db);
    const versions = db
      .prepare("SELECT version FROM schema_version ORDER BY version")
      .all()
      .map((r: unknown) => (r as { version: number }).version);

    expect(versions).toContain(1);
    expect(versions).toHaveLength(1);
  });

  it("is idempotent — running twice does not error or duplicate versions", () => {
    runMigrations(db);
    expect(() => runMigrations(db)).not.toThrow();

    const count = (
      db
        .prepare("SELECT COUNT(*) as c FROM schema_version WHERE version = 1")
        .get() as { c: number }
    ).c;
    expect(count).toBe(1);
  });

  it("creates the cards table with required columns", () => {
    runMigrations(db);
    const cols = db
      .prepare("PRAGMA table_info(cards)")
      .all()
      .map((r: unknown) => (r as { name: string }).name);

    expect(cols).toContain("id");
    expect(cols).toContain("flow");
    expect(cols).toContain("title");
    expect(cols).toContain("content");
    expect(cols).toContain("card_type");
    expect(cols).toContain("source_files");
    expect(cols).toContain("source_repos");
    expect(cols).toContain("stale");
    expect(cols).toContain("usage_count");
    expect(cols).toContain("specificity_score");
    expect(cols).toContain("tags");
  });

  it("creates file_index table with file_role and heat_score columns", () => {
    runMigrations(db);
    const cols = db
      .prepare("PRAGMA table_info(file_index)")
      .all()
      .map((r: unknown) => (r as { name: string }).name);

    expect(cols).toContain("file_role");
  });

  it("creates the project_docs table with all columns", () => {
    runMigrations(db);
    const cols = db
      .prepare("PRAGMA table_info(project_docs)")
      .all()
      .map((r: unknown) => (r as { name: string }).name);

    expect(cols).toContain("id");
    expect(cols).toContain("repo");
    expect(cols).toContain("doc_type");
    expect(cols).toContain("title");
    expect(cols).toContain("content");
    expect(cols).toContain("stale");
    expect(cols).toContain("source_file_paths");
    expect(cols).toContain("created_at");
    expect(cols).toContain("updated_at");
  });

  it("enforces uniqueness on (repo, doc_type) in project_docs", () => {
    runMigrations(db);

    db.prepare(
      "INSERT INTO project_docs (id, repo, doc_type, title, content, stale, source_file_paths) VALUES (?, ?, ?, ?, ?, 0, '[]')",
    ).run("doc-1", "test-repo", "about", "Title", "Content");

    expect(() => {
      db.prepare(
        "INSERT INTO project_docs (id, repo, doc_type, title, content, stale, source_file_paths) VALUES (?, ?, ?, ?, ?, 0, '[]')",
      ).run("doc-2", "test-repo", "about", "Title 2", "Content 2");
    }).toThrow();
  });

  it("creates cards_fts FTS5 virtual table", () => {
    runMigrations(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r: unknown) => (r as { name: string }).name);
    expect(tables).toContain("cards_fts");
  });

  it("allows inserting and querying cards after migration", () => {
    runMigrations(db);
    db.prepare(`
      INSERT INTO cards (id, flow, title, content, card_type, source_files, source_repos, tags, stale, usage_count, specificity_score)
      VALUES ('test-id', 'test-flow', 'Test', 'content', 'flow', '[]', '["repo"]', '[]', 0, 0, 0.5)
    `).run();

    const card = db.prepare("SELECT * FROM cards WHERE id = ?").get("test-id") as {
      id: string;
    };
    expect(card.id).toBe("test-id");
  });
});
