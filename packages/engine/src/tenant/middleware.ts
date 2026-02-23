import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { getTenantBySlug, getTenantByApiKey } from "./registry.js";
import { enterTenantScope } from "../db/connection.js";

declare module "fastify" {
  interface FastifyRequest {
    tenant?: string;
  }
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

const PUBLIC_ROUTES = new Set([
  "GET /api/health",
  "POST /api/tenants",
  "GET /api/public-stats",
  "POST /api/telemetry",
]);

function isPublicRoute(method: string, url: string): boolean {
  const path = url.split("?")[0];
  if (PUBLIC_ROUTES.has(`${method} ${path}`)) return true;
  if (method === "GET" && !path.startsWith("/api/") && !path.startsWith("/mcp/")) {
    return true;
  }
  return false;
}

function isAdminRoute(method: string, url: string): boolean {
  const path = url.split("?")[0];
  if (method === "GET" && path === "/api/tenants") return true;
  if (method === "DELETE" && /^\/api\/tenants\/[a-z0-9-]+$/.test(path)) return true;
  if (method === "POST" && /^\/api\/tenants\/[a-z0-9-]+\/rotate-key$/.test(path)) return true;
  return false;
}

function checkAdminAuth(request: FastifyRequest): boolean {
  const adminKey = process.env["SRCMAP_ADMIN_KEY"];
  if (!adminKey) return false;
  const authHeader = request.headers.authorization;
  return authHeader === `Bearer ${adminKey}`;
}

/**
 * Resolves tenant slug from the request using (in priority order):
 * 1. Path prefix: /acme/api/... or /acme/mcp/... -> slug = "acme"
 * 2. X-Tenant header (validated format)
 * 3. Authorization: Bearer sk_... -> API key lookup
 */
function resolveTenantSlug(request: FastifyRequest): string | null {
  const pathMatch = request.url.match(/^\/([a-z0-9][a-z0-9-]*)\/(api|mcp)\//);
  if (pathMatch) return pathMatch[1];

  const headerSlug = request.headers["x-tenant"];
  if (typeof headerSlug === "string" && SLUG_RE.test(headerSlug)) return headerSlug;

  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith("Bearer sk_")) {
    const tenant = getTenantByApiKey(authHeader.slice(7));
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

      if (isAdminRoute(request.method, request.url)) {
        if (!checkAdminAuth(request)) {
          return reply.code(403).send({ error: "Admin authentication required" });
        }
        return;
      }

      const slug = resolveTenantSlug(request);
      if (!slug) {
        return reply.code(401).send({ error: "Tenant identification required" });
      }

      const tenant = getTenantBySlug(slug);
      if (!tenant) {
        return reply.code(401).send({ error: "Unknown tenant" });
      }

      request.tenant = tenant.slug;
      request.log = request.log.child({ tenant: tenant.slug });

      enterTenantScope(tenant.slug);
    },
  );
}

export const tenantMiddleware = fp(tenantPlugin, {
  name: "srcmap-tenant",
});
