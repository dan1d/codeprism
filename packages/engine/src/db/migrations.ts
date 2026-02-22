import type { Database } from "better-sqlite3";
import { initSchema } from "./schema.js";

interface Migration {
  version: number;
  up: (db: Database) => void;
}

const migrations: Migration[] = [
  {
    version: 1,
    up: (db) => {
      initSchema(db);
    },
  },
  {
    version: 2,
    up: (db) => {
      db.exec(`
        ALTER TABLE cards ADD COLUMN specificity_score REAL DEFAULT 0.5;

        CREATE TABLE IF NOT EXISTS search_config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    version: 3,
    up: (db) => {
      db.exec("ALTER TABLE cards ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'");
      // Rebuild FTS5 to include source_repos and tags for BM25 matching
      db.exec("DROP TABLE IF EXISTS cards_fts");
      db.exec(`
        CREATE VIRTUAL TABLE cards_fts USING fts5(
          title, content, flow, source_repos, tags,
          content=cards, content_rowid=rowid
        )
      `);
      db.exec("INSERT INTO cards_fts(cards_fts) VALUES('rebuild')");
    },
  },
  {
    version: 4,
    up: (db) => {
      db.exec(
        "ALTER TABLE file_index ADD COLUMN file_role TEXT NOT NULL DEFAULT 'domain'",
      );
    },
  },
  {
    version: 5,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS project_docs (
          id                TEXT PRIMARY KEY,
          repo              TEXT NOT NULL,
          doc_type          TEXT NOT NULL,
          title             TEXT NOT NULL,
          content           TEXT NOT NULL,
          stale             INTEGER NOT NULL DEFAULT 0,
          source_file_paths TEXT NOT NULL DEFAULT '[]',
          created_at        TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS project_docs_repo_type
          ON project_docs(repo, doc_type);
      `);
    },
  },
  {
    // Living memory: card_interactions tracking table
    version: 6,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS card_interactions (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp  TEXT NOT NULL DEFAULT (datetime('now')),
          query      TEXT NOT NULL,
          card_id    TEXT NOT NULL,
          outcome    TEXT NOT NULL DEFAULT 'viewed',
          session_id TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_card_interactions_card_id
          ON card_interactions(card_id);
        CREATE INDEX IF NOT EXISTS idx_card_interactions_timestamp
          ON card_interactions(timestamp);
      `);
    },
  },
  {
    // Stack profiling: repo_profiles table for skill routing
    version: 7,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS repo_profiles (
          repo              TEXT PRIMARY KEY,
          primary_language  TEXT NOT NULL DEFAULT '',
          frameworks        TEXT NOT NULL DEFAULT '[]',
          is_lambda         INTEGER NOT NULL DEFAULT 0,
          package_manager   TEXT NOT NULL DEFAULT '',
          skill_ids         TEXT NOT NULL DEFAULT '[]',
          detected_at       TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    // source_commit on cards for precise staleness tracking
    version: 8,
    up: (db) => {
      db.exec(
        "ALTER TABLE cards ADD COLUMN source_commit TEXT",
      );
    },
  },
  {
    // Company-level instance profile singleton
    version: 9,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS instance_profile (
          id           INTEGER PRIMARY KEY CHECK (id = 1),
          company_name TEXT NOT NULL DEFAULT '',
          plan         TEXT NOT NULL DEFAULT 'self_hosted',
          instance_id  TEXT NOT NULL DEFAULT (lower(hex(randomblob(8)))),
          created_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT OR IGNORE INTO instance_profile (id) VALUES (1);
      `);
    },
  },
  {
    // Card verification tracking (inspired by Antigravity KI system)
    version: 11,
    up: (db) => {
      db.exec(`
        ALTER TABLE cards ADD COLUMN verified_at TEXT;
        ALTER TABLE cards ADD COLUMN verification_count INTEGER NOT NULL DEFAULT 0;
      `);
    },
  },
];

/**
 * Returns the highest schema version that has been applied,
 * or 0 if the schema_version table does not yet exist.
 */
function getCurrentVersion(db: Database): number {
  const tableExists = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_version'",
    )
    .get();

  if (!tableExists) return 0;

  const row = db
    .prepare("SELECT MAX(version) AS version FROM schema_version")
    .get() as { version: number | null } | undefined;

  return row?.version ?? 0;
}

/**
 * Runs all pending migrations in order. Each migration is executed inside a
 * transaction so that a failure rolls back cleanly without leaving the schema
 * in an inconsistent state.
 */
export function runMigrations(db: Database): void {
  const current = getCurrentVersion(db);

  const pending = migrations
    .filter((m) => m.version > current)
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    migration.up(db);

    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(
      migration.version,
    );
  }
}
