import { getDb } from "../db/connection.js";

const TELEMETRY_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
let timer: ReturnType<typeof setInterval> | null = null;

interface TelemetryPayload {
  instance_id: string;
  version: string;
  stats: {
    total_cards: number;
    total_flows: number;
    total_queries: number;
    cache_hit_rate: number;
    tokens_saved_estimate: number;
    repos_indexed: number;
    avg_latency_ms: number;
  };
}

function collectStats(): TelemetryPayload {
  const db = getDb();

  const { instanceId } = db
    .prepare(
      "SELECT instance_id as instanceId FROM instance_profile WHERE id = 1",
    )
    .get() as { instanceId: string };

  const { totalCards } = db
    .prepare("SELECT COUNT(*) as totalCards FROM cards WHERE stale = 0")
    .get() as { totalCards: number };

  const { totalFlows } = db
    .prepare(
      "SELECT COUNT(DISTINCT flow) as totalFlows FROM cards WHERE stale = 0",
    )
    .get() as { totalFlows: number };

  const metricsStats = db
    .prepare(
      `
    SELECT
      COUNT(*) as totalQueries,
      COALESCE(AVG(CASE WHEN cache_hit = 1 THEN 1.0 ELSE 0.0 END), 0) as cacheHitRate,
      COALESCE(SUM(response_tokens), 0) as totalResponseTokens,
      COALESCE(AVG(latency_ms), 0) as avgLatencyMs
    FROM metrics
  `,
    )
    .get() as {
    totalQueries: number;
    cacheHitRate: number;
    totalResponseTokens: number;
    avgLatencyMs: number;
  };

  const { reposIndexed } = db
    .prepare(
      "SELECT COUNT(DISTINCT repo) as reposIndexed FROM file_index",
    )
    .get() as { reposIndexed: number };

  // Token savings estimate: response_tokens * 35x expansion factor
  // (AI would read ~35x more tokens from raw files without srcmap cards)
  const tokensSaved = metricsStats.totalResponseTokens * 35;

  return {
    instance_id: instanceId,
    version: "0.1.0",
    stats: {
      total_cards: totalCards,
      total_flows: totalFlows,
      total_queries: metricsStats.totalQueries,
      cache_hit_rate: Math.round(metricsStats.cacheHitRate * 100) / 100,
      tokens_saved_estimate: tokensSaved,
      repos_indexed: reposIndexed,
      avg_latency_ms: Math.round(metricsStats.avgLatencyMs),
    },
  };
}

async function sendTelemetry(url: string): Promise<void> {
  try {
    const payload = collectStats();
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      console.log("[telemetry] Report sent successfully");
    }
  } catch {
    // Silently fail -- telemetry must never affect engine operation
  }
}

/**
 * Starts the opt-in telemetry reporter.
 *
 * Enabled by SRCMAP_TELEMETRY=true env var.
 * Sends daily anonymous stats to the configured URL.
 * Fails silently, never blocks the engine.
 */
export function startTelemetryReporter(): void {
  const enabled = process.env["SRCMAP_TELEMETRY"] === "true";
  if (!enabled) return;

  const url =
    process.env["SRCMAP_TELEMETRY_URL"] ?? "https://srcmap.ai/api/telemetry";
  console.log(`[telemetry] Opt-in telemetry enabled, reporting to ${url}`);

  // Send first report after 60 seconds (let the engine settle)
  setTimeout(() => sendTelemetry(url), 60_000);

  // Then every 24 hours
  timer = setInterval(() => sendTelemetry(url), TELEMETRY_INTERVAL_MS);
}

export function stopTelemetryReporter(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
