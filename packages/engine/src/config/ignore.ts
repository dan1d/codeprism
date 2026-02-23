/**
 * .srcmapignore loader — gitignore-style file/directory exclusion.
 *
 * Reads a `.srcmapignore` file from a workspace or repo root and provides
 * an `isIgnored(path)` predicate. User-defined patterns are additive on
 * top of sensible built-in defaults.
 */

import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ignore from "ignore";

/** Built-in patterns always applied, even without a .srcmapignore file. */
const DEFAULT_PATTERNS = [
  "node_modules",
  "vendor",
  ".git",
  "dist",
  "build",
  ".next",
  "tmp",
  "venv",
  ".venv",
];

export interface IgnoreConfig {
  /** Returns true if the file at `absolutePath` should be excluded. */
  isIgnored(absolutePath: string): boolean;
}

/**
 * Load ignore patterns from `.srcmapignore` at `rootDir`.
 *
 * The file uses gitignore syntax (same rules developers already know).
 * Patterns from the file are merged on top of {@link DEFAULT_PATTERNS},
 * so the built-in exclusions always apply as a baseline.
 *
 * When no `.srcmapignore` exists, the built-in defaults are used alone.
 */
export function loadIgnoreConfig(rootDir: string): IgnoreConfig {
  const ig = ignore();
  ig.add(DEFAULT_PATTERNS);

  try {
    const raw = readFileSync(join(rootDir, ".srcmapignore"), "utf-8");
    ig.add(raw);
  } catch {
    // No .srcmapignore — defaults only
  }

  return {
    isIgnored(absolutePath: string): boolean {
      const rel = relative(rootDir, absolutePath).split(sep).join("/");
      if (!rel || rel.startsWith("..")) return false;
      return ig.ignores(rel);
    },
  };
}
