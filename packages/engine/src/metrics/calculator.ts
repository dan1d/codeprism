import { getDb } from "../db/connection.js";

export interface MetricsSummary {
  totalQueries: number;
  cacheHits: number;
  cacheHitRate: number;
  totalCards: number;
  totalFlows: number;
  staleCards: number;
  estimatedTokensSaved: number;
  estimatedCostSaved: number;
  topQueries: Array<{ query: string; count: number }>;
  topCards: Array<{ cardId: string; title: string; flow: string; usageCount: number }>;
  queriesByDay: Array<{ date: string; total: number; cacheHits: number }>;
  devStats: Array<{ devId: string; queries: number; cacheHits: number }>;
}

const AVG_TOKENS_PER_CACHE_HIT = 5000;
const COST_PER_1K_TOKENS = 0.003;

/**
 * Computes aggregate metrics from the metrics and cards tables.
 * An optional date-range filter narrows results to a specific period.
 */
export function calculateMetrics(period?: { from?: string; to?: string }): MetricsSummary {
  const db = getDb();

  const dateClause = buildDateClause(period);
  const dateParams = buildDateParams(period);

  const { totalQueries } = db
    .prepare(`SELECT COUNT(*) AS totalQueries FROM metrics ${dateClause}`)
    .get(...dateParams) as { totalQueries: number };

  const { cacheHits } = db
    .prepare(`SELECT COUNT(*) AS cacheHits FROM metrics WHERE cache_hit = 1 ${dateClause ? dateClause.replace("WHERE", "AND") : ""}`)
    .get(...dateParams) as { cacheHits: number };

  const cacheHitRate = totalQueries > 0 ? cacheHits / totalQueries : 0;

  const { totalCards } = db
    .prepare("SELECT COUNT(*) AS totalCards FROM cards")
    .get() as { totalCards: number };

  const { totalFlows } = db
    .prepare("SELECT COUNT(DISTINCT flow) AS totalFlows FROM cards")
    .get() as { totalFlows: number };

  const { staleCards } = db
    .prepare("SELECT COUNT(*) AS staleCards FROM cards WHERE stale = 1")
    .get() as { staleCards: number };

  const estimatedTokensSaved = cacheHits * AVG_TOKENS_PER_CACHE_HIT;
  const estimatedCostSaved = (estimatedTokensSaved * COST_PER_1K_TOKENS) / 1000;

  const topQueries = db
    .prepare(
      `SELECT query, COUNT(*) AS count FROM metrics ${dateClause} GROUP BY query ORDER BY count DESC LIMIT 10`,
    )
    .all(...dateParams) as Array<{ query: string; count: number }>;

  const topCards = db
    .prepare(
      "SELECT id AS cardId, title, flow, usage_count AS usageCount FROM cards ORDER BY usage_count DESC LIMIT 10",
    )
    .all() as Array<{ cardId: string; title: string; flow: string; usageCount: number }>;

  const queriesByDay = db
    .prepare(
      `SELECT
        date(timestamp) AS date,
        COUNT(*) AS total,
        SUM(CASE WHEN cache_hit = 1 THEN 1 ELSE 0 END) AS cacheHits
      FROM metrics
      WHERE timestamp >= date('now', '-30 days')
      ${dateClause ? dateClause.replace("WHERE", "AND") : ""}
      GROUP BY date(timestamp)
      ORDER BY date`,
    )
    .all(...dateParams) as Array<{ date: string; total: number; cacheHits: number }>;

  const devStats = db
    .prepare(
      `SELECT
        dev_id AS devId,
        COUNT(*) AS queries,
        SUM(CASE WHEN cache_hit = 1 THEN 1 ELSE 0 END) AS cacheHits
      FROM metrics
      WHERE dev_id IS NOT NULL
      ${dateClause ? dateClause.replace("WHERE", "AND") : ""}
      GROUP BY dev_id`,
    )
    .all(...dateParams) as Array<{ devId: string; queries: number; cacheHits: number }>;

  return {
    totalQueries,
    cacheHits,
    cacheHitRate,
    totalCards,
    totalFlows,
    staleCards,
    estimatedTokensSaved,
    estimatedCostSaved,
    topQueries,
    topCards,
    queriesByDay,
    devStats,
  };
}

function buildDateClause(period?: { from?: string; to?: string }): string {
  if (!period) return "";
  const parts: string[] = [];
  if (period.from) parts.push("timestamp >= ?");
  if (period.to) parts.push("timestamp < ?");
  return parts.length > 0 ? `WHERE ${parts.join(" AND ")}` : "";
}

function buildDateParams(period?: { from?: string; to?: string }): string[] {
  if (!period) return [];
  const params: string[] = [];
  if (period.from) params.push(period.from);
  if (period.to) params.push(period.to);
  return params;
}
