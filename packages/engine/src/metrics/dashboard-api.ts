import type { FastifyInstance } from "fastify";
import { calculateMetrics } from "./calculator.js";
import { getInstanceInfo, updateInstanceInfo, getSettings, updateSettings } from "../services/instance.js";
import { listRepos, getRepoOverview, getRepoBranches, getRepoSignals, getRegisteredRepos, registerRepo, unregisterRepo } from "../services/repos.js";
import { watchNewRepo, stopWatchingRepo } from "../watcher/index.js";
import { listCards, getCard, listFlows, searchCards } from "../services/cards.js";
import { listRules, insertTeamRule, updateRule, deleteRule, listRuleChecks, refineRule, importRules, runCheck } from "../services/rules.js";
import { storeCheckoutContext, getActiveContext, type CheckoutContextInput } from "../services/context.js";
import { listProjectDocs, refreshDocs, listKnowledgeFiles, saveKnowledgeFile } from "../services/docs.js";
import { reindexState, runIncrementalReindex, getStaleCardCount } from "../services/reindex.js";

export { type RepoSummary } from "../services/repos.js";
export { reindexState } from "../services/reindex.js";

export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  // Instance info
  app.get("/api/instance-info", (_req, reply) => reply.send(getInstanceInfo()));

  app.put("/api/instance-info", (request, reply) => {
    const { companyName, plan } = (request.body as { companyName?: string; plan?: string }) ?? {};
    return reply.send(updateInstanceInfo(companyName, plan));
  });

  // Repos
  app.get("/api/repos", (_req, reply) => reply.send(listRepos()));

  app.get("/api/repo-overview", (request, reply) => {
    const { repo } = request.query as { repo?: string };
    if (!repo) return reply.status(400).send({ error: "repo query param required" });
    return reply.send(getRepoOverview(repo));
  });

  app.get<{ Params: { repo: string } }>("/api/branches/:repo", (request, reply) => {
    return reply.send(getRepoBranches(request.params.repo));
  });

  app.get("/api/repo-signals", (_req, reply) => reply.send(getRepoSignals()));

  app.get("/api/repos/registered", (_req, reply) => reply.send(getRegisteredRepos()));

  app.post("/api/repos/register", (request, reply) => {
    const body = request.body as { name?: string; path?: string };
    if (!body.name || !body.path) {
      return reply.status(400).send({ error: "name and path are required" });
    }
    try {
      const result = registerRepo(body.name, body.path);
      // Start watching the new repo immediately — no restart needed
      watchNewRepo(result);
      const wasAlreadyRunning = reindexState.status === "running";
      if (!wasAlreadyRunning) runIncrementalReindex(result.name);
      return reply.status(201).send({
        ...result,
        reindexing: !wasAlreadyRunning,
        message: `Repository "${result.name}" registered.${!wasAlreadyRunning ? " Indexing started." : " Another reindex is already running."}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already registered")) return reply.status(409).send({ error: msg });
      return reply.status(400).send({ error: msg });
    }
  });

  app.delete<{ Params: { name: string } }>("/api/repos/register/:name", (request, reply) => {
    const { name } = request.params;
    unregisterRepo(name);
    stopWatchingRepo(name); // stop fs.watch callbacks for the removed repo
    return reply.send({ removed: name });
  });

  // Branch context — set automatically by the post-checkout git hook
  app.get("/api/context", (_req, reply) => {
    const ctx = getActiveContext();
    if (!ctx) return reply.status(404).send({ error: "No active context. Checkout a branch first." });
    return reply.send(ctx);
  });

  app.post("/api/context/checkout", (request, reply) => {
    const body = request.body as Partial<CheckoutContextInput>;
    if (!body.branch || !body.repo) {
      return reply.status(400).send({ error: "branch and repo are required" });
    }
    const ctx = storeCheckoutContext({
      branch:      body.branch,
      repo:        body.repo,
      ticketId:    body.ticketId ?? null,
      contextHint: body.contextHint ?? body.branch.replace(/[/_-]+/g, " ").trim(),
      epicBranch:  body.epicBranch ?? null,
    });
    return reply.send(ctx);
  });

  // Settings
  app.get("/api/settings", (_req, reply) => reply.send(getSettings()));

  app.put("/api/settings", (request, reply) => {
    updateSettings(request.body as Record<string, string>);
    return reply.send({ ok: true });
  });

  // Metrics
  app.get("/api/metrics/summary", (request, reply) => {
    const { from, to } = request.query as { from?: string; to?: string };
    const period = from || to ? { from: from || undefined, to: to || undefined } : undefined;
    return reply.send(calculateMetrics(period));
  });

  // Cards
  app.get("/api/cards", (request, reply) => {
    const { flow } = request.query as { flow?: string };
    return reply.send(listCards(flow));
  });

  app.get<{ Params: { id: string } }>("/api/cards/:id", (request, reply) => {
    const card = getCard(request.params.id);
    if (!card) return reply.status(404).send({ error: "Card not found" });
    return reply.send(card);
  });

  app.get("/api/flows", (_req, reply) => reply.send(listFlows()));

  app.get("/api/search", async (request, reply) => {
    const { q, limit } = request.query as { q?: string; limit?: string };
    if (!q || q.trim() === "") return reply.status(400).send({ error: "Missing required query param: q" });
    try {
      const results = await searchCards(q, parseInt(limit ?? "10", 10) || 10);
      return reply.send({ query: q, results });
    } catch (err) {
      return reply.status(500).send({ error: String(err) });
    }
  });

  // Project docs
  app.get("/api/project-docs", (request, reply) => {
    const { repo, type } = request.query as { repo?: string; type?: string };
    return reply.send(listProjectDocs(repo, type));
  });

  app.post("/api/refresh", async (request, reply) => {
    const { repo } = (request.body as { repo?: string }) ?? {};
    try {
      const result = await refreshDocs(repo);
      if (result.refreshed === 0 && result.skipped === 0) {
        return reply.send({ ...result, message: "No stale docs found." });
      }
      return reply.send(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(503).send({ error: msg });
    }
  });

  // Knowledge files
  app.get("/api/knowledge-files", async (_req, reply) => reply.send(await listKnowledgeFiles()));

  app.post("/api/knowledge-files", async (request, reply) => {
    const body = request.body as { skillId?: string; content?: string };
    if (!body.skillId || !body.content) {
      return reply.status(400).send({ error: "skillId and content are required" });
    }
    try {
      const result = await saveKnowledgeFile(body.skillId, body.content);
      return reply.status(201).send({
        ...result,
        message: "Knowledge file written. It will be loaded on next codeprism index run.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = msg.includes("exceeds") ? 413 : 400;
      return reply.status(code).send({ error: msg });
    }
  });

  // Reindex
  app.get("/api/reindex-status", (_req, reply) => reply.send(reindexState));

  app.post("/api/reindex-stale", (request, reply) => {
    const { repo } = request.query as { repo?: string };
    if (reindexState.status === "running") {
      return reply.status(409).send({
        status: "running",
        message: "A reindex is already in progress.",
        startedAt: reindexState.startedAt,
      });
    }
    const staleCount = getStaleCardCount(repo);
    if (staleCount === 0) {
      return reply.send({ status: "ok", message: "No stale cards. Knowledge base is up to date." });
    }
    runIncrementalReindex(repo);
    return reply.status(202).send({
      status: "queued",
      message: `Reindexing ${staleCount} stale card(s)${repo ? ` in ${repo}` : ""}.`,
      staleCount,
    });
  });

  // Rules
  app.get("/api/rules", (_req, reply) => reply.send(listRules()));

  app.post("/api/rules", (request, reply) => {
    const body = request.body as { name?: string; description?: string; severity?: string; scope?: string; created_by?: string };
    if (!body.name?.trim() || !body.description?.trim()) {
      return reply.status(400).send({ error: "name and description are required" });
    }
    const rule = insertTeamRule({
      name: body.name,
      description: body.description,
      severity: body.severity ?? "warning",
      scope: body.scope,
      created_by: body.created_by,
    });
    return reply.status(201).send(rule);
  });

  app.patch<{ Params: { id: string } }>("/api/rules/:id", (request, reply) => {
    const result = updateRule(request.params.id, request.body as Record<string, unknown>);
    if (result === null) return reply.status(404).send({ error: "Rule not found" });
    if (result === undefined) return reply.status(400).send({ error: "No updatable fields provided" });
    return reply.send(result);
  });

  app.delete<{ Params: { id: string } }>("/api/rules/:id", (request, reply) => {
    if (!deleteRule(request.params.id)) return reply.status(404).send({ error: "Rule not found" });
    return reply.send({ deleted: request.params.id });
  });

  app.get("/api/rule-checks", (request, reply) => {
    const { repo, limit = "20" } = request.query as { repo?: string; limit?: string };
    return reply.send(listRuleChecks(repo, parseInt(limit, 10)));
  });

  app.post("/api/rules/refine", async (request, reply) => {
    const body = request.body as { name?: string; description?: string; scope?: string; severity?: string };
    if (!body.description?.trim()) return reply.status(400).send({ error: "description is required" });
    try {
      const refined = await refineRule(body.description, { name: body.name, scope: body.scope, severity: body.severity });
      return reply.send({ refined });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = msg.includes("No LLM") ? 503 : 500;
      return reply.status(code).send({ error: msg });
    }
  });

  app.post("/api/rules/import", (request, reply) => {
    const body = request.body;
    if (!Array.isArray(body)) return reply.status(400).send({ error: "Body must be a JSON array of rules" });
    if (body.length > 500) return reply.status(413).send({ error: "Maximum 500 rules per import" });
    return reply.status(201).send(importRules(body));
  });

  app.post("/api/rules/run-check", async (request, reply) => {
    const { repo, base = "main" } = request.body as { repo?: string; base?: string };
    try {
      return reply.send(await runCheck(repo, base));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = msg.includes("No repo path") ? 400 : 500;
      return reply.status(code).send({ error: msg });
    }
  });
}
