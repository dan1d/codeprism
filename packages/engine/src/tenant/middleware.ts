import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { getTenantBySlug, getTenantByApiKey } from "./registry.js";

declare module "fastify" {
  interface FastifyRequest {
    tenant?: string;
  }
}

const PUBLIC_ROUTES = new Set([
  "GET /api/health",
  "POST /api/tenants",
  "GET /api/public-stats",
]);

function isPublicRoute(method: string, url: string): boolean {
  if (PUBLIC_ROUTES.has(`${method} ${url}`)) return true;
  // Static file serving: GET / and GET /* that don't start with /api/ or /mcp/
  if (method === "GET" && !url.startsWith("/api/") && !url.startsWith("/mcp/")) {
    return true;
  }
  return false;
}

/**
 * Resolves tenant slug from the request using (in priority order):
 * 1. Path prefix: /acme/api/... or /acme/mcp/... → slug = "acme"
 * 2. X-Tenant header
 * 3. Authorization: Bearer sk_... → API key lookup
 */
function resolveTenantSlug(request: FastifyRequest): string | null {
  // 1. Path prefix — /:slug/api/... or /:slug/mcp/...
  const pathMatch = request.url.match(/^\/([a-z0-9][a-z0-9-]*)\/(api|mcp)\//);
  if (pathMatch) return pathMatch[1];

  // 2. X-Tenant header
  const headerSlug = request.headers["x-tenant"];
  if (typeof headerSlug === "string" && headerSlug.length > 0) return headerSlug;

  // 3. Bearer token → API key lookup
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith("Bearer sk_")) {
    const tenant = getTenantByApiKey(authHeader.slice(7)); // "Bearer " = 7 chars
    if (tenant) return tenant.slug;
  }

  return null;
}

async function tenantPlugin(app: FastifyInstance): Promise<void> {
  app.decorateRequest("tenant", undefined);

  const multiTenant = process.env["SRCMAP_MULTI_TENANT"] === "true";
  if (!multiTenant) return;

  app.addHook(
    "onRequest",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (isPublicRoute(request.method, request.url)) return;

      const slug = resolveTenantSlug(request);
      if (!slug) {
        return reply.code(401).send({ error: "Tenant identification required" });
      }

      const tenant = getTenantBySlug(slug);
      if (!tenant) {
        return reply.code(401).send({ error: "Unknown tenant" });
      }

      request.tenant = tenant.slug;
    },
  );
}

export const tenantMiddleware = fp(tenantPlugin, {
  name: "srcmap-tenant",
});
