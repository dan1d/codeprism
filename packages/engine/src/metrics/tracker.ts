import { getDb } from "../db/connection.js";

export interface ToolCallMetric {
  query: string;
  queryEmbedding?: Buffer | null;
  responseCards: string[];
  responseTokens: number;
  cacheHit: boolean;
  latencyMs: number;
  branch?: string;
  devId?: string;
}

const INSERT_SQL = `
  INSERT INTO metrics (query, query_embedding, response_cards, response_tokens, cache_hit, latency_ms, branch, dev_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;

/**
 * Logs a single MCP tool call to the metrics table.
 * Serializes `responseCards` as JSON and converts `cacheHit` to a 0/1 integer
 * for SQLite storage.
 */
export function trackToolCall(metric: ToolCallMetric): void {
  const db = getDb();

  db.prepare(INSERT_SQL).run(
    metric.query,
    metric.queryEmbedding ?? null,
    JSON.stringify(metric.responseCards),
    metric.responseTokens,
    metric.cacheHit ? 1 : 0,
    metric.latencyMs,
    metric.branch ?? null,
    metric.devId ?? null,
  );
}

const RECENT_QUERIES_SQL = `
  SELECT query, query_embedding AS embedding, timestamp
  FROM metrics
  ORDER BY timestamp DESC
  LIMIT ?
`;

/**
 * Returns the most recent queries with their embeddings, ordered newest-first.
 * Useful for semantic cache comparison against incoming queries.
 */
export function getRecentQueries(
  limit = 100,
): Array<{ query: string; embedding: Buffer | null; timestamp: string }> {
  const db = getDb();

  return db.prepare(RECENT_QUERIES_SQL).all(limit) as Array<{
    query: string;
    embedding: Buffer | null;
    timestamp: string;
  }>;
}
