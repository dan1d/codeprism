import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { join, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runMigrations } from "./migrations.js";

export type { DatabaseType };

let instance: DatabaseType | null = null;

// Resolve a stable default DB path relative to this module's location so that
// both the server (started from any cwd) and the CLI indexer always share the
// same file when SRCMAP_DB_PATH is not set.
const _moduleDir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = join(_moduleDir, "..", "..", "srcmap.db");

/**
 * Returns a singleton better-sqlite3 database instance with sqlite-vec loaded,
 * WAL journal mode enabled, and foreign keys enforced.
 */
export function getDb(): DatabaseType {
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

const tenantPool = new Map<string, DatabaseType>();

/**
 * Returns a database connection for the given tenant slug.
 * Creates the file + runs migrations on first access (lazy provisioning).
 */
export function getTenantDb(slug: string): DatabaseType {
  const cached = tenantPool.get(slug);
  if (cached) return cached;

  const dbPath = join(getDataDir(), "tenants", `${slug}.db`);
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  sqliteVec.load(db);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  runMigrations(db);

  tenantPool.set(slug, db);
  return db;
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
