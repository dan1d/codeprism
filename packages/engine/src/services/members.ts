import { getRegistryDb_, getTenantBySlug } from "../tenant/registry.js";
import { ensureUser, createMagicLink } from "./auth.js";

export interface TeamMember {
  userId: string;
  email: string;
  name: string;
  role: string;
  status: string;
  invitedAt: string;
  acceptedAt: string | null;
  queryCount: number;
}

/** Lists all members of a tenant with their query counts from the current month. */
export function listMembers(tenantSlug: string): TeamMember[] {
  const db = getRegistryDb_();
  return db
    .prepare(
      `SELECT
        u.id AS userId, u.email, u.name,
        tm.role, tm.status,
        tm.invited_at AS invitedAt,
        tm.accepted_at AS acceptedAt,
        0 AS queryCount
      FROM team_members tm
        JOIN users u ON u.id = tm.user_id
      WHERE tm.tenant_slug = ?
      ORDER BY tm.invited_at`,
    )
    .all(tenantSlug) as TeamMember[];
}

/**
 * Invites members by email. Creates user records and team_member entries.
 * Returns magic link tokens for sending invitation emails.
 */
export function inviteMembers(
  emails: string[],
  tenantSlug: string,
  role: "admin" | "member" = "member",
): Array<{ email: string; token: string; alreadyMember: boolean }> {
  const db = getRegistryDb_();
  const results: Array<{ email: string; token: string; alreadyMember: boolean }> = [];

  for (const raw of emails) {
    const email = raw.trim().toLowerCase();
    if (!email || !email.includes("@")) continue;

    const user = ensureUser(email);

    const existing = db
      .prepare("SELECT status FROM team_members WHERE user_id = ? AND tenant_slug = ?")
      .get(user.id, tenantSlug) as { status: string } | undefined;

    if (existing && existing.status !== "deactivated") {
      results.push({ email, token: "", alreadyMember: true });
      continue;
    }

    if (existing?.status === "deactivated") {
      db.prepare(
        "UPDATE team_members SET status = 'invited', role = ?, invited_at = datetime('now'), accepted_at = NULL WHERE user_id = ? AND tenant_slug = ?",
      ).run(role, user.id, tenantSlug);
    } else {
      db.prepare(
        "INSERT INTO team_members (user_id, tenant_slug, role, status) VALUES (?, ?, ?, 'invited')",
      ).run(user.id, tenantSlug, role);
    }

    const token = createMagicLink(email, tenantSlug);
    results.push({ email, token, alreadyMember: false });
  }

  return results;
}

/** Activates a member (when they accept an invite or verify magic link). */
export function activateMember(userId: string, tenantSlug: string): void {
  const db = getRegistryDb_();
  db.prepare(
    "UPDATE team_members SET status = 'active', accepted_at = datetime('now') WHERE user_id = ? AND tenant_slug = ?",
  ).run(userId, tenantSlug);
}

/**
 * Auto-registers a developer detected via X-Dev-Email header.
 * Creates a "detected" member if not already known.
 */
export function autoRegisterDev(email: string, tenantSlug: string): void {
  const db = getRegistryDb_();
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) return;

  const user = ensureUser(normalized);

  const existing = db
    .prepare("SELECT status FROM team_members WHERE user_id = ? AND tenant_slug = ?")
    .get(user.id, tenantSlug) as { status: string } | undefined;

  if (existing) return; // already a member in any status

  db.prepare(
    "INSERT INTO team_members (user_id, tenant_slug, role, status) VALUES (?, ?, 'member', 'detected')",
  ).run(user.id, tenantSlug);
}

/** Deactivates a member. Does not delete the record for audit. */
export function deactivateMember(userId: string, tenantSlug: string): boolean {
  const db = getRegistryDb_();
  const result = db
    .prepare("UPDATE team_members SET status = 'deactivated' WHERE user_id = ? AND tenant_slug = ?")
    .run(userId, tenantSlug);
  return result.changes > 0;
}

/**
 * Counts active developers for a tenant this billing period.
 * "Active" = any member whose email appears as dev_id in the tenant's
 * metrics table within the current month, OR has status 'active'/'detected'.
 */
export function getActiveSeatCount(tenantSlug: string): number {
  const db = getRegistryDb_();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM team_members
       WHERE tenant_slug = ? AND status IN ('active', 'detected')`,
    )
    .get(tenantSlug) as { n: number };
  return row.n;
}

/** Checks if adding one more active dev would exceed the seat limit. */
export function wouldExceedSeatLimit(tenantSlug: string): boolean {
  const tenant = getTenantBySlug(tenantSlug);
  if (!tenant || tenant.max_seats === null) return false; // no limit set
  return getActiveSeatCount(tenantSlug) >= tenant.max_seats;
}

/** Checks if a dev email is already a known (non-deactivated) member. */
export function isKnownMember(email: string, tenantSlug: string): boolean {
  const db = getRegistryDb_();
  const normalized = email.trim().toLowerCase();
  const row = db
    .prepare(
      `SELECT 1 FROM team_members tm
         JOIN users u ON u.id = tm.user_id
       WHERE u.email = ? AND tm.tenant_slug = ? AND tm.status != 'deactivated'`,
    )
    .get(normalized, tenantSlug);
  return !!row;
}
