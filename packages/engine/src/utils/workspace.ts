import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspaceConfig, type LoadedWorkspaceConfig } from "../config/workspace-config.js";

/**
 * Walk up the directory tree from `start` until a `pnpm-workspace.yaml` is
 * found, returning that directory as the srcmap monorepo root.
 *
 * @throws if no `pnpm-workspace.yaml` is found before reaching the filesystem root
 */
export function findSrcmapRoot(start: string): string {
  let dir = start;
  while (true) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) {
      throw new Error(
        `Could not find srcmap root — no pnpm-workspace.yaml found above "${start}"`,
      );
    }
    dir = parent;
  }
}

/**
 * Find the user's workspace root — the directory that contains the repos
 * being indexed. By convention this is the parent of the srcmap installation
 * directory (i.e. one level above the pnpm-workspace.yaml).
 *
 * Using `import.meta.url` as the anchor makes this independent of
 * `process.cwd()`, so the result is the same regardless of which directory
 * the caller runs the script from.
 *
 * Usage (in any CLI script):
 *   import { userWorkspaceRootFrom } from "../utils/workspace.js";
 *   const WORKSPACE_ROOT = userWorkspaceRootFrom(import.meta.url);
 */
export function userWorkspaceRootFrom(importMetaUrl: string): string {
  const scriptDir = fileURLToPath(new URL(".", importMetaUrl));
  const srcmapRoot = findSrcmapRoot(scriptDir);
  return resolve(srcmapRoot, "..");
}

/**
 * Load the full workspace configuration, checking for `srcmap.config.json`
 * at the workspace root first and falling back to auto-discovery.
 *
 * This is the recommended entry point for CLI scripts that need both the
 * workspace root and the list of repos.
 */
export function loadWorkspace(importMetaUrl: string): LoadedWorkspaceConfig {
  const workspaceRoot = userWorkspaceRootFrom(importMetaUrl);
  return loadWorkspaceConfig(workspaceRoot);
}
