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
  listMembers,
  inviteMembers,
  activateMember,
  autoRegisterDev,
  deactivateMember,
  getActiveSeatCount,
  wouldExceedSeatLimit,
  isKnownMember,
} = await import("../../services/members.js");

const { ensureUser } = await import("../../services/auth.js");

describe("members service", () => {
  let tenantSlug: string;

  beforeEach(() => {
    testDb = createTestRegistryDb();
    tenantSlug = insertTestTenant(testDb, { slug: "acme", max_seats: 3 });
  });
  afterEach(() => { testDb.close(); });

  describe("inviteMembers", () => {
    it("creates user records and team_member entries", () => {
      const results = inviteMembers(
        ["alice@acme.com", "bob@acme.com"],
        tenantSlug,
      );

      expect(results).toHaveLength(2);
      expect(results[0]!.email).toBe("alice@acme.com");
      expect(results[0]!.alreadyMember).toBe(false);
      expect(results[0]!.token).toBeTruthy();

      const members = listMembers(tenantSlug);
      expect(members).toHaveLength(2);
      expect(members.every((m) => m.status === "invited")).toBe(true);
    });

    it("skips already-member emails", () => {
      inviteMembers(["alice@acme.com"], tenantSlug);
      const results = inviteMembers(["alice@acme.com", "bob@acme.com"], tenantSlug);

      const aliceResult = results.find((r) => r.email === "alice@acme.com")!;
      expect(aliceResult.alreadyMember).toBe(true);

      const bobResult = results.find((r) => r.email === "bob@acme.com")!;
      expect(bobResult.alreadyMember).toBe(false);
    });

    it("skips invalid emails", () => {
      const results = inviteMembers(["not-an-email", "  ", "alice@acme.com"], tenantSlug);
      expect(results).toHaveLength(1);
      expect(results[0]!.email).toBe("alice@acme.com");
    });

    it("re-invites deactivated members", () => {
      inviteMembers(["alice@acme.com"], tenantSlug);
      const user = ensureUser("alice@acme.com");
      deactivateMember(user.id, tenantSlug);

      const results = inviteMembers(["alice@acme.com"], tenantSlug);
      expect(results[0]!.alreadyMember).toBe(false);

      const members = listMembers(tenantSlug);
      const alice = members.find((m) => m.email === "alice@acme.com")!;
      expect(alice.status).toBe("invited");
    });
  });

  describe("activateMember", () => {
    it("sets status to active with accepted_at timestamp", () => {
      inviteMembers(["alice@acme.com"], tenantSlug);
      const user = ensureUser("alice@acme.com");
      activateMember(user.id, tenantSlug);

      const members = listMembers(tenantSlug);
      const alice = members.find((m) => m.email === "alice@acme.com")!;
      expect(alice.status).toBe("active");
      expect(alice.acceptedAt).toBeTruthy();
    });
  });

  describe("autoRegisterDev", () => {
    it("creates a detected member for unknown developer", () => {
      autoRegisterDev("newdev@acme.com", tenantSlug);

      const members = listMembers(tenantSlug);
      expect(members).toHaveLength(1);
      expect(members[0]!.status).toBe("detected");
    });

    it("does nothing for already-known members", () => {
      inviteMembers(["alice@acme.com"], tenantSlug);
      autoRegisterDev("alice@acme.com", tenantSlug);

      const members = listMembers(tenantSlug);
      expect(members).toHaveLength(1);
      expect(members[0]!.status).toBe("invited"); // unchanged
    });
  });

  describe("deactivateMember", () => {
    it("sets status to deactivated", () => {
      inviteMembers(["alice@acme.com"], tenantSlug);
      const user = ensureUser("alice@acme.com");
      const result = deactivateMember(user.id, tenantSlug);
      expect(result).toBe(true);

      const members = listMembers(tenantSlug);
      expect(members[0]!.status).toBe("deactivated");
    });

    it("returns false for non-existent member", () => {
      expect(deactivateMember("bogus-id", tenantSlug)).toBe(false);
    });
  });

  describe("seat tracking", () => {
    it("counts active and detected members", () => {
      autoRegisterDev("dev1@acme.com", tenantSlug);
      autoRegisterDev("dev2@acme.com", tenantSlug);
      expect(getActiveSeatCount(tenantSlug)).toBe(2);

      inviteMembers(["pending@acme.com"], tenantSlug);
      // Invited members don't count as active seats
      expect(getActiveSeatCount(tenantSlug)).toBe(2);
    });

    it("wouldExceedSeatLimit returns true at capacity", () => {
      autoRegisterDev("dev1@acme.com", tenantSlug);
      autoRegisterDev("dev2@acme.com", tenantSlug);
      autoRegisterDev("dev3@acme.com", tenantSlug);

      expect(wouldExceedSeatLimit(tenantSlug)).toBe(true);
    });

    it("wouldExceedSeatLimit returns false below capacity", () => {
      autoRegisterDev("dev1@acme.com", tenantSlug);
      expect(wouldExceedSeatLimit(tenantSlug)).toBe(false);
    });

    it("wouldExceedSeatLimit returns false for unlimited seats", () => {
      const unlimitedSlug = insertTestTenant(testDb, {
        slug: "unlimited-co",
        max_seats: undefined,
      });
      // need to clear max_seats since insertTestTenant defaults to 3
      testDb.prepare("UPDATE tenants SET max_seats = NULL WHERE slug = ?").run(unlimitedSlug);

      autoRegisterDev("dev1@acme.com", unlimitedSlug);
      autoRegisterDev("dev2@acme.com", unlimitedSlug);
      autoRegisterDev("dev3@acme.com", unlimitedSlug);
      autoRegisterDev("dev4@acme.com", unlimitedSlug);
      expect(wouldExceedSeatLimit(unlimitedSlug)).toBe(false);
    });
  });

  describe("isKnownMember", () => {
    it("returns true for active members", () => {
      autoRegisterDev("dev1@acme.com", tenantSlug);
      expect(isKnownMember("dev1@acme.com", tenantSlug)).toBe(true);
    });

    it("returns false for unknown emails", () => {
      expect(isKnownMember("unknown@acme.com", tenantSlug)).toBe(false);
    });

    it("returns false for deactivated members", () => {
      autoRegisterDev("dev1@acme.com", tenantSlug);
      const user = ensureUser("dev1@acme.com");
      deactivateMember(user.id, tenantSlug);
      expect(isKnownMember("dev1@acme.com", tenantSlug)).toBe(false);
    });
  });
});
