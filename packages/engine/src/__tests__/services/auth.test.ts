import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestRegistryDb, insertTestTenant, type TestRegistryDb } from "../helpers/registry-db.js";

let testDb: TestRegistryDb;

vi.mock("../../tenant/registry.js", () => ({
  getRegistryDb_: () => testDb,
  getTenantBySlug: (slug: string) => {
    const row = testDb.prepare("SELECT * FROM tenants WHERE slug = ?").get(slug);
    return row ?? null;
  },
}));

const {
  ensureUser,
  getUserById,
  getUserByEmail,
  createMagicLink,
  verifyMagicLink,
  createSession,
  validateSession,
  destroySession,
  cleanupExpired,
} = await import("../../services/auth.js");

describe("auth service", () => {
  let tenantSlug: string;

  beforeEach(() => {
    testDb = createTestRegistryDb();
    tenantSlug = insertTestTenant(testDb, { slug: "acme" });
  });
  afterEach(() => { testDb.close(); });

  describe("ensureUser", () => {
    it("creates a new user", () => {
      const user = ensureUser("alice@acme.com");
      expect(user.email).toBe("alice@acme.com");
      expect(user.id).toBeTruthy();
    });

    it("returns existing user on second call", () => {
      const u1 = ensureUser("alice@acme.com");
      const u2 = ensureUser("alice@acme.com");
      expect(u1.id).toBe(u2.id);
    });

    it("normalizes email to lowercase", () => {
      const user = ensureUser("Alice@Acme.COM");
      expect(user.email).toBe("alice@acme.com");
    });
  });

  describe("getUserById / getUserByEmail", () => {
    it("retrieves user by id", () => {
      const user = ensureUser("bob@acme.com");
      expect(getUserById(user.id)).not.toBeNull();
      expect(getUserById(user.id)!.email).toBe("bob@acme.com");
    });

    it("retrieves user by email", () => {
      ensureUser("bob@acme.com");
      expect(getUserByEmail("bob@acme.com")).not.toBeNull();
      expect(getUserByEmail("unknown@x.com")).toBeNull();
    });
  });

  describe("magic links", () => {
    it("creates and verifies a magic link", () => {
      const token = createMagicLink("alice@acme.com", tenantSlug);
      expect(token).toBeTruthy();

      const result = verifyMagicLink(token);
      expect(result).not.toBeNull();
      expect(result!.email).toBe("alice@acme.com");
      expect(result!.tenantSlug).toBe(tenantSlug);
    });

    it("marks token as used after first verification", () => {
      const token = createMagicLink("alice@acme.com", tenantSlug);
      verifyMagicLink(token); // first use

      const second = verifyMagicLink(token);
      expect(second).toBeNull(); // already used
    });

    it("rejects expired tokens", () => {
      const token = createMagicLink("alice@acme.com", tenantSlug);
      // Manually expire the token
      testDb.prepare("UPDATE magic_links SET expires_at = datetime('now', '-1 hour') WHERE token = ?").run(token);

      expect(verifyMagicLink(token)).toBeNull();
    });
  });

  describe("sessions", () => {
    it("creates and validates a session", () => {
      const user = ensureUser("alice@acme.com");
      // Add as team member for role lookup
      testDb.prepare(
        "INSERT INTO team_members (user_id, tenant_slug, role, status) VALUES (?, ?, 'admin', 'active')",
      ).run(user.id, tenantSlug);

      const sessionToken = createSession(user.id, tenantSlug);
      expect(sessionToken).toBeTruthy();

      const session = validateSession(sessionToken);
      expect(session).not.toBeNull();
      expect(session!.userId).toBe(user.id);
      expect(session!.email).toBe("alice@acme.com");
      expect(session!.tenantSlug).toBe(tenantSlug);
      expect(session!.role).toBe("admin");
    });

    it("rejects invalid session token", () => {
      expect(validateSession("bogus-token")).toBeNull();
    });

    it("destroys a session", () => {
      const user = ensureUser("alice@acme.com");
      const sessionToken = createSession(user.id, tenantSlug);

      destroySession(sessionToken);
      expect(validateSession(sessionToken)).toBeNull();
    });
  });

  describe("cleanupExpired", () => {
    it("removes expired links and sessions", () => {
      const user = ensureUser("alice@acme.com");

      // Create and expire
      const magicToken = createMagicLink("alice@acme.com", tenantSlug);
      testDb.prepare("UPDATE magic_links SET expires_at = datetime('now', '-1 hour') WHERE token = ?").run(magicToken);

      const sessionToken = createSession(user.id, tenantSlug);
      testDb.prepare("UPDATE sessions SET expires_at = datetime('now', '-1 hour') WHERE token = ?").run(sessionToken);

      cleanupExpired();

      expect(testDb.prepare("SELECT COUNT(*) AS c FROM magic_links").get()).toEqual({ c: 0 });
      expect(testDb.prepare("SELECT COUNT(*) AS c FROM sessions").get()).toEqual({ c: 0 });
    });
  });
});
