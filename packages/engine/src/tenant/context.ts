import type { FastifyRequest } from "fastify";
import type { Database as DatabaseType } from "better-sqlite3";
import { getDb, getTenantDb } from "../db/connection.js";

/**
 * Returns the correct database for the current request:
 * tenant-scoped DB in multi-tenant mode, singleton DB otherwise.
 */
export function getRequestDb(request: FastifyRequest): DatabaseType {
  if (request.tenant) return getTenantDb(request.tenant);
  return getDb();
}
