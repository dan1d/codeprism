/**
 * route-extractor.ts
 *
 * Extracts business-level "page flows" from FE component directories.
 *
 * Design principle: the **frontend nav/sidebar is the source of truth** for
 * user-visible page names.  The component directory structure is used to group
 * files into flows, but the *name* of each flow is taken from the nav menu
 * `title="..."` attribute whenever a match can be found.
 *
 * Strategy
 * --------
 * 1. Parse nav/sidebar files to extract UI labels (e.g. "Remote Authorizations").
 * 2. Walk every FE parsed file and identify its *leaf* component directory.
 * 3. For each directory, check the nav-label override map first; fall back to
 *    deriving a name from the directory name.
 * 4. Filter out infra/utility dirs.
 * 5. For each surviving dir, find matching BE files by snake_case name matching.
 * 6. Return SeedFlow[] used by flow-detector.
 */

import { readFileSync } from "node:fs";
import type { ParsedFile } from "./tree-sitter.js";
import type { IgnoreConfig } from "../config/ignore.js";

export interface SeedFlow {
  /** Human-readable page/feature name, e.g. "Remote Authorizations" */
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
 *
 * @param discoveredPages - Optional list of page names discovered by the LLM
 *   (from `discoverFrontendPages`). When provided, nav labels are filtered to
 *   only those that match a known page — replacing the old hardcoded
 *   NAV_SKIP_LABELS approach with a project-agnostic LLM-driven one.
 */
export function extractSeedFlows(
  parsedFiles: ParsedFile[],
  feRepoNames: string[],
  discoveredPages?: string[],
  ignoreConfig?: IgnoreConfig,
): SeedFlow[] {
  const filtered = ignoreConfig
    ? parsedFiles.filter((pf) => !ignoreConfig.isIgnored(pf.path))
    : parsedFiles;
  const feRepoSet = new Set(feRepoNames);
  const filesByPath = new Map(filtered.map((f) => [f.path, f]));

  // --- 1. Extract nav labels from sidebar/nav files to build override map ---
  const navOverrides = buildNavOverrides(filtered, feRepoSet, discoveredPages);

  // --- 2. Group FE files by their leaf component directory path ---
  //   key = "PreAuthorizations" or "Billing/OfficeAuthorizations"
  const componentGroups = new Map<string, string[]>();

  for (const pf of filtered) {
    if (!feRepoSet.has(pf.repo)) continue;
    const dirKey = extractLeafComponentDir(pf.path);
    if (!dirKey) continue;
    if (!componentGroups.has(dirKey)) componentGroups.set(dirKey, []);
    componentGroups.get(dirKey)!.push(pf.path);
  }

  // --- 3. Build seed flows ---
  const seeds: SeedFlow[] = [];
  const beFiles = filtered.filter((pf) => !feRepoSet.has(pf.repo));

  for (const [dirKey, fePaths] of componentGroups) {
    const leafName = dirKey.split("/").pop()!;
    if (UTILITY_DIRS.has(leafName.toLowerCase())) continue;
    if (fePaths.length === 0) continue;

    // Prefer the UI nav label; fall back to dir-derived name
    const name = navOverrides.get(dirKey) ?? toDisplayName(leafName);

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

    seeds.push({ name, files: allFiles, repos });
  }

  // Merge seeds that resolve to the same display name
  const merged = mergeDuplicateSeeds(seeds);
  merged.sort((a, b) => b.files.length - a.files.length);
  return merged;
}

// ---------------------------------------------------------------------------
// Nav label extraction
// ---------------------------------------------------------------------------

/**
 * Scans all FE files from nav/sidebar components, extracts title="..." labels,
 * then matches each label to a component directory key.
 *
 * Returns a Map<dirKey, uiLabel> used to override the auto-derived flow name.
 */
function buildNavOverrides(
  parsedFiles: ParsedFile[],
  feRepoSet: Set<string>,
  discoveredPages?: string[],
): Map<string, string> {
  const navFiles = parsedFiles.filter((pf) => {
    if (!feRepoSet.has(pf.repo)) return false;
    const lower = pf.path.toLowerCase();
    return (
      lower.includes("sidebar") ||
      lower.includes("side-bar") ||
      lower.includes("navbar") ||
      lower.includes("nav-bar") ||
      lower.includes("navigation") ||
      lower.includes("sidenav") ||
      lower.includes("menu") ||
      lower.includes("/nav/")
    );
  });

  // Collect all unique UI labels from nav files
  const navLabels: string[] = [];
  for (const nf of navFiles) {
    const labels = extractNavLabels(nf.path, discoveredPages);
    navLabels.push(...labels);
  }

  if (navLabels.length === 0) return new Map();

  // Collect all component directory keys from FE files
  const allDirKeys = new Set<string>();
  for (const pf of parsedFiles) {
    if (!feRepoSet.has(pf.repo)) continue;
    const dk = extractLeafComponentDir(pf.path);
    if (dk) allDirKeys.add(dk);
  }

  // Build override map: dirKey → best matching nav label
  return matchNavLabels(navLabels, [...allDirKeys]);
}

/**
 * Read a nav file and extract all `title="..."` string literals.
 * Also handles `title={'...'}` and `title={"..."}`.
 *
 * When `discoveredPages` is provided (from LLM analysis), only labels that
 * fuzzy-match a known page name are kept — this replaces the old hardcoded
 * NAV_SKIP_LABELS approach with a project-agnostic filter.
 * When `discoveredPages` is absent, all non-JSX labels are kept.
 */
function extractNavLabels(filePath: string, discoveredPages?: string[]): string[] {
  let source: string;
  try {
    source = readFileSync(filePath, "utf8");
  } catch {
    return [];
  }

  const rawLabels: string[] = [];
  // Match title="...", title={'...'}, title={"..."}
  const re = /title=["'{]([^"'{}]{2,60})["'}]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const label = m[1].trim();
    if (!label) continue;
    // Skip labels that look like JSX expressions or variable references
    if (label.includes("{") || label.includes("<") || label.includes("(")) continue;
    rawLabels.push(label);
  }

  const unique = [...new Set(rawLabels)];

  // If LLM-discovered pages are available, use them as an allowlist:
  // keep only nav labels that score ≥ 3 against at least one known page name.
  // This filters out section headers (e.g. "Admin", "Billing") generically.
  if (discoveredPages && discoveredPages.length > 0) {
    return unique.filter((label) =>
      discoveredPages.some((page) => scoreMatch(label.toLowerCase(), page) >= 3 ||
        scoreMatch(page.toLowerCase(), label) >= 3)
    );
  }

  return unique;
}

/**
 * For each nav label, find the best matching component directory key using
 * greedy assignment — highest-scoring (label, dirKey) pair is assigned first,
 * each dirKey claimed only once, each label used only once.
 *
 * Returns Map<dirKey, navLabel>.
 */
function matchNavLabels(navLabels: string[], dirKeys: string[]): Map<string, string> {
  // Score every (label, dirKey) combination
  const candidates: Array<{ label: string; dirKey: string; score: number }> = [];

  for (const label of navLabels) {
    for (const dk of dirKeys) {
      const score = scoreMatch(dk, label);
      if (score >= 3) {
        candidates.push({ label, dirKey: dk, score });
      }
    }
  }

  // Sort by score descending — best matches assigned first
  candidates.sort((a, b) => b.score - a.score);

  const overrides = new Map<string, string>(); // dirKey → navLabel
  const usedLabels = new Set<string>();

  for (const { label, dirKey, score: _score } of candidates) {
    if (overrides.has(dirKey)) continue; // dirKey already claimed
    if (usedLabels.has(label)) continue;  // label already used
    overrides.set(dirKey, label);
    usedLabels.add(label);
  }

  return overrides;
}

/**
 * Score how well a nav label matches a component directory key.
 *
 * Uses ALL label words (no prefix stripping) so that "Office" in a label
 * correctly boosts directories that contain "office" in their name.
 *
 * Scoring rules:
 * - Each label word (≥3 chars) that appears in the leaf dir segment → +3
 * - Each label word that appears anywhere in the dir key → +1
 * - CamelCase of all label words exactly equals the leaf → +10 bonus
 * - Label without spaces exactly equals the leaf → +10 bonus
 */
function scoreMatch(dirKey: string, navLabel: string): number {
  const dk = dirKey.toLowerCase();
  const leafSegment = dk.split("/").pop()!;
  const words = navLabel.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);

  let score = 0;
  for (const w of words) {
    if (leafSegment.includes(w)) score += 3;
    else if (dk.includes(w)) score += 1;
  }

  // CamelCase of label words matches leaf (e.g. "Missed Transmissions" → "missedtransmissions")
  const camelLabel = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("").toLowerCase();
  if (leafSegment === camelLabel) score += 10;

  // Label without spaces matches leaf (e.g. "Remote Reports" → "remotereports" vs "reports")
  const labelNoSpaces = navLabel.toLowerCase().replace(/\s+/g, "");
  if (leafSegment === labelNoSpaces) score += 10;

  return score;
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

    const dirParts: string[] = [];
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!p || p.includes(".")) break;
      if (UTILITY_DIRS.has(p.toLowerCase())) break;
      dirParts.push(p);
    }

    if (dirParts.length === 0) continue;
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
