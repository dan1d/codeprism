/**
 * Unit tests for getTenantsForEmail in tenant/registry.ts
 *
 * Uses an isolated approach: vi.resetModules() + vi.doMock() redirects
 * getDataDir to a temp directory so the registry DB stays isolated.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cp-registry-test-"));
  vi.resetModules();
  vi.doMock("../../db/connection.js", () => ({ getDataDir: () => tmpDir }));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// getTenantsForEmail
// ---------------------------------------------------------------------------

describe("getTenantsForEmail", () => {
  it("returns empty array for unknown email", async () => {
    const { getTenantsForEmail } = await import("../../tenant/registry.js");
    expect(getTenantsForEmail("nobody@example.com")).toEqual([]);
  });

  it("returns tenant where email is the owner", async () => {
    const { createTenant, getTenantsForEmail } = await import("../../tenant/registry.js");
    const { slug } = createTenant("Acme Corp", "owner@acme.com");
    const result = getTenantsForEmail("owner@acme.com");
    expect(result).toHaveLength(1);
    expect(result[0].slug).toBe(slug);
    expect(result[0].name).toBe("Acme Corp");
  });

  it("is case-insensitive for owner email lookup", async () => {
    const { createTenant, getTenantsForEmail } = await import("../../tenant/registry.js");
    const { slug } = createTenant("Acme Corp", "Owner@ACME.com");
    const result = getTenantsForEmail("owner@acme.com");
    expect(result).toHaveLength(1);
    expect(result[0].slug).toBe(slug);
  });

  it("returns all tenants the user owns", async () => {
    const { createTenant, getTenantsForEmail } = await import("../../tenant/registry.js");
    const t1 = createTenant("Acme Corp", "shared@example.com");
    const t2 = createTenant("Beta Co", "shared@example.com");
    const result = getTenantsForEmail("shared@example.com");
    const slugs = result.map((t) => t.slug);
    expect(slugs).toContain(t1.slug);
    expect(slugs).toContain(t2.slug);
  });

  it("deduplicates when user is both owner and active member", async () => {
    const { createTenant, getTenantsForEmail, getRegistryDb_ } = await import("../../tenant/registry.js");
    const { ensureUser } = await import("../../services/auth.js");

    const { slug } = createTenant("Acme Corp", "alice@acme.com");
    const user = ensureUser("alice@acme.com");

    const db = getRegistryDb_();
    db.prepare(
      "INSERT OR IGNORE INTO team_members (user_id, tenant_slug, role, status) VALUES (?, ?, 'admin', 'active')"
    ).run(user.id, slug);

    const result = getTenantsForEmail("alice@acme.com");
    expect(result).toHaveLength(1);
  });

  it("excludes deactivated members", async () => {
    const { createTenant, getTenantsForEmail, getRegistryDb_ } = await import("../../tenant/registry.js");
    const { ensureUser } = await import("../../services/auth.js");

    const { slug } = createTenant("Acme Corp", "admin@acme.com");
    const user = ensureUser("bob@acme.com");

    const db = getRegistryDb_();
    db.prepare(
      "INSERT INTO team_members (user_id, tenant_slug, role, status) VALUES (?, ?, 'member', 'deactivated')"
    ).run(user.id, slug);

    const result = getTenantsForEmail("bob@acme.com");
    expect(result).toHaveLength(0);
  });

  it("includes active and invited members", async () => {
    const { createTenant, getTenantsForEmail, getRegistryDb_ } = await import("../../tenant/registry.js");
    const { ensureUser } = await import("../../services/auth.js");

    const t1 = createTenant("Acme Corp", "admin@acme.com");
    const t2 = createTenant("Beta Co", "admin@beta.com");
    const user = ensureUser("bob@example.com");

    const db = getRegistryDb_();
    db.prepare(
      "INSERT INTO team_members (user_id, tenant_slug, role, status) VALUES (?, ?, 'member', 'active')"
    ).run(user.id, t1.slug);
    db.prepare(
      "INSERT INTO team_members (user_id, tenant_slug, role, status) VALUES (?, ?, 'member', 'invited')"
    ).run(user.id, t2.slug);

    const result = getTenantsForEmail("bob@example.com");
    const slugs = result.map((t) => t.slug).sort();
    expect(slugs).toEqual([t1.slug, t2.slug].sort());
  });

  it("trims whitespace from the email argument", async () => {
    const { createTenant, getTenantsForEmail } = await import("../../tenant/registry.js");
    createTenant("Acme Corp", "owner@acme.com");
    const result = getTenantsForEmail("  owner@acme.com  ");
    expect(result).toHaveLength(1);
  });

  it("returns empty for an email with no memberships or ownership", async () => {
    const { createTenant, getTenantsForEmail } = await import("../../tenant/registry.js");
    createTenant("Acme Corp", "admin@acme.com");
    expect(getTenantsForEmail("unrelated@example.com")).toHaveLength(0);
  });
});
