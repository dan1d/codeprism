/**
 * route-extractor.ts
 *
 * Extracts business-level "seed flows" from FE component directories so that
 * flow detection is driven by what users *see and do*, not by what the code
 * graph happens to cluster around.
 *
 * Strategy
 * --------
 * 1. For each FE parsed file, identify which top-level component directory it
 *    belongs to  (e.g. "PreAuthorizations" from src/components/PreAuthorizations/Form.jsx).
 * 2. Filter out generic/utility directories that represent shared infrastructure,
 *    not discrete user-facing features.
 * 3. For each surviving business directory, find matching BE files by converting
 *    the directory name to snake_case resource names and matching against model /
 *    controller paths in the parsed-file index.
 * 4. Return a SeedFlow[] that the flow-detector can use to pre-assign files
 *    before running Louvain on the remainder.
 */

import { join, relative, sep } from "node:path";
import type { ParsedFile } from "./tree-sitter.js";

export interface SeedFlow {
  /** Human-readable business name, e.g. "Pre Authorizations" */
  name: string;
  /** All file paths (FE + BE) that belong to this flow */
  files: string[];
  /** Repos represented */
  repos: string[];
}

// Component directories that are infrastructure / shared utilities, not features
const UTILITY_DIRS = new Set([
  "common",
  "forms",
  "shared",
  "utils",
  "utilities",
  "helpers",
  "layout",
  "router",
  "routing",
  "hooks",
  "context",
  "config",
  "assets",
  "icons",
  "images",
  "styles",
  "types",
  "constants",
  "lib",
  "hoc",
  "wrappers",
  "providers",
  "auth",        // often infra-level, not feature
  "loading",
  "errors",
  "modals",      // generic modal infra — specific modals are named in their feature dir
]);

/**
 * Converts a PascalCase or camelCase directory name to snake_case.
 * "PreAuthorizations" → "pre_authorizations"
 * "OfficeChecks"     → "office_checks"
 */
function toSnakeCase(name: string): string {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .toLowerCase();
}

/**
 * "Pre Authorizations" from "PreAuthorizations"
 * "Office Checks"     from "OfficeChecks"
 */
function toDisplayName(dirName: string): string {
  return dirName.replace(/([A-Z])/g, " $1").trim();
}

/**
 * Given a snake_case resource name like "pre_authorizations", return candidate
 * BE file path substrings to match against:
 *   - models/pre_authorization.rb  (singular)
 *   - controllers/pre_authorizations_controller.rb  (plural)
 *   - controllers/pre_authorizations/  (namespaced controllers)
 */
function beFilePatterns(snakePlural: string): string[] {
  // Naive singularisation — handles the most common English plurals
  const singular = snakePlural.endsWith("ies")
    ? snakePlural.slice(0, -3) + "y"
    : snakePlural.endsWith("ses") || snakePlural.endsWith("xes") || snakePlural.endsWith("ches")
    ? snakePlural.slice(0, -2)
    : snakePlural.endsWith("s")
    ? snakePlural.slice(0, -1)
    : snakePlural;

  return [
    `models/${singular}.rb`,
    `models/${snakePlural}.rb`,
    `controllers/${snakePlural}_controller.rb`,
    `controllers/${singular}_controller.rb`,
    `controllers/${snakePlural}/`,   // namespaced controllers dir
    `serializers/${singular}_serializer.rb`,
    `policies/${singular}_policy.rb`,
    `services/${snakePlural}`,
  ];
}

/**
 * Extract seed flows from a mixed set of parsed files covering multiple repos.
 *
 * @param parsedFiles  All parsed files (FE + BE combined)
 * @param feRepoNames  Names of FE repos (used to identify component dirs)
 */
export function extractSeedFlows(
  parsedFiles: ParsedFile[],
  feRepoNames: string[],
): SeedFlow[] {
  const feRepoSet = new Set(feRepoNames);
  const filesByPath = new Map(parsedFiles.map((f) => [f.path, f]));

  // --- 1. Group FE files by their top-level component directory ---
  const componentGroups = new Map<string, string[]>(); // dirName → [filePath]

  for (const pf of parsedFiles) {
    if (!feRepoSet.has(pf.repo)) continue;

    // Find the components/ (or pages/) segment in the path
    const componentDirName = extractComponentDir(pf.path);
    if (!componentDirName) continue;

    const key = componentDirName; // preserve original case for matching
    if (!componentGroups.has(key)) componentGroups.set(key, []);
    componentGroups.get(key)!.push(pf.path);
  }

  // --- 2. Build seed flows ---
  const seeds: SeedFlow[] = [];

  for (const [dirName, fePaths] of componentGroups) {
    // Skip utility directories
    if (UTILITY_DIRS.has(dirName.toLowerCase())) continue;
    // Skip directories that are a single file name (e.g. "Authenticated.jsx")
    if (fePaths.length === 0) continue;

    const snakePlural = toSnakeCase(dirName);
    const bePatterns = beFilePatterns(snakePlural);

    // --- 3. Find matching BE files ---
    const beFiles: string[] = [];
    for (const pf of parsedFiles) {
      if (feRepoSet.has(pf.repo)) continue; // skip FE files in BE search
      if (bePatterns.some((pat) => pf.path.includes(pat))) {
        beFiles.push(pf.path);
      }
    }

    const allFiles = [...fePaths, ...beFiles];
    const repos = [...new Set(allFiles.map((p) => filesByPath.get(p)?.repo ?? "").filter(Boolean))];

    seeds.push({
      name: toDisplayName(dirName),
      files: allFiles,
      repos,
    });
  }

  // Sort by descending file count so the most substantial flows come first
  seeds.sort((a, b) => b.files.length - a.files.length);
  return seeds;
}

/**
 * Extracts the top-level component/pages directory name from a file path.
 *
 * "/abs/path/to/repo/src/components/PreAuthorizations/Form.jsx"
 *   → "PreAuthorizations"
 *
 * "/abs/path/to/repo/src/pages/Dashboard/index.tsx"
 *   → "Dashboard"
 *
 * Returns undefined if no component-style directory is found.
 */
function extractComponentDir(filePath: string): string | undefined {
  const normalised = filePath.replace(/\\/g, "/");

  // Look for common FE source directory markers
  const markers = ["/components/", "/pages/", "/views/", "/features/", "/screens/"];
  for (const marker of markers) {
    const idx = normalised.indexOf(marker);
    if (idx === -1) continue;

    const afterMarker = normalised.slice(idx + marker.length);
    const parts = afterMarker.split("/");
    const dirName = parts[0];

    // Must be a non-empty name that doesn't look like a file itself
    if (!dirName || dirName.includes(".")) continue;

    return dirName;
  }

  return undefined;
}
