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
  // NOTE: v10 was intentionally removed/reverted before any production deployment.
  // The version number is permanently retired — do not reuse it.
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
  {
    // Porter stemming for FTS5: "authorized" matches "authorize"/"authorization"
    version: 12,
    up: (db) => {
      db.exec("DROP TABLE IF EXISTS cards_fts");
      db.exec(`
        CREATE VIRTUAL TABLE cards_fts USING fts5(
          title, content, flow, source_repos, tags,
          content=cards, content_rowid=rowid,
          tokenize='porter unicode61'
        )
      `);
      db.exec("INSERT INTO cards_fts(cards_fts) VALUES('rebuild')");
    },
  },
  {
    // Content hash for deduplication; eval_cases for RAG quality evaluation
    version: 13,
    up: (db) => {
      db.exec("ALTER TABLE cards ADD COLUMN content_hash TEXT");
      db.exec(`
        CREATE TABLE IF NOT EXISTS eval_cases (
          id           TEXT PRIMARY KEY,
          query        TEXT NOT NULL,
          expected_card_id TEXT NOT NULL,
          source       TEXT NOT NULL DEFAULT 'synthetic',
          created_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_eval_cases_card
          ON eval_cases(expected_card_id);
      `);
    },
  },
  {
    // Title embeddings for improved short-query recall (dual-vector retrieval)
    version: 14,
    up: (db) => {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS card_title_embeddings USING vec0(
          card_id TEXT,
          embedding FLOAT[384]
        )
      `);
    },
  },
  {
    // Three improvements in one migration:
    // 1. identifiers column — class names + routes stored separately from content
    //    so the semantic embedding vector stays uncontaminated.
    // 2. Upgrade vec0 embedding tables from FLOAT[384] (all-MiniLM) to FLOAT[768]
    //    (nomic-embed-text-v1.5). All cards must be re-embedded after this runs.
    // 3. Rebuild FTS5 with identifiers column + Porter stemmer (already set in v12).
    version: 15,
    up: (db) => {
      // Add identifiers column
      db.exec("ALTER TABLE cards ADD COLUMN identifiers TEXT NOT NULL DEFAULT ''");

      // Rebuild FTS5 to include identifiers with Porter stemmer
      db.exec("DROP TABLE IF EXISTS cards_fts");
      db.exec(`
        CREATE VIRTUAL TABLE cards_fts USING fts5(
          title, content, flow, source_repos, tags, identifiers,
          content=cards, content_rowid=rowid,
          tokenize='porter unicode61'
        )
      `);
      db.exec("INSERT INTO cards_fts(cards_fts) VALUES('rebuild')");

      // Upgrade vec0 tables to 768-dim for nomic-embed-text-v1.5
      // (vec0 tables cannot be altered — drop and recreate)
      db.exec("DROP TABLE IF EXISTS card_embeddings");
      db.exec(`
        CREATE VIRTUAL TABLE card_embeddings USING vec0(
          card_id TEXT,
          embedding FLOAT[768]
        )
      `);
      db.exec("DROP TABLE IF EXISTS card_title_embeddings");
      db.exec(`
        CREATE VIRTUAL TABLE card_title_embeddings USING vec0(
          card_id TEXT,
          embedding FLOAT[768]
        )
      `);
    },
  },
  {
    // Dedicated repo_signals table replaces the repo_signals:{repo} search_config hack.
    // Columns:
    //   signals       – JSON string[]  – keyword tokens used in detectTextRepoAffinity()
    //   signal_source – 'derived' | 'manual' — derived by engine; manual = team override
    //   locked        – 1 = never overwrite on re-index (set by dashboard / manual edit)
    //   generated_at  – ISO timestamp of last generation run
    version: 16,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS repo_signals (
          repo          TEXT PRIMARY KEY,
          signals       TEXT NOT NULL DEFAULT '[]',
          signal_source TEXT NOT NULL DEFAULT 'derived',
          locked        INTEGER NOT NULL DEFAULT 0,
          generated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    // applied_baseline_hash for framework baseline staleness detection
    version: 17,
    up: (db) => {
      db.exec(`ALTER TABLE project_docs ADD COLUMN applied_baseline_hash TEXT`);
    },
  },
  {
    // heat_score on file_index for thermal map (git commit frequency 0.0–1.0)
    // file_path on project_docs for /ai-srcmap/ filesystem write path
    version: 18,
    up: (db) => {
      db.exec(`
        ALTER TABLE file_index ADD COLUMN heat_score REAL DEFAULT 0;
        ALTER TABLE project_docs ADD COLUMN file_path TEXT;
      `);
    },
  },
  {
    // Conversation intelligence schema
    // transcript_imports  — deduplication of imported transcript files
    // transcript_pr_links — file-overlap correlation to git PRs
    // extracted_insights  — raw extracted insights before card promotion
    // cards additions     — contributor_dev_id, source_conversation_id, expires_at
    version: 19,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS transcript_imports (
          id            TEXT PRIMARY KEY,
          file_path     TEXT NOT NULL,
          content_hash  TEXT NOT NULL UNIQUE,
          imported_at   TEXT NOT NULL DEFAULT (datetime('now')),
          source_type   TEXT NOT NULL DEFAULT 'cursor'
        );

        CREATE TABLE IF NOT EXISTS transcript_pr_links (
          id              TEXT PRIMARY KEY,
          transcript_id   TEXT NOT NULL REFERENCES transcript_imports(id),
          repo            TEXT NOT NULL,
          commit_sha      TEXT,
          pr_number       TEXT,
          matched_files   TEXT NOT NULL DEFAULT '[]',
          status          TEXT NOT NULL DEFAULT 'unknown',
          linked_at       TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS extracted_insights (
          id                    TEXT PRIMARY KEY,
          transcript_id         TEXT NOT NULL REFERENCES transcript_imports(id),
          card_id               TEXT,
          category              TEXT NOT NULL,
          statement             TEXT NOT NULL,
          evidence_quote        TEXT NOT NULL,
          confidence            REAL NOT NULL DEFAULT 0.5,
          scope                 TEXT NOT NULL DEFAULT 'repo',
          trust_score           REAL NOT NULL DEFAULT 0.5,
          code_consistency_score REAL,
          verification_basis    TEXT,
          aspirational          INTEGER NOT NULL DEFAULT 0,
          extracted_at          TEXT NOT NULL DEFAULT (datetime('now'))
        );

        ALTER TABLE cards ADD COLUMN contributor_dev_id TEXT;
        ALTER TABLE cards ADD COLUMN source_conversation_id TEXT;
        ALTER TABLE cards ADD COLUMN expires_at TEXT;
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
