/**
 * route-extractor.ts
 *
 * Extracts business-level "page flows" from FE component directories.
 *
 * Design principle: the **frontend defines user flows**.  Each user-facing page
 * or feature area in the FE is a flow.  The BE models, controllers, and
 * serializers that support it are pulled in by name-matching.
 *
 * Strategy
 * --------
 * 1. Walk every FE parsed file and identify its *leaf* component directory.
 *    For nested dirs like `Billing/OfficeAuthorizations/Form.jsx` the leaf
 *    is `OfficeAuthorizations`, not `Billing`.
 * 2. If a top-level dir has sub-directories that are also component dirs
 *    (e.g. Billing/{BillingOrders, OfficeAuthorizations, OfficeBillingOrders}),
 *    each sub-dir becomes its own flow.  The parent dir only gets files that
 *    live directly inside it (not in a sub-dir).
 * 3. Filter out infra/utility dirs.
 * 4. For each surviving dir, find matching BE files (models, controllers,
 *    serializers, policies, services) by snake_case name matching.
 * 5. Return SeedFlow[] used by flow-detector.
 */

import type { ParsedFile } from "./tree-sitter.js";

export interface SeedFlow {
  /** Human-readable page/feature name, e.g. "Office Authorizations" */
  name: string;
  /** All file paths (FE + BE) that belong to this flow */
  files: string[];
  /** Repos represented */
  repos: string[];
}

const UTILITY_DIRS = new Set([
  "common", "forms", "shared", "utils", "utilities", "helpers",
  "layout", "router", "routing", "hooks", "context", "config",
  "assets", "icons", "images", "styles", "types", "constants",
  "lib", "hoc", "wrappers", "providers", "loading", "errors",
  "modals", "usecase",
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract seed flows from a mixed set of parsed files covering multiple repos.
 */
export function extractSeedFlows(
  parsedFiles: ParsedFile[],
  feRepoNames: string[],
): SeedFlow[] {
  const feRepoSet = new Set(feRepoNames);
  const filesByPath = new Map(parsedFiles.map((f) => [f.path, f]));

  // --- 1. Group FE files by their leaf component directory path ---
  //   key = "PreAuthorizations" or "Billing/OfficeAuthorizations"
  const componentGroups = new Map<string, string[]>();

  for (const pf of parsedFiles) {
    if (!feRepoSet.has(pf.repo)) continue;
    const dirKey = extractLeafComponentDir(pf.path);
    if (!dirKey) continue;
    if (!componentGroups.has(dirKey)) componentGroups.set(dirKey, []);
    componentGroups.get(dirKey)!.push(pf.path);
  }

  // --- 2. Build seed flows ---
  const seeds: SeedFlow[] = [];
  const beFiles = parsedFiles.filter((pf) => !feRepoSet.has(pf.repo));

  for (const [dirKey, fePaths] of componentGroups) {
    const leafName = dirKey.split("/").pop()!;
    if (UTILITY_DIRS.has(leafName.toLowerCase())) continue;
    if (fePaths.length === 0) continue;

    const snakePlural = toSnakeCase(leafName);
    const bePatterns = beFilePatterns(snakePlural);

    // Find matching BE files
    const matchedBe: string[] = [];
    for (const pf of beFiles) {
      if (bePatterns.some((pat) => pf.path.includes(pat))) {
        matchedBe.push(pf.path);
      }
    }

    const allFiles = [...fePaths, ...matchedBe];
    const repos = [...new Set(
      allFiles.map((p) => filesByPath.get(p)?.repo ?? "").filter(Boolean),
    )];

    seeds.push({
      name: toDisplayName(leafName),
      files: allFiles,
      repos,
    });
  }

  // Merge seeds that resolve to the same display name
  const merged = mergeDuplicateSeeds(seeds);
  merged.sort((a, b) => b.files.length - a.files.length);
  return merged;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the *leaf* component directory from a file path.
 *
 * For `src/components/Billing/OfficeAuthorizations/Form.jsx`
 * → returns `"Billing/OfficeAuthorizations"` (not just "Billing")
 *
 * For `src/components/Patients/BatchRemoteAuthorizationsModal.jsx`
 * → returns `"Patients"` (file sits directly in top-level dir)
 *
 * For `src/components/OfficeChecks/UseCase/CreateOfficeCheck.js`
 * → returns `"OfficeChecks"` (UseCase is in UTILITY_DIRS, so we go up)
 */
function extractLeafComponentDir(filePath: string): string | undefined {
  const normalised = filePath.replace(/\\/g, "/");

  const markers = ["/components/", "/pages/", "/views/", "/features/", "/screens/"];
  for (const marker of markers) {
    const idx = normalised.indexOf(marker);
    if (idx === -1) continue;

    const afterMarker = normalised.slice(idx + marker.length);
    const parts = afterMarker.split("/");

    // parts = ["Billing", "OfficeAuthorizations", "Form.jsx"]
    // We want everything except the final filename, but only keep non-utility dirs
    const dirParts: string[] = [];
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!p || p.includes(".")) break;
      if (UTILITY_DIRS.has(p.toLowerCase())) break; // stop at utility dirs
      dirParts.push(p);
    }

    if (dirParts.length === 0) continue;

    // If there are sub-directories (e.g. Billing/OfficeAuthorizations),
    // return the full path so each sub-page is its own flow.
    // If it's just the top-level (e.g. Patients), return that.
    return dirParts.join("/");
  }

  return undefined;
}

function toSnakeCase(name: string): string {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .toLowerCase();
}

function toDisplayName(dirName: string): string {
  return dirName.replace(/([A-Z])/g, " $1").trim();
}

/**
 * Generates candidate BE file path substrings from a snake_case resource name.
 * Also handles the "in_office" Rails naming convention.
 */
function beFilePatterns(snakePlural: string): string[] {
  const singular = singularize(snakePlural);

  const patterns = [
    `models/${singular}.rb`,
    `models/${snakePlural}.rb`,
    `controllers/${snakePlural}_controller.rb`,
    `controllers/${singular}_controller.rb`,
    `controllers/${snakePlural}/`,
    `serializers/${singular}_serializer.rb`,
    `policies/${singular}_policy.rb`,
    `services/${snakePlural}`,
    `presenters/${singular}`,
  ];

  // Rails uses "in_office_authorizations" for "OfficeAuthorizations" sometimes
  if (snakePlural.startsWith("office_")) {
    const inOffice = "in_" + snakePlural;
    const inOfficeSingular = singularize(inOffice);
    patterns.push(
      `controllers/${inOffice}_controller.rb`,
      `controllers/${inOfficeSingular}_controller.rb`,
      `models/${inOfficeSingular}.rb`,
    );
  }

  return patterns;
}

function singularize(word: string): string {
  if (word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.endsWith("ses") || word.endsWith("xes") || word.endsWith("ches"))
    return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/**
 * Merge seeds that have the same display name (can happen when the same
 * component dir appears in multiple FE repos).
 */
function mergeDuplicateSeeds(seeds: SeedFlow[]): SeedFlow[] {
  const byName = new Map<string, SeedFlow>();
  for (const s of seeds) {
    const existing = byName.get(s.name);
    if (existing) {
      existing.files = [...new Set([...existing.files, ...s.files])];
      existing.repos = [...new Set([...existing.repos, ...s.repos])];
    } else {
      byName.set(s.name, { ...s });
    }
  }
  return [...byName.values()];
}
