/**
 * In-memory SQLite factory for auth/member tests.
 * Creates the tenants.db schema in-memory.
 */
import Database from "better-sqlite3";

export type TestRegistryDb = ReturnType<typeof Database>;

export function createTestRegistryDb(): TestRegistryDb {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      slug           TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      api_key_hash   TEXT NOT NULL UNIQUE,
      api_key_prefix TEXT NOT NULL DEFAULT '',
      plan           TEXT NOT NULL DEFAULT 'free',
      owner_email    TEXT,
      max_seats      INTEGER,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      email       TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS team_members (
      user_id       TEXT NOT NULL REFERENCES users(id),
      tenant_slug   TEXT NOT NULL REFERENCES tenants(slug) ON DELETE CASCADE,
      role          TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin', 'member')),
      status        TEXT NOT NULL DEFAULT 'invited' CHECK(status IN ('invited', 'active', 'detected', 'deactivated')),
      invited_at    TEXT NOT NULL DEFAULT (datetime('now')),
      accepted_at   TEXT,
      PRIMARY KEY (user_id, tenant_slug)
    );

    CREATE TABLE IF NOT EXISTS magic_links (
      token        TEXT PRIMARY KEY,
      email        TEXT NOT NULL,
      tenant_slug  TEXT NOT NULL REFERENCES tenants(slug) ON DELETE CASCADE,
      expires_at   TEXT NOT NULL,
      used_at      TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token        TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id),
      tenant_slug  TEXT NOT NULL REFERENCES tenants(slug) ON DELETE CASCADE,
      expires_at   TEXT NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  return db;
}

export function insertTestTenant(
  db: TestRegistryDb,
  overrides: Partial<{
    slug: string;
    name: string;
    api_key_hash: string;
    api_key_prefix: string;
    plan: string;
    owner_email: string;
    max_seats: number;
  }> = {},
): string {
  const slug = overrides.slug ?? `tenant-${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(
    "INSERT INTO tenants (slug, name, api_key_hash, api_key_prefix, plan, owner_email, max_seats) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    slug,
    overrides.name ?? "Test Tenant",
    overrides.api_key_hash ?? `hash-${slug}`,
    overrides.api_key_prefix ?? "sk_test",
    overrides.plan ?? "free",
    overrides.owner_email ?? null,
    overrides.max_seats ?? 3,
  );
  return slug;
}
