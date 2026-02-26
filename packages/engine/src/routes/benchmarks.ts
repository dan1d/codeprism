import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  submitBenchmark as submitBenchmarkJob,
  getQueueStatus,
  getBenchmarkProject,
  openBenchmarkDb,
  type LLMConfig,
} from "../services/benchmark-worker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Benchmark submission, queue status, sandbox search, and results routes. */
export async function registerBenchmarkRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { url: string; provider?: string; apiKey?: string; model?: string } }>(
    "/api/benchmarks/submit",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { url, provider, apiKey, model } = request.body ?? {};
      if (!url || typeof url !== "string") {
        return reply.code(400).send({ queued: false, error: "url is required" });
      }

      const githubMatch = url.match(/github\.com\/([^/]+\/[^/]+)/);
      if (!githubMatch) {
        return reply.code(400).send({ queued: false, error: "Must be a valid GitHub repository URL" });
      }

      const validProviders = ["gemini", "openai", "deepseek", "anthropic"];
      let llmConfig: LLMConfig | undefined;
      if (apiKey && provider) {
        if (!validProviders.includes(provider)) {
          return reply.code(400).send({
            queued: false,
            error: `Invalid provider. Must be one of: ${validProviders.join(", ")}`,
          });
        }
        llmConfig = {
          provider: provider as LLMConfig["provider"],
          apiKey,
          model: typeof model === "string" && model.trim() ? model.trim() : undefined,
        };
      }

      const result = await submitBenchmarkJob(url, llmConfig);
      return reply.code(result.queued ? 202 : 200).send(result);
    },
  );

  app.get("/api/benchmarks/queue", async (_request, reply) => {
    return reply.send(getQueueStatus());
  });

  app.post<{ Body: { query: string; repo?: string } }>(
    "/api/benchmarks/sandbox",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { query, repo } = request.body ?? {};
      if (!query || typeof query !== "string" || query.trim().length < 3) {
        return reply.code(400).send({ error: "query is required (min 3 characters)" });
      }
      if (!repo) {
        return reply.code(400).send({ error: "repo is required" });
      }

      const db = openBenchmarkDb(repo);
      if (!db) {
        return reply.code(404).send({ error: "No indexed data found for this project. Submit it for benchmarking first." });
      }

      try {
        const start = Date.now();
        const searchTerm = query.trim().replace(/[^a-zA-Z0-9\s]/g, "");

        type CardRow = {
          id: string; title: string; flow: string;
          card_type: string; content: string; source_files: string;
        };
        let cardRows: CardRow[] = [];
        try {
          cardRows = db
            .prepare(
              "SELECT c.id, c.title, c.flow, c.card_type, c.content, c.source_files " +
              "FROM cards_fts f JOIN cards c ON c.rowid = f.rowid " +
              "WHERE cards_fts MATCH ? AND c.stale = 0 LIMIT 5",
            )
            .all(searchTerm) as CardRow[];
        } catch { /* FTS table may not exist in benchmark DB */ }

        if (cardRows.length === 0) {
          try {
            cardRows = db
              .prepare("SELECT id, title, flow, card_type, content, source_files FROM cards WHERE stale = 0 ORDER BY updated_at DESC LIMIT 5")
              .all() as CardRow[];
          } catch { /* no cards table */ }
        }

        const latencyMs = Date.now() - start;
        const allSourceFiles = new Set<string>();

        const cards = cardRows.map((c) => {
          let sourceFiles: string[] = [];
          try { sourceFiles = JSON.parse(c.source_files || "[]"); } catch { /* ignore */ }
          sourceFiles.forEach((f) => allSourceFiles.add(f));
          return {
            id: c.id, title: c.title, flow: c.flow, cardType: c.card_type,
            content: c.content, sourceFiles: sourceFiles.slice(0, 8),
          };
        });

        const formattedContext = cards
          .map((c) => `## ${c.title}\n**Flow:** ${c.flow}\n**Files:** ${c.sourceFiles.join(", ")}\n\n${c.content}`)
          .join("\n\n---\n\n");
        const codeprismTokens = Math.ceil(formattedContext.length / 4);
        const naiveFiles = allSourceFiles.size;
        const naiveTokens = naiveFiles * 500;

        return reply.send({
          query: query.trim(), cards, formattedContext, latencyMs, cacheHit: false,
          codeprismTokens, naiveFiles, naiveTokens,
          tokenReduction: naiveTokens > 0 ? Math.round((1 - codeprismTokens / naiveTokens) * 100) : 0,
        });
      } finally {
        db.close();
      }
    },
  );

  app.get<{ Params: { slug: string } }>("/api/benchmarks/:slug", async (request, reply) => {
    const project = getBenchmarkProject(request.params.slug);
    if (!project) return reply.code(404).send({ error: "Project not found" });
    return reply.send(project);
  });

  app.get("/api/benchmarks", async (_request, reply) => {
    const benchPath = join(__dirname, "../../../../eval/benchmarks.json");
    let benchData = null;
    try {
      benchData = JSON.parse(await readFile(benchPath, "utf-8"));
    } catch { /* no benchmark file yet */ }
    return reply.send({ benchmarks: benchData });
  });
}
