import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { getTenantBySlug, getTenantByApiKey } from "./registry.js";
import { enterTenantScope } from "../db/connection.js";
import { autoRegisterDev, isKnownMember, wouldExceedSeatLimit } from "../services/members.js";

declare module "fastify" {
  interface FastifyRequest {
    tenant?: string;
    devEmail?: string;
  }
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PUBLIC_ROUTES = new Set([
  "GET /api/health",
  "POST /api/tenants",
  "GET /api/public-stats",
  "GET /api/founding-status",
  "GET /api/benchmarks",
  "POST /api/benchmarks/submit",
  "GET /api/benchmarks/queue",
  "POST /api/benchmarks/sandbox",
  "POST /api/telemetry",
  "POST /api/auth/magic-link",
  "POST /api/auth/verify",
]);

function isPublicRoute(method: string, url: string): boolean {
  const path = url.split("?")[0];
  if (PUBLIC_ROUTES.has(`${method} ${path}`)) return true;
  if (method === "GET" && /^\/api\/benchmarks\/[a-zA-Z0-9._-]+$/.test(path)) return true;
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
  const adminKey = process.env["CODEPRISM_ADMIN_KEY"];
  if (!adminKey) return false;
  const authHeader = request.headers.authorization;
  return authHeader === `Bearer ${adminKey}`;
}

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

function extractDevEmail(request: FastifyRequest): string | undefined {
  const header = request.headers["x-dev-email"];
  if (typeof header === "string" && EMAIL_RE.test(header.trim())) {
    return header.trim().toLowerCase();
  }
  return undefined;
}

async function tenantPlugin(app: FastifyInstance): Promise<void> {
  app.decorateRequest("tenant", undefined);
  app.decorateRequest("devEmail", undefined);

  const multiTenant = process.env["CODEPRISM_MULTI_TENANT"] === "true";
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

      const devEmail = extractDevEmail(request);
      if (devEmail) {
        request.devEmail = devEmail;

        // Auto-register unknown devs, but enforce seat limit on free plan
        if (!isKnownMember(devEmail, tenant.slug)) {
          if (wouldExceedSeatLimit(tenant.slug)) {
            return reply.code(403).send({
              error: `Seat limit reached (${tenant.max_seats} active developers). Upgrade your plan or deactivate unused members.`,
            });
          }
          autoRegisterDev(devEmail, tenant.slug);
        }
      }

      enterTenantScope(tenant.slug);
    },
  );
}

export const tenantMiddleware = fp(tenantPlugin, {
  name: "codeprism-tenant",
});
