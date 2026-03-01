import type { Database } from "better-sqlite3";
import { initSchema } from "./schema.js";

interface Migration {
  version: number;
  up: (db: Database) => void;
}

/**
 * Single migration: applies the complete canonical schema from schema.ts.
 * Pre-launch — no incremental ALTER TABLE history needed.
 * When the product ships, add new numbered entries here for in-place upgrades.
 */
const migrations: Migration[] = [
  {
    version: 1,
    up: (db) => {
      initSchema(db);
    },
  },
  {
    // Upgrade embedding tables to match CODEPRISM_EMBEDDING_DIM (default 768).
    // Required when switching embedding models that use a different dimension
    // (e.g. mxbai-embed-large-v1 or bge-large-en-v1.5 which output 1024-d).
    // vec0 virtual tables cannot be ALTER TABLE'd — they must be dropped and recreated.
    // Run `pnpm reembed` after applying this migration.
    version: 2,
    up: (db) => {
      const dim = Number(process.env["CODEPRISM_EMBEDDING_DIM"] ?? "768");
      try { db.exec("DROP TABLE IF EXISTS card_embeddings"); } catch { /* ignore */ }
      try { db.exec("DROP TABLE IF EXISTS card_title_embeddings"); } catch { /* ignore */ }
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS card_embeddings USING vec0(
          card_id   TEXT,
          embedding FLOAT[${dim}]
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS card_title_embeddings USING vec0(
          card_id   TEXT,
          embedding FLOAT[${dim}]
        );
      `);
    },
  },
  {
    // Add generated_docs table for auto-generated user/developer documentation
    // derived from knowledge cards. Separate from project_docs (per-repo LLM docs).
    version: 3,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS generated_docs (
          id           TEXT PRIMARY KEY,
          flow         TEXT NOT NULL,
          audience     TEXT NOT NULL CHECK(audience IN ('user', 'dev')),
          title        TEXT NOT NULL,
          content      TEXT NOT NULL,
          source_repos TEXT NOT NULL DEFAULT '[]',
          card_count   INTEGER NOT NULL DEFAULT 0,
          generated_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_generated_docs_flow_audience
          ON generated_docs(flow, audience);
        CREATE INDEX IF NOT EXISTS idx_generated_docs_flow
          ON generated_docs(flow);
      `);
    },
  },
  {
    // Track merged PRs imported via `gh` CLI. Each row links a GitHub PR to the
    // dev_insight card generated from its description + diff.
    version: 4,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS pr_imports (
          id          TEXT PRIMARY KEY,
          github_repo TEXT NOT NULL,
          local_repo  TEXT NOT NULL,
          pr_number   INTEGER NOT NULL,
          pr_title    TEXT NOT NULL,
          pr_body     TEXT NOT NULL DEFAULT '',
          pr_url      TEXT NOT NULL DEFAULT '',
          branch      TEXT NOT NULL DEFAULT '',
          merged_at   TEXT NOT NULL,
          card_id     TEXT,
          imported_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(github_repo, pr_number)
        );
        CREATE INDEX IF NOT EXISTS idx_pr_imports_repo_merged
          ON pr_imports(github_repo, merged_at DESC);
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
