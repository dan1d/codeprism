import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RepoConfig } from "./file-classifier.js";

/**
 * Attempts to load `codeprism.json` from the repo root directory.
 * Returns an empty config if the file doesn't exist or is malformed.
 *
 * Example codeprism.json:
 * {
 *   "testDirs": ["spec", "test", "e2e", "cypress"],
 *   "entryPoints": ["app/javascript/packs/application.js"],
 *   "excludeGraph": ["vendor/bundle", "tmp/"]
 * }
 */
export function loadRepoConfig(repoRootPath: string): RepoConfig {
  const configPath = join(repoRootPath, "codeprism.json");
  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as RepoConfig;
    return {
      testDirs: Array.isArray(parsed.testDirs) ? parsed.testDirs : undefined,
      entryPoints: Array.isArray(parsed.entryPoints) ? parsed.entryPoints : undefined,
      excludeGraph: Array.isArray(parsed.excludeGraph) ? parsed.excludeGraph : undefined,
    };
  } catch {
    return {};
  }
}
