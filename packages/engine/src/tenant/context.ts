import type { FastifyRequest } from "fastify";
import type { Database as DatabaseType } from "better-sqlite3";
import { getDb } from "../db/connection.js";

/**
 * Returns the correct database for the current request.
 *
 * With AsyncLocalStorage in place, `getDb()` already returns the
 * tenant-scoped DB when inside a tenant request context, so this
 * is a thin convenience wrapper.
 */
export function getRequestDb(_request: FastifyRequest): DatabaseType {
  return getDb();
}
