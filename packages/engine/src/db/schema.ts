import type { Database } from "better-sqlite3";

/* ------------------------------------------------------------------ */
/*  Domain types                                                       */
/* ------------------------------------------------------------------ */

export interface Card {
  id: string;
  flow: string;
  title: string;
  content: string;
  card_type: string;
  source_files: string;
  source_repos: string;
  tags: string;
  valid_branches: string | null;
  commit_sha: string | null;
  created_by: string | null;
  stale: number;
  usage_count: number;
  specificity_score: number;
  /** Space-separated class names and route signatures for BM25 identifier matching. */
  identifiers: string;
  created_at: string;
  updated_at: string;
}

export interface FileIndexEntry {
  path: string;
  repo: string;
  branch: string;
  commit_sha: string;
  parsed_data: string;
  /** Normalized git commit frequency 0.0 (cold) – 1.0 (hot). Migration v18. */
  heat_score: number;
  updated_at: string;
}

export interface GraphEdge {
  id: number;
  source_file: string;
  target_file: string;
  relation: string;
  metadata: string;
  repo: string;
}

export interface Metric {
  id: number;
  timestamp: string;
  dev_id: string | null;
  query: string;
  query_embedding: Buffer | null;
  response_cards: string;
  response_tokens: number;
  cache_hit: number;
  latency_ms: number;
  branch: string | null;
}

export interface BranchEvent {
  id: number;
  timestamp: string;
  dev_id: string | null;
  repo: string;
  branch: string;
  event_type: string;
  from_branch: string | null;
  commit_sha: string | null;
}

export interface ProjectDoc {
  id: string;
  repo: string;
  doc_type:
    | "readme"
    | "about"
    | "architecture"
    | "code_style"
    | "rules"
    | "styles"
    | "api_contracts"
    | "specialist"
    | "changelog"
    | "memory"
    | "pages"
    | "be_overview";
  title: string;
  content: string;
  stale: number;
  source_file_paths: string; // JSON array of file paths used to generate this doc
  /** SHA-1 of the frameworkBaseline string used during generation.
   *  TODO: populate in upsertDoc once baseline-staleness detection is implemented (migration v17). */
  applied_baseline_hash?: string | null;
  /** Filesystem path where this doc was last written under /ai-srcmap/. Migration v18. */
  file_path?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TranscriptImport {
  id: string;
  file_path: string;
  content_hash: string;
  imported_at: string;
  source_type: "cursor" | "claude_code" | "markdown";
}

export interface ExtractedInsight {
  id: string;
  transcript_id: string;
  card_id: string | null;
  category: "coding_rule" | "anti_pattern" | "architecture_decision" | "domain_knowledge" | "team_preference" | "gotcha";
  statement: string;
  evidence_quote: string;
  confidence: number;
  scope: string;
  trust_score: number;
  code_consistency_score: number | null;
  verification_basis: string | null;
  aspirational: number;
  extracted_at: string;
}

export interface TeamRule {
  id: string;
  name: string;
  description: string;
  severity: "error" | "warning" | "info";
  scope: string | null;     // null = all repos/languages; e.g. "rails", "react"
  enabled: number;          // 1 | 0
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RuleViolation {
  rule_id: string;
  rule_name: string;
  severity: "error" | "warning" | "info";
  file: string;
  line: number | null;
  snippet: string;
  explanation: string;
}

export interface RuleCheckResult {
  violations: RuleViolation[];
  checked_rules: number;
  files_checked: number;
  passed: boolean;
}

export interface RepoProfile {
  repo: string;
  primary_language: string;
  frameworks: string; // JSON array
  is_lambda: number; // 0 | 1
  package_manager: string;
  skill_ids: string; // JSON array
  detected_at: string;
}

export interface CardInteraction {
  id: number;
  timestamp: string;
  query: string;
  card_id: string;
  outcome: "viewed" | "insight_saved";
  session_id: string | null;
}

/* ------------------------------------------------------------------ */
/*  Schema creation                                                    */
/* ------------------------------------------------------------------ */

const TABLES = `
CREATE TABLE IF NOT EXISTS schema_version (
  version     INTEGER PRIMARY KEY,
  applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Cards ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cards (
  id                     TEXT PRIMARY KEY,
  flow                   TEXT NOT NULL,
  title                  TEXT NOT NULL,
  content                TEXT NOT NULL,
  card_type              TEXT NOT NULL DEFAULT 'auto_generated',
  source_files           TEXT NOT NULL DEFAULT '[]',
  source_repos           TEXT NOT NULL DEFAULT '[]',
  tags                   TEXT NOT NULL DEFAULT '[]',
  identifiers            TEXT NOT NULL DEFAULT '',
  valid_branches         TEXT,
  commit_sha             TEXT,
  source_commit          TEXT,
  content_hash           TEXT,
  created_by             TEXT,
  contributor_dev_id     TEXT,
  source_conversation_id TEXT,
  expires_at             TEXT,
  stale                  INTEGER NOT NULL DEFAULT 0,
  usage_count            INTEGER NOT NULL DEFAULT 0,
  specificity_score      REAL    NOT NULL DEFAULT 0.5,
  verified_at            TEXT,
  verification_count     INTEGER NOT NULL DEFAULT 0,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── File index ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS file_index (
  path        TEXT NOT NULL,
  repo        TEXT NOT NULL,
  branch      TEXT NOT NULL DEFAULT 'main',
  commit_sha  TEXT NOT NULL DEFAULT '',
  parsed_data TEXT NOT NULL DEFAULT '{}',
  file_role   TEXT NOT NULL DEFAULT 'domain',
  heat_score  REAL          DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (path, repo, branch)
);

-- ── Graph ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS graph_edges (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source_file TEXT NOT NULL,
  target_file TEXT NOT NULL,
  relation    TEXT NOT NULL,
  metadata    TEXT DEFAULT '{}',
  repo        TEXT NOT NULL
);

-- ── Metrics & branch events ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metrics (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp       TEXT NOT NULL DEFAULT (datetime('now')),
  dev_id          TEXT,
  query           TEXT NOT NULL,
  query_embedding BLOB,
  response_cards  TEXT    DEFAULT '[]',
  response_tokens INTEGER DEFAULT 0,
  cache_hit       INTEGER DEFAULT 0,
  latency_ms      INTEGER DEFAULT 0,
  branch          TEXT
);

CREATE TABLE IF NOT EXISTS branch_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp  TEXT NOT NULL DEFAULT (datetime('now')),
  dev_id     TEXT,
  repo       TEXT NOT NULL,
  branch     TEXT NOT NULL,
  event_type TEXT NOT NULL,
  from_branch TEXT,
  commit_sha  TEXT
);

CREATE TABLE IF NOT EXISTS card_interactions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp  TEXT NOT NULL DEFAULT (datetime('now')),
  query      TEXT NOT NULL,
  card_id    TEXT NOT NULL,
  outcome    TEXT NOT NULL DEFAULT 'viewed',
  session_id TEXT
);

-- ── Config & repo metadata ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS search_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS repo_profiles (
  repo             TEXT PRIMARY KEY,
  primary_language TEXT NOT NULL DEFAULT '',
  frameworks       TEXT NOT NULL DEFAULT '[]',
  is_lambda        INTEGER NOT NULL DEFAULT 0,
  package_manager  TEXT NOT NULL DEFAULT '',
  skill_ids        TEXT NOT NULL DEFAULT '[]',
  detected_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS repo_signals (
  repo          TEXT PRIMARY KEY,
  signals       TEXT NOT NULL DEFAULT '[]',
  signal_source TEXT NOT NULL DEFAULT 'derived',
  locked        INTEGER NOT NULL DEFAULT 0,
  generated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS instance_profile (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  company_name TEXT NOT NULL DEFAULT '',
  plan         TEXT NOT NULL DEFAULT 'self_hosted',
  instance_id  TEXT NOT NULL DEFAULT (lower(hex(randomblob(8)))),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO instance_profile (id) VALUES (1);

-- ── Project docs ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_docs (
  id                   TEXT PRIMARY KEY,
  repo                 TEXT NOT NULL,
  doc_type             TEXT NOT NULL,
  title                TEXT NOT NULL,
  content              TEXT NOT NULL,
  stale                INTEGER NOT NULL DEFAULT 0,
  source_file_paths    TEXT NOT NULL DEFAULT '[]',
  applied_baseline_hash TEXT,
  file_path            TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Evaluation ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS eval_cases (
  id               TEXT PRIMARY KEY,
  query            TEXT NOT NULL,
  expected_card_id TEXT NOT NULL,
  source           TEXT NOT NULL DEFAULT 'synthetic',
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Conversation intelligence ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transcript_imports (
  id           TEXT PRIMARY KEY,
  file_path    TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE,
  imported_at  TEXT NOT NULL DEFAULT (datetime('now')),
  source_type  TEXT NOT NULL DEFAULT 'cursor'
);

CREATE TABLE IF NOT EXISTS transcript_pr_links (
  id            TEXT PRIMARY KEY,
  transcript_id TEXT NOT NULL REFERENCES transcript_imports(id),
  repo          TEXT NOT NULL,
  commit_sha    TEXT,
  pr_number     TEXT,
  matched_files TEXT NOT NULL DEFAULT '[]',
  status        TEXT NOT NULL DEFAULT 'unknown',
  linked_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS extracted_insights (
  id                     TEXT PRIMARY KEY,
  transcript_id          TEXT NOT NULL REFERENCES transcript_imports(id),
  card_id                TEXT,
  category               TEXT NOT NULL,
  statement              TEXT NOT NULL,
  evidence_quote         TEXT NOT NULL,
  confidence             REAL NOT NULL DEFAULT 0.5,
  scope                  TEXT NOT NULL DEFAULT 'repo',
  trust_score            REAL NOT NULL DEFAULT 0.5,
  code_consistency_score REAL,
  verification_basis     TEXT,
  aspirational           INTEGER NOT NULL DEFAULT 0,
  extracted_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Team Rules ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_rules (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'warning',
  scope       TEXT,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rule_checks (
  id            TEXT PRIMARY KEY,
  repo          TEXT NOT NULL,
  branch        TEXT NOT NULL,
  base_branch   TEXT NOT NULL DEFAULT 'main',
  commit_sha    TEXT,
  violations    TEXT NOT NULL DEFAULT '[]',
  checked_rules INTEGER NOT NULL DEFAULT 0,
  files_checked INTEGER NOT NULL DEFAULT 0,
  passed        INTEGER NOT NULL DEFAULT 1,
  triggered_by  TEXT,
  checked_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const FTS = `
CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
  title, content, flow, source_repos, tags, identifiers,
  content=cards, content_rowid=rowid,
  tokenize='porter unicode61'
);
`;

const VIRTUAL = `
CREATE VIRTUAL TABLE IF NOT EXISTS card_embeddings USING vec0(
  card_id   TEXT,
  embedding FLOAT[768]
);

CREATE VIRTUAL TABLE IF NOT EXISTS card_title_embeddings USING vec0(
  card_id   TEXT,
  embedding FLOAT[768]
);
`;

const INDICES = `
CREATE INDEX IF NOT EXISTS idx_cards_flow
  ON cards(flow);
CREATE INDEX IF NOT EXISTS idx_file_index_repo
  ON file_index(repo);
CREATE INDEX IF NOT EXISTS idx_graph_edges_source
  ON graph_edges(source_file);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target
  ON graph_edges(target_file);
CREATE INDEX IF NOT EXISTS idx_metrics_timestamp
  ON metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_card_interactions_card_id
  ON card_interactions(card_id);
CREATE INDEX IF NOT EXISTS idx_card_interactions_timestamp
  ON card_interactions(timestamp);
CREATE UNIQUE INDEX IF NOT EXISTS project_docs_repo_type
  ON project_docs(repo, doc_type);
CREATE INDEX IF NOT EXISTS idx_eval_cases_card
  ON eval_cases(expected_card_id);
CREATE INDEX IF NOT EXISTS idx_team_rules_enabled
  ON team_rules(enabled);
CREATE INDEX IF NOT EXISTS idx_rule_checks_repo_checked_at
  ON rule_checks(repo, checked_at);
`;

/**
 * Creates the complete canonical schema from scratch.
 * Virtual-table DDL (FTS5, vec0) runs outside the regular TABLES block since
 * SQLite does not allow creating virtual tables inside a transaction.
 */
export function initSchema(db: Database): void {
  db.exec(TABLES);
  db.exec(FTS);
  try {
    db.exec(VIRTUAL);
  } catch {
    // sqlite-vec may not be loaded in all environments (e.g. CI without the
    // native binary). FTS and regular tables still work correctly without it.
  }
  db.exec(INDICES);
}
