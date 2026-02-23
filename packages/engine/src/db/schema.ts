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
    | "memory";
  title: string;
  content: string;
  stale: number;
  source_file_paths: string; // JSON array of file paths used to generate this doc
  created_at: string;
  updated_at: string;
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
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  flow TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  card_type TEXT NOT NULL DEFAULT 'auto_generated',
  source_files TEXT NOT NULL DEFAULT '[]',
  source_repos TEXT NOT NULL DEFAULT '[]',
  valid_branches TEXT,
  commit_sha TEXT,
  created_by TEXT,
  stale INTEGER DEFAULT 0,
  usage_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE IF NOT EXISTS card_embeddings USING vec0(
  card_id TEXT,
  embedding FLOAT[384]
);

CREATE TABLE IF NOT EXISTS file_index (
  path TEXT NOT NULL,
  repo TEXT NOT NULL,
  branch TEXT NOT NULL DEFAULT 'main',
  commit_sha TEXT NOT NULL DEFAULT '',
  parsed_data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (path, repo, branch)
);

CREATE TABLE IF NOT EXISTS graph_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_file TEXT NOT NULL,
  target_file TEXT NOT NULL,
  relation TEXT NOT NULL,
  metadata TEXT DEFAULT '{}',
  repo TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  dev_id TEXT,
  query TEXT NOT NULL,
  query_embedding BLOB,
  response_cards TEXT DEFAULT '[]',
  response_tokens INTEGER DEFAULT 0,
  cache_hit INTEGER DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  branch TEXT
);

CREATE TABLE IF NOT EXISTS branch_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  dev_id TEXT,
  repo TEXT NOT NULL,
  branch TEXT NOT NULL,
  event_type TEXT NOT NULL,
  from_branch TEXT,
  commit_sha TEXT
);

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const FTS = `
CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
  title, content, flow,
  content=cards, content_rowid=rowid
);
`;

const INDICES = `
CREATE INDEX IF NOT EXISTS idx_cards_flow ON cards(flow);
CREATE INDEX IF NOT EXISTS idx_file_index_repo ON file_index(repo);
CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_file);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_file);
CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp);
`;

/**
 * Creates all tables, virtual tables, and indices if they don't already exist.
 * Wraps regular DDL in a transaction; virtual-table DDL runs outside since
 * SQLite does not support creating virtual tables inside transactions.
 */
export function initSchema(db: Database): void {
  db.exec(TABLES);
  db.exec(FTS);
  db.exec(INDICES);
}
