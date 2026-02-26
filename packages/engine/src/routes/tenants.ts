import type { FastifyInstance } from "fastify";
import { join } from "node:path";
import { unlink } from "node:fs/promises";
import { createTenant, listTenants, deleteTenant, rotateApiKey, getTenantCount } from "../tenant/registry.js";
import { getRegistryDb_ } from "../tenant/registry.js";
import { ensureUser } from "../services/auth.js";
import { getDataDir, closeTenantDb } from "../db/connection.js";

/**
 * Tenant admin routes (CRUD for workspaces + API key rotation).
 * Registered only when CODEPRISM_MULTI_TENANT=true.
 */
export async function registerTenantRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { name: string; email?: string } }>(
    "/api/tenants",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { name, email } = request.body ?? {};
      if (!name || typeof name !== "string" || name.trim().length < 2) {
        return reply.code(400).send({ error: "name is required (min 2 characters)" });
      }
      try {
        const result = createTenant(name.trim(), email?.trim());

        if (email?.trim()) {
          const user = ensureUser(email.trim());
          const rDb = getRegistryDb_();
          rDb.prepare(
            "INSERT OR IGNORE INTO team_members (user_id, tenant_slug, role, status, accepted_at) VALUES (?, ?, 'admin', 'active', datetime('now'))",
          ).run(user.id, result.slug);
        }

        return reply.code(201).send({
          slug: result.slug,
          name: result.name,
          apiKey: result.apiKey,
          mcpUrl: `${request.protocol}://${request.hostname}/${result.slug}/mcp/sse`,
          dashboardUrl: `${request.protocol}://${request.hostname}/${result.slug}/`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(409).send({ error: message });
      }
    },
  );

  app.get("/api/tenants", async (_request, reply) => {
    return reply.send(listTenants());
  });

  app.delete<{ Params: { slug: string } }>(
    "/api/tenants/:slug",
    async (request, reply) => {
      const slug = request.params.slug;
      closeTenantDb(slug);
      const deleted = deleteTenant(slug);
      if (!deleted) return reply.code(404).send({ error: "Tenant not found" });

      const dbPath = join(getDataDir(), "tenants", `${slug}.db`);
      for (const ext of ["", "-wal", "-shm"]) {
        await unlink(dbPath + ext).catch(() => {});
      }

      return reply.send({ deleted: slug });
    },
  );

  app.post<{ Params: { slug: string } }>(
    "/api/tenants/:slug/rotate-key",
    async (request, reply) => {
      const newKey = rotateApiKey(request.params.slug);
      if (!newKey) return reply.code(404).send({ error: "Tenant not found" });
      return reply.send({ slug: request.params.slug, apiKey: newKey });
    },
  );

  app.get("/api/founding-status", async (_request, reply) => {
    const count = getTenantCount();
    const limit = 100;
    return reply.send({
      founding: count < limit,
      remaining: Math.max(0, limit - count),
      total: count,
      limit,
    });
  });
}
