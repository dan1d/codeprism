import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

let instance: DatabaseType | null = null;

/**
 * Returns a singleton better-sqlite3 database instance with sqlite-vec loaded,
 * WAL journal mode enabled, and foreign keys enforced.
 */
export function getDb(): DatabaseType {
  if (instance) return instance;

  const dbPath = process.env["SRCMAP_DB_PATH"] ?? "./srcmap.db";
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
