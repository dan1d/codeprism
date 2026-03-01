import type { FastifyInstance } from "fastify";
import { getDb } from "../db/connection.js";
import type { GeneratedDoc } from "../db/schema.js";
import { getLLMFromDb } from "../services/instance.js";
import {
  generateFlowDocs,
  docsGenerationState,
  type GenerateDocsOptions,
} from "../services/doc-generator.js";

export async function registerGeneratedDocsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/generated-docs?audience=user|dev&flow=<name>
  app.get("/api/generated-docs", (request, reply) => {
    const { audience, flow } = request.query as {
      audience?: string;
      flow?: string;
    };
    const db = getDb();

    let query = "SELECT * FROM generated_docs WHERE 1=1";
    const params: unknown[] = [];

    if (audience === "user" || audience === "dev") {
      query += " AND audience = ?";
      params.push(audience);
    }
    if (flow) {
      query += " AND flow = ?";
      params.push(flow);
    }
    query += " ORDER BY flow ASC, audience ASC";

    const docs = db.prepare(query).all(...params) as GeneratedDoc[];
    return reply.send(docs);
  });

  // GET /api/generated-docs/status
  // Must be registered before /:id to avoid "status" being treated as an ID
  app.get("/api/generated-docs/status", (_request, reply) => {
    return reply.send(docsGenerationState);
  });

  // GET /api/generated-docs/:id
  app.get<{ Params: { id: string } }>("/api/generated-docs/:id", (request, reply) => {
    const db = getDb();
    const doc = db
      .prepare("SELECT * FROM generated_docs WHERE id = ?")
      .get(request.params.id) as GeneratedDoc | undefined;
    if (!doc) return reply.code(404).send({ error: "Doc not found" });
    return reply.send(doc);
  });

  // POST /api/generated-docs/generate
  // Body: { flow?: string, audience?: "user" | "dev" | "both", force?: boolean }
  // Fires generation in the background — caller polls /status for progress.
  app.post<{
    Body: { flow?: string; audience?: "user" | "dev" | "both"; force?: boolean };
  }>("/api/generated-docs/generate", async (request, reply) => {
    const llm = getLLMFromDb();
    if (!llm) {
      return reply.code(503).send({
        error: "LLM not configured. Set llm_provider and llm_api_key in Settings.",
      });
    }

    if (docsGenerationState.status === "running") {
      return reply.code(409).send({
        error: "Documentation generation is already in progress.",
        state: docsGenerationState,
      });
    }

    const { flow, audience = "both", force = false } = request.body ?? {};
    const opts: GenerateDocsOptions = { flowFilter: flow, audience, force };

    void generateFlowDocs(opts).catch((err: unknown) => {
      console.error("[generate-docs] Background generation failed:", err);
    });

    const message = flow
      ? `Generating docs for "${flow}" (${audience})…`
      : `Generating docs for all flows (${audience})…`;

    return reply.code(202).send({ ok: true, message });
  });
}
