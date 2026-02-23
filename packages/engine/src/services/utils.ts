import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const _servicesDir = dirname(fileURLToPath(import.meta.url));

/**
 * Resolves the srcmap workspace root (monorepo root).
 * Centralized here so path depth is defined in one place.
 */
export function getWorkspaceRoot(): string {
  return process.env["SRCMAP_WORKSPACE_ROOT"] ?? resolve(_servicesDir, "../../../..");
}

/** Safely parse a JSON string expected to be a string array. Returns [] on failure. */
export function safeParseJsonArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
