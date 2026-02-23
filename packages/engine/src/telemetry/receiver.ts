import Database from "better-sqlite3";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { getDataDir } from "../db/connection.js";

interface TelemetryPayload {
  instance_id: string;
  version?: string;
  stats: {
    total_cards?: number;
    total_flows?: number;
    total_queries?: number;
    cache_hit_rate?: number;
    tokens_saved_estimate?: number;
    repos_indexed?: number;
    avg_latency_ms?: number;
  };
}

let aggDb: InstanceType<typeof Database> | null = null;

function getAggregateDb(): InstanceType<typeof Database> {
  if (aggDb) return aggDb;
  const dataDir = getDataDir();
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "aggregate.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS telemetry (
      instance_id TEXT PRIMARY KEY,
      version TEXT,
      stats_json TEXT NOT NULL,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      report_count INTEGER NOT NULL DEFAULT 1
    )
  `);
  aggDb = db;
  return db;
}

export function receiveTelemetry(payload: TelemetryPayload): void {
  const db = getAggregateDb();
  db.prepare(
    `
    INSERT INTO telemetry (instance_id, version, stats_json)
    VALUES (?, ?, ?)
    ON CONFLICT(instance_id) DO UPDATE SET
      version = excluded.version,
      stats_json = excluded.stats_json,
      last_seen_at = datetime('now'),
      report_count = report_count + 1
  `,
  ).run(
    payload.instance_id,
    payload.version ?? null,
    JSON.stringify(payload.stats),
  );
}

export function getAggregateStats(): {
  activeInstances: number;
  totalTokensSaved: number;
  totalQueries: number;
  totalCards: number;
  avgCacheHitRate: number;
} {
  const db = getAggregateDb();
  const rows = db
    .prepare(
      "SELECT stats_json FROM telemetry WHERE last_seen_at > datetime('now', '-7 days')",
    )
    .all() as { stats_json: string }[];

  let totalTokensSaved = 0,
    totalQueries = 0,
    totalCards = 0;
  let cacheHitSum = 0,
    cacheHitCount = 0;

  for (const row of rows) {
    try {
      const stats = JSON.parse(row.stats_json);
      totalTokensSaved += stats.tokens_saved_estimate ?? 0;
      totalQueries += stats.total_queries ?? 0;
      totalCards += stats.total_cards ?? 0;
      if (stats.cache_hit_rate != null) {
        cacheHitSum += stats.cache_hit_rate;
        cacheHitCount++;
      }
    } catch {
      /* skip malformed rows */
    }
  }

  return {
    activeInstances: rows.length,
    totalTokensSaved,
    totalQueries,
    totalCards,
    avgCacheHitRate: cacheHitCount > 0 ? cacheHitSum / cacheHitCount : 0,
  };
}
