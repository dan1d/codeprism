import { randomBytes, randomUUID } from "node:crypto";
import { getRegistryDb_ } from "../tenant/registry.js";

const MAGIC_LINK_TTL_MINUTES = 15;
const SESSION_TTL_DAYS = 30;

export interface User {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

export interface Session {
  token: string;
  user_id: string;
  tenant_slug: string;
  expires_at: string;
  created_at: string;
}

function expiresAt(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

/** Get or create a user by email. Returns the user record. */
export function ensureUser(email: string, name?: string): User {
  const db = getRegistryDb_();
  const normalized = email.trim().toLowerCase();

  const existing = db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(normalized) as User | undefined;
  if (existing) return existing;

  const id = randomUUID();
  db.prepare("INSERT INTO users (id, email, name) VALUES (?, ?, ?)")
    .run(id, normalized, name?.trim() ?? "");

  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as User;
}

export function getUserById(userId: string): User | null {
  const db = getRegistryDb_();
  return (db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as User | undefined) ?? null;
}

export function getUserByEmail(email: string): User | null {
  const db = getRegistryDb_();
  const normalized = email.trim().toLowerCase();
  return (db.prepare("SELECT * FROM users WHERE email = ?").get(normalized) as User | undefined) ?? null;
}

/** Creates a magic link token for email-based auth. */
export function createMagicLink(email: string, tenantSlug: string): string {
  const db = getRegistryDb_();
  const token = randomBytes(32).toString("base64url");
  const normalized = email.trim().toLowerCase();

  db.prepare(
    "INSERT INTO magic_links (token, email, tenant_slug, expires_at) VALUES (?, ?, ?, ?)",
  ).run(token, normalized, tenantSlug, expiresAt(MAGIC_LINK_TTL_MINUTES));

  return token;
}

/**
 * Verifies a magic link token. Returns the email + tenant if valid.
 * Marks the token as used (single-use).
 */
export function verifyMagicLink(
  token: string,
): { email: string; tenantSlug: string } | null {
  const db = getRegistryDb_();
  const link = db
    .prepare(
      "SELECT * FROM magic_links WHERE token = ? AND used_at IS NULL AND expires_at > datetime('now')",
    )
    .get(token) as { email: string; tenant_slug: string } | undefined;

  if (!link) return null;

  db.prepare("UPDATE magic_links SET used_at = datetime('now') WHERE token = ?").run(token);

  return { email: link.email, tenantSlug: link.tenant_slug };
}

/** Creates a session for an authenticated user. Returns the session token. */
export function createSession(userId: string, tenantSlug: string): string {
  const db = getRegistryDb_();
  const token = randomBytes(32).toString("hex");
  const expires = expiresAt(SESSION_TTL_DAYS * 24 * 60);

  db.prepare(
    "INSERT INTO sessions (token, user_id, tenant_slug, expires_at) VALUES (?, ?, ?, ?)",
  ).run(token, userId, tenantSlug, expires);

  return token;
}

/** Validates a session token. Returns session info or null if expired/invalid. */
export function validateSession(
  token: string,
): { userId: string; tenantSlug: string; email: string; role: string } | null {
  const db = getRegistryDb_();
  const row = db
    .prepare(
      `SELECT s.user_id, s.tenant_slug, u.email,
              COALESCE(tm.role, 'member') AS role
       FROM sessions s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN team_members tm ON tm.user_id = s.user_id AND tm.tenant_slug = s.tenant_slug
       WHERE s.token = ? AND s.expires_at > datetime('now')`,
    )
    .get(token) as { user_id: string; tenant_slug: string; email: string; role: string } | undefined;

  if (!row) return null;
  return { userId: row.user_id, tenantSlug: row.tenant_slug, email: row.email, role: row.role };
}

/** Destroys a session. */
export function destroySession(token: string): void {
  const db = getRegistryDb_();
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

/** Cleans up expired magic links and sessions. */
export function cleanupExpired(): void {
  const db = getRegistryDb_();
  db.prepare("DELETE FROM magic_links WHERE expires_at < datetime('now')").run();
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
}
