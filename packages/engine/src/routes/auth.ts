import type { FastifyInstance } from "fastify";
import { createMagicLink, verifyMagicLink, ensureUser, createSession, validateSession, destroySession } from "../services/auth.js";
import { inviteMembers, listMembers, activateMember, deactivateMember, getActiveSeatCount } from "../services/members.js";
import { sendMagicLinkEmail, sendInvitationEmail } from "../services/email.js";
import { getTenantBySlug, isMemberOfTenant, isEmailInvitedToTenant } from "../tenant/registry.js";

/**
 * Authentication + member management routes.
 * Registered only when CODEPRISM_MULTI_TENANT=true.
 */
export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  // ── Magic link auth ──────────────────────────────────────────────────

  app.post<{ Body: { email: string; tenant: string } }>(
    "/api/auth/magic-link",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { email, tenant: tenantSlug } = request.body ?? {};
      if (!email || !tenantSlug) {
        return reply.code(400).send({ error: "email and tenant are required" });
      }
      const tenant = getTenantBySlug(tenantSlug);
      if (!tenant) return reply.code(404).send({ error: "Tenant not found" });

      const token = createMagicLink(email.trim(), tenantSlug);
      await sendMagicLinkEmail(email.trim(), token, tenantSlug, tenant.name);
      return reply.send({ ok: true, message: "Check your email for a sign-in link." });
    },
  );

  app.post<{ Body: { token: string } }>(
    "/api/auth/verify",
    async (request, reply) => {
      const { token } = request.body ?? {};
      if (!token) return reply.code(400).send({ error: "token is required" });

      const result = verifyMagicLink(token);
      if (!result) return reply.code(401).send({ error: "Invalid or expired link" });

      // Check by email BEFORE creating a user row — avoids polluting the users
      // table with accounts for addresses that were never actually invited.
      if (!isEmailInvitedToTenant(result.email, result.tenantSlug)) {
        return reply.code(403).send({ error: "You have not been invited to this team." });
      }

      const user = ensureUser(result.email);
      activateMember(user.id, result.tenantSlug);

      const sessionToken = createSession(user.id, result.tenantSlug);
      const tenant = getTenantBySlug(result.tenantSlug);

      return reply.send({
        sessionToken,
        user: { id: user.id, email: user.email, name: user.name },
        tenant: { slug: result.tenantSlug, name: tenant?.name ?? "" },
      });
    },
  );

  app.post("/api/auth/logout", async (request, reply) => {
    const sessionToken = (request.headers["x-session-token"] as string) ?? "";
    if (sessionToken) destroySession(sessionToken);
    return reply.send({ ok: true });
  });

  app.get("/api/auth/me", async (request, reply) => {
    const sessionToken = (request.headers["x-session-token"] as string) ?? "";
    const session = sessionToken ? validateSession(sessionToken) : null;
    if (!session) return reply.code(401).send({ error: "Not authenticated" });
    return reply.send(session);
  });

  // ── Member management ────────────────────────────────────────────────

  app.get("/api/members", async (request, reply) => {
    const sessionToken = (request.headers["x-session-token"] as string) ?? "";
    const session = sessionToken ? validateSession(sessionToken) : null;
    if (!session) return reply.code(401).send({ error: "Not authenticated" });

    const members = listMembers(session.tenantSlug);
    const activeCount = getActiveSeatCount(session.tenantSlug);
    const tenant = getTenantBySlug(session.tenantSlug);

    return reply.send({ members, activeCount, maxSeats: tenant?.max_seats ?? null });
  });

  app.post<{ Body: { emails: string[] } }>(
    "/api/members/invite",
    async (request, reply) => {
      const sessionToken = (request.headers["x-session-token"] as string) ?? "";
      const session = sessionToken ? validateSession(sessionToken) : null;
      if (!session) return reply.code(401).send({ error: "Not authenticated" });
      if (session.role !== "admin") return reply.code(403).send({ error: "Admin access required" });

      const { emails } = request.body ?? {};
      if (!Array.isArray(emails) || emails.length === 0) {
        return reply.code(400).send({ error: "emails array is required" });
      }
      if (emails.length > 50) {
        return reply.code(400).send({ error: "Maximum 50 invitations at once" });
      }

      const tenant = getTenantBySlug(session.tenantSlug);
      const results = inviteMembers(emails, session.tenantSlug);

      for (const r of results) {
        if (!r.alreadyMember && r.token) {
          sendInvitationEmail(
            r.email, r.token, session.tenantSlug,
            tenant?.name ?? session.tenantSlug, session.email,
          ).catch((err) => console.warn(`[email] Failed to send invite to ${r.email}:`, err));
        }
      }

      const invited = results.filter((r) => !r.alreadyMember).length;
      const skipped = results.filter((r) => r.alreadyMember).length;
      return reply.code(201).send({
        invited,
        skipped,
        details: results.map((r) => ({ email: r.email, alreadyMember: r.alreadyMember })),
      });
    },
  );

  app.delete<{ Params: { userId: string } }>(
    "/api/members/:userId",
    async (request, reply) => {
      const sessionToken = (request.headers["x-session-token"] as string) ?? "";
      const session = sessionToken ? validateSession(sessionToken) : null;
      if (!session) return reply.code(401).send({ error: "Not authenticated" });
      if (session.role !== "admin") return reply.code(403).send({ error: "Admin access required" });

      if (request.params.userId === session.userId) {
        return reply.code(400).send({ error: "Cannot deactivate yourself" });
      }

      const removed = deactivateMember(request.params.userId, session.tenantSlug);
      if (!removed) return reply.code(404).send({ error: "Member not found" });
      return reply.send({ deactivated: request.params.userId });
    },
  );
}
