import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { randomBytes, createHash } from "node:crypto";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { getDataDir } from "../db/connection.js";

export interface Tenant {
  slug: string;
  name: string;
  api_key_hash: string;
  api_key_prefix: string;
  plan: string;
  owner_email: string | null;
  max_seats: number | null;
  created_at: string;
}

export interface TenantPublic {
  slug: string;
  name: string;
  api_key_prefix: string;
  plan: string;
  owner_email: string | null;
  max_seats: number | null;
  created_at: string;
}

let registryDb: DatabaseType | null = null;

function getRegistryDbPath(): string {
  return join(getDataDir(), "tenants.db");
}

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Opens (or returns cached) the central tenant registry database. */
function getRegistryDb(): DatabaseType {
  if (registryDb) return registryDb;

  const dbPath = getRegistryDbPath();
  mkdirSync(join(dbPath, ".."), { recursive: true });

  const db = new Database(dbPath);
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

  // Migrate: add new columns to existing tenants table if missing
  const columns = db.pragma("table_info(tenants)") as { name: string }[];
  if (!columns.some((c) => c.name === "owner_email")) {
    db.exec("ALTER TABLE tenants ADD COLUMN owner_email TEXT");
  }
  if (!columns.some((c) => c.name === "max_seats")) {
    db.exec("ALTER TABLE tenants ADD COLUMN max_seats INTEGER");
  }

  // Migrate from old plaintext api_key column if it exists
  const hasOldColumn = columns.some((c) => c.name === "api_key");
  if (hasOldColumn) {
    const rows = db
      .prepare("SELECT slug, api_key FROM tenants WHERE api_key IS NOT NULL")
      .all() as { slug: string; api_key: string }[];
    const update = db.prepare(
      "UPDATE tenants SET api_key_hash = ?, api_key_prefix = ? WHERE slug = ?",
    );
    for (const row of rows) {
      update.run(hashApiKey(row.api_key), row.api_key.slice(0, 7), row.slug);
    }
    db.exec("ALTER TABLE tenants DROP COLUMN api_key");
  }

  registryDb = db;
  return db;
}

/** Initializes the tenant registry database. Call once at startup. */
export function initTenantRegistry(): void {
  getRegistryDb();
}

/** Closes the registry database connection. */
export function closeTenantRegistry(): void {
  if (registryDb) {
    registryDb.close();
    registryDb = null;
  }
}

/**
 * Generates a URL-safe slug from a display name.
 * Lowercases, replaces non-alphanumeric runs with a single hyphen,
 * trims hyphens, caps at 40 chars. Appends `-N` on collision.
 */
function generateSlug(name: string, db: DatabaseType): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

  const exists = db.prepare("SELECT 1 FROM tenants WHERE slug = ?");

  if (!exists.get(base)) return base;

  for (let i = 2; i <= 1000; i++) {
    const candidate = `${base}-${i}`.slice(0, 40);
    if (!exists.get(candidate)) return candidate;
  }
  throw new Error(`Slug space exhausted for base "${base}"`);
}

function generateApiKey(): string {
  return `sk_${randomBytes(32).toString("hex")}`;
}

const FOUNDING_TEAM_LIMIT = 100;

/** Returns the total number of tenants in the registry. */
export function getTenantCount(): number {
  const db = getRegistryDb();
  return (db.prepare("SELECT COUNT(*) AS c FROM tenants").get() as { c: number }).c;
}

/**
 * Creates a new tenant. Returns the public tenant record plus the raw API key.
 * The raw key is only available at creation time -- it is never stored.
 *
 * First 100 teams get "founding" plan with 10 seats free.
 * After that, new teams get "free" plan with 3 seats.
 */
export function createTenant(
  name: string,
  ownerEmail?: string,
): TenantPublic & { apiKey: string } {
  const db = getRegistryDb();
  const slug = generateSlug(name, db);
  const rawKey = generateApiKey();
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = rawKey.slice(0, 7);

  const currentCount = getTenantCount();
  const isFounding = currentCount < FOUNDING_TEAM_LIMIT;
  const plan = isFounding ? "founding" : "free";
  const maxSeats = isFounding ? 10 : 3; // founding = 10 seats, free = 3 seats

  db.prepare(
    "INSERT INTO tenants (slug, name, api_key_hash, api_key_prefix, plan, owner_email, max_seats) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(slug, name, keyHash, keyPrefix, plan, ownerEmail ?? null, maxSeats);

  const tenant = getTenantBySlug(slug)!;
  return {
    slug: tenant.slug,
    name: tenant.name,
    api_key_prefix: tenant.api_key_prefix,
    plan: tenant.plan,
    owner_email: tenant.owner_email,
    max_seats: tenant.max_seats,
    created_at: tenant.created_at,
    apiKey: rawKey,
  };
}

export function getTenantBySlug(slug: string): Tenant | null {
  const db = getRegistryDb();
  return (
    (db.prepare("SELECT * FROM tenants WHERE slug = ?").get(slug) as
      | Tenant
      | undefined) ?? null
  );
}

/** Looks up a tenant by raw API key (hashes it first, compares against stored hash). */
export function getTenantByApiKey(rawKey: string): Tenant | null {
  const db = getRegistryDb();
  const keyHash = hashApiKey(rawKey);
  return (
    (db.prepare("SELECT * FROM tenants WHERE api_key_hash = ?").get(keyHash) as
      | Tenant
      | undefined) ?? null
  );
}

export function listTenants(): TenantPublic[] {
  const db = getRegistryDb();
  return db
    .prepare("SELECT slug, name, api_key_prefix, plan, owner_email, max_seats, created_at FROM tenants ORDER BY created_at")
    .all() as TenantPublic[];
}

/** Exposes the registry DB for user/member queries in auth/member services. */
export function getRegistryDb_(): DatabaseType {
  return getRegistryDb();
}

/**
 * Rotates the API key for a tenant.
 * Returns the new raw key (shown once), or null if tenant not found.
 */
export function rotateApiKey(slug: string): string | null {
  const db = getRegistryDb();
  const newKey = generateApiKey();
  const keyHash = hashApiKey(newKey);
  const keyPrefix = newKey.slice(0, 7);
  const result = db
    .prepare("UPDATE tenants SET api_key_hash = ?, api_key_prefix = ? WHERE slug = ?")
    .run(keyHash, keyPrefix, slug);
  return result.changes > 0 ? newKey : null;
}

/** Deletes a tenant from the registry. Returns true if a row was removed. */
export function deleteTenant(slug: string): boolean {
  const db = getRegistryDb();
  const result = db.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  return result.changes > 0;
}
