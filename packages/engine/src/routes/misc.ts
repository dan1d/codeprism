import type { FastifyInstance } from "fastify";
import { getDb } from "../db/connection.js";
import { receiveTelemetry } from "../telemetry/receiver.js";
import { getAggregateStats } from "../telemetry/receiver.js";
import { handleSync } from "../sync/receiver.js";
import type { SyncPayload } from "../sync/receiver.js";

/** Sync, health, telemetry, and public-stats routes. */
export async function registerMiscRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: SyncPayload }>("/api/sync", async (request, reply) => {
    const result = await handleSync(request.body);
    return reply.send(result);
  });

  app.get("/api/health", async (_request, reply) => {
    const db = getDb();
    const cardsRow = db.prepare("SELECT COUNT(*) AS count FROM cards").get() as { count: number };
    const flowsRow = db.prepare("SELECT COUNT(DISTINCT flow) AS count FROM cards").get() as { count: number };
    return reply.send({ status: "ok", cards: cardsRow.count, flows: flowsRow.count });
  });

  app.post<{ Body: unknown }>(
    "/api/telemetry",
    { bodyLimit: 16_384 },
    async (request, reply) => {
      const body = request.body as Record<string, unknown> | undefined;
      if (
        !body ||
        typeof body !== "object" ||
        typeof body.instance_id !== "string" ||
        !body.stats ||
        typeof body.stats !== "object"
      ) {
        return reply.code(400).send({ error: "Invalid telemetry payload" });
      }
      try {
        receiveTelemetry(body as unknown as Parameters<typeof receiveTelemetry>[0]);
      } catch { /* telemetry is non-critical, never fail the caller */ }
      return reply.send({ ok: true });
    },
  );

  app.get("/api/public-stats", async (_request, reply) => {
    try {
      return reply.send(getAggregateStats());
    } catch {
      return reply.send({
        activeInstances: 0, totalTokensSaved: 0,
        totalQueries: 0, totalCards: 0, avgCacheHitRate: 0,
      });
    }
  });
}
