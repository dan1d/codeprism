/**
 * In-memory SQLite factory for unit tests.
 *
 * Creates a fully-migrated in-memory DB. Each test suite should call
 * `createTestDb()` in a `beforeEach` / `afterEach` pair to ensure isolation.
 */

import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { runMigrations } from "../../db/migrations.js";

export type TestDb = ReturnType<typeof Database>;

/**
 * Creates a fresh, fully-migrated in-memory SQLite database.
 * sqlite-vec is loaded so vector operations work correctly.
 */
export function createTestDb(): TestDb {
  const db = new Database(":memory:");
  try {
    sqliteVec.load(db);
  } catch {
    // sqlite-vec may not be available in all CI environments; skip gracefully.
    // Tests that require vector ops will naturally fail and surface the issue.
  }
  db.pragma("journal_mode = WAL");
  runMigrations(db);
  return db;
}

/**
 * Inserts a card row into the test DB and returns the id.
 */
export function insertTestCard(
  db: TestDb,
  overrides: Partial<{
    id: string;
    flow: string;
    title: string;
    content: string;
    card_type: string;
    source_files: string;
    source_repos: string;
    tags: string;
    identifiers: string;
    stale: number;
    usage_count: number;
    specificity_score: number;
  }> = {},
): string {
  const id = overrides.id ?? `card-${Math.random().toString(36).slice(2)}`;
  db.prepare(`
    INSERT INTO cards
      (id, flow, title, content, card_type, source_files, source_repos, tags, identifiers, stale, usage_count, specificity_score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.flow ?? "test-flow",
    overrides.title ?? "Test Card",
    overrides.content ?? "Test card content",
    overrides.card_type ?? "flow",
    overrides.source_files ?? '[]',
    overrides.source_repos ?? '["test-repo"]',
    overrides.tags ?? '[]',
    overrides.identifiers ?? "",
    overrides.stale ?? 0,
    overrides.usage_count ?? 0,
    overrides.specificity_score ?? 0.5,
  );
  return id;
}

/**
 * Inserts a project_doc row into the test DB and returns the id.
 */
export function insertTestProjectDoc(
  db: TestDb,
  overrides: Partial<{
    id: string;
    repo: string;
    doc_type: string;
    title: string;
    content: string;
    stale: number;
    source_file_paths: string;
  }> = {},
): string {
  const id = overrides.id ?? `doc-${Math.random().toString(36).slice(2)}`;
  db.prepare(`
    INSERT INTO project_docs (id, repo, doc_type, title, content, stale, source_file_paths)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.repo ?? "test-repo",
    overrides.doc_type ?? "about",
    overrides.title ?? "Test Doc",
    overrides.content ?? "Test doc content",
    overrides.stale ?? 0,
    overrides.source_file_paths ?? '[]',
  );
  return id;
}
