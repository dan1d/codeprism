import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { join, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AsyncLocalStorage } from "node:async_hooks";
import { runMigrations } from "./migrations.js";

export type { DatabaseType };

let instance: DatabaseType | null = null;

const _moduleDir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = join(_moduleDir, "..", "..", "srcmap.db");

const tenantDbStorage = new AsyncLocalStorage<DatabaseType>();

/**
 * Returns the database for the current context:
 * 1. If inside a tenant-scoped AsyncLocalStorage context, returns the tenant DB.
 * 2. Otherwise returns (or lazily creates) the singleton DB for self-hosted / CLI use.
 */
export function getDb(): DatabaseType {
  const scoped = tenantDbStorage.getStore();
  if (scoped) return scoped;

  if (instance) return instance;

  const dbPath = process.env["SRCMAP_DB_PATH"] ?? DEFAULT_DB_PATH;
  const db = new Database(dbPath);

  sqliteVec.load(db);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  instance = db;
  return db;
}

/**
 * Sets the AsyncLocalStorage context so that all downstream `getDb()` calls
 * within the current async context return the given tenant's database.
 * Use in Fastify onRequest hooks via `enterWith`.
 */
export function enterTenantScope(slug: string): void {
  tenantDbStorage.enterWith(getTenantDb(slug));
}

/**
 * Runs `fn` in an AsyncLocalStorage context scoped to the given tenant's DB.
 * All `getDb()` calls inside `fn` (sync or async) return the tenant DB.
 */
export function runWithTenantDb<T>(slug: string, fn: () => T): T {
  return tenantDbStorage.run(getTenantDb(slug), fn);
}

/**
 * Closes the singleton database connection and clears the cached instance.
 * Useful for graceful shutdown and testing.
 */
export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}

/* ------------------------------------------------------------------ */
/*  Multi-tenant connection pool                                       */
/* ------------------------------------------------------------------ */

/** Base directory for per-tenant database files. */
export function getDataDir(): string {
  return process.env["SRCMAP_DATA_DIR"] ?? join(_moduleDir, "..", "..", "data");
}

const MAX_TENANT_POOL_SIZE = 50;
const tenantPool = new Map<string, DatabaseType>();

/**
 * Returns a database connection for the given tenant slug.
 * Creates the file + runs migrations on first access (lazy provisioning).
 * Evicts the oldest connection if the pool exceeds MAX_TENANT_POOL_SIZE.
 */
export function getTenantDb(slug: string): DatabaseType {
  const cached = tenantPool.get(slug);
  if (cached) return cached;

  // Evict oldest entry if pool is full (Map iterates in insertion order)
  if (tenantPool.size >= MAX_TENANT_POOL_SIZE) {
    const oldest = tenantPool.keys().next().value as string;
    const oldDb = tenantPool.get(oldest);
    tenantPool.delete(oldest);
    try { oldDb?.close(); } catch { /* already closed */ }
  }

  const dbPath = join(getDataDir(), "tenants", `${slug}.db`);
  mkdirSync(dirname(dbPath), { recursive: true });

  try {
    const db = new Database(dbPath);
    sqliteVec.load(db);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    runMigrations(db);

    tenantPool.set(slug, db);
    return db;
  } catch (err) {
    tenantPool.delete(slug);
    throw new Error(
      `Failed to open database for tenant "${slug}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Closes and removes a single tenant connection from the pool. */
export function closeTenantDb(slug: string): void {
  const db = tenantPool.get(slug);
  if (db) {
    db.close();
    tenantPool.delete(slug);
  }
}

/** Closes the singleton DB and every pooled tenant DB. */
export function closeAllDbs(): void {
  closeDb();
  for (const [, db] of tenantPool) {
    db.close();
  }
  tenantPool.clear();
}
