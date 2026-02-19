import type { FastifyInstance } from "fastify";
import { getDb } from "../db/connection.js";
import type { Card } from "../db/schema.js";
import { calculateMetrics } from "./calculator.js";

/**
 * Registers REST endpoints that power the srcmap dashboard UI.
 */
export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/metrics/summary", (request, reply) => {
    const { from, to } = request.query as { from?: string; to?: string };

    const period =
      from || to ? { from: from || undefined, to: to || undefined } : undefined;

    const summary = calculateMetrics(period);
    return reply.send(summary);
  });

  app.get("/api/cards", (request, reply) => {
    const { flow } = request.query as { flow?: string };
    const db = getDb();

    if (flow) {
      const cards = db
        .prepare("SELECT * FROM cards WHERE flow = ? ORDER BY updated_at DESC")
        .all(flow) as Card[];
      return reply.send(cards);
    }

    const cards = db
      .prepare("SELECT * FROM cards ORDER BY updated_at DESC")
      .all() as Card[];
    return reply.send(cards);
  });

  app.get<{ Params: { id: string } }>("/api/cards/:id", (request, reply) => {
    const db = getDb();
    const card = db.prepare("SELECT * FROM cards WHERE id = ?").get(request.params.id) as
      | Card
      | undefined;

    if (!card) {
      return reply.status(404).send({ error: "Card not found" });
    }

    return reply.send(card);
  });

  app.get("/api/flows", (_request, reply) => {
    const db = getDb();

    const flows = db
      .prepare(
        `SELECT
          flow,
          COUNT(*) AS cardCount,
          COUNT(DISTINCT json_each.value) AS fileCount
        FROM cards, json_each(cards.source_files)
        GROUP BY flow
        ORDER BY cardCount DESC`,
      )
      .all() as Array<{ flow: string; cardCount: number; fileCount: number }>;

    return reply.send(flows);
  });

  app.get<{ Params: { repo: string } }>("/api/branches/:repo", (request, reply) => {
    const db = getDb();

    const branches = db
      .prepare(
        `SELECT
          branch,
          event_type,
          from_branch,
          MAX(timestamp) AS lastSeen,
          COUNT(*) AS eventCount
        FROM branch_events
        WHERE repo = ?
        GROUP BY branch, event_type
        ORDER BY lastSeen DESC`,
      )
      .all(request.params.repo) as Array<{
      branch: string;
      event_type: string;
      from_branch: string | null;
      lastSeen: string;
      eventCount: number;
    }>;

    return reply.send(branches);
  });
}
