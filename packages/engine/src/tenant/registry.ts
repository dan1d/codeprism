import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { getDataDir } from "../db/connection.js";

export interface Tenant {
  slug: string;
  name: string;
  api_key: string;
  plan: string;
  created_at: string;
}

let registryDb: DatabaseType | null = null;

function getRegistryDbPath(): string {
  return join(getDataDir(), "tenants.db");
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
      slug       TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      api_key    TEXT NOT NULL UNIQUE,
      plan       TEXT NOT NULL DEFAULT 'free',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

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

  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`.slice(0, 40);
    if (!exists.get(candidate)) return candidate;
  }
}

function generateApiKey(): string {
  return `sk_${randomBytes(16).toString("hex")}`;
}

/** Creates a new tenant and returns its record. */
export function createTenant(name: string): Tenant {
  const db = getRegistryDb();
  const slug = generateSlug(name, db);
  const apiKey = generateApiKey();

  db.prepare(
    "INSERT INTO tenants (slug, name, api_key) VALUES (?, ?, ?)",
  ).run(slug, name, apiKey);

  return getTenantBySlug(slug)!;
}

export function getTenantBySlug(slug: string): Tenant | null {
  const db = getRegistryDb();
  return (
    (db.prepare("SELECT * FROM tenants WHERE slug = ?").get(slug) as
      | Tenant
      | undefined) ?? null
  );
}

export function getTenantByApiKey(apiKey: string): Tenant | null {
  const db = getRegistryDb();
  return (
    (db.prepare("SELECT * FROM tenants WHERE api_key = ?").get(apiKey) as
      | Tenant
      | undefined) ?? null
  );
}

export function listTenants(): Tenant[] {
  const db = getRegistryDb();
  return db.prepare("SELECT * FROM tenants ORDER BY created_at").all() as Tenant[];
}

/** Deletes a tenant from the registry. Returns true if a row was removed. */
export function deleteTenant(slug: string): boolean {
  const db = getRegistryDb();
  const result = db.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  return result.changes > 0;
}
