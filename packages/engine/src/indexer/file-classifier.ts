import { basename, extname } from "node:path";
import type { FileRole, ParsedFile, Association } from "./types.js";

/**
 * Universal file role classifier.
 *
 * Works across ANY language/framework by combining:
 *  1. Path-segment heuristics (language-agnostic directory names)
 *  2. Filename-basename entry-point detection
 *  3. Content signals (class types already parsed by tree-sitter)
 *  4. Statistical graph signals (inbound import degree — computed post-parse)
 *  5. Optional per-repo srcmap.json config overrides
 */

// ---------------------------------------------------------------------------
// Path-segment test detection (universal across Go, Ruby, JS, Python, etc.)
// ---------------------------------------------------------------------------

/**
 * Path SEGMENTS that reliably indicate test/spec/fixture files across
 * essentially every language ecosystem. We match on path segments (directory
 * names or file name substrings) rather than glob patterns — no language
 * assumptions needed.
 */
const TEST_PATH_SEGMENTS = new Set([
  "test",
  "tests",
  "spec",
  "specs",
  "__tests__",
  "e2e",
  "cypress",
  "playwright",
  "selenium",
  "fixtures",
  "fixture",
  "factories",
  "factory",
  "mocks",
  "mock",
  "stubs",
  "stub",
  "fakes",
  "fake",
  "support",     // RSpec/Cypress support directories
  "helpers",     // test helpers (avoid matching app/helpers in Rails by checking context)
  "scenarios",   // BDD scenarios
  "features",    // Cucumber features
]);

/**
 * File name SUFFIXES (before extension) that indicate test files.
 * Universal: _test.go, _spec.rb, .test.js, .spec.ts, Test.java, Spec.java
 */
const TEST_NAME_PATTERNS = [
  /_test$/,
  /_spec$/,
  /\.test$/,
  /\.spec$/,
  /Test$/,
  /Spec$/,
  /\.e2e$/,
  /\.cy$/,           // Cypress: *.cy.js, *.cy.ts
  /_test_case$/,
  /\.stories$/,      // Storybook (not tests but not domain code either)
];

// ---------------------------------------------------------------------------
// Entry-point basenames (structural, not domain)
// ---------------------------------------------------------------------------

const ENTRY_POINT_BASENAMES = new Set([
  "index",
  "root",
  "app",
  "main",
  "application",
  "entry",
  "bootstrap",
  "setup",
  "server",          // server.ts/rb — usually structural
  "router",          // router.js/ts — wires up routes but not domain
  "routes",          // routes.rb / routes.ts
]);

// ---------------------------------------------------------------------------
// Config file detection
// ---------------------------------------------------------------------------

const CONFIG_PATH_SEGMENTS = new Set([
  "config",
  "configuration",
  "initializers",
  "environments",
  "locales",
  "migrations",      // DB migrations are config-like (schema changes, not logic)
]);

const CONFIG_EXTENSIONS = new Set([
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".env",
  ".lock",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pathSegments(filePath: string): string[] {
  return filePath.toLowerCase().split("/");
}

function fileBasenameWithoutExt(filePath: string): string {
  const base = basename(filePath);
  const ext = extname(base);
  // Handle double extensions: foo.test.ts → foo.test, then test
  return ext ? base.slice(0, -ext.length) : base;
}

// ---------------------------------------------------------------------------
// Role classification
// ---------------------------------------------------------------------------

/**
 * Classify a single file's role using path + content signals.
 * This is the "first pass" — entry-point detection by graph degree
 * is a "second pass" applied in `applyGraphRoles()`.
 */
export function classifyFileRole(
  filePath: string,
  pf: Pick<ParsedFile, "classes" | "associations" | "language">,
  repoConfig?: RepoConfig,
): FileRole {
  const segments = pathSegments(filePath);
  const baseNoExt = fileBasenameWithoutExt(filePath).toLowerCase();
  const ext = extname(filePath).toLowerCase();

  // Config override: explicit test/exclude paths from srcmap.json
  if (repoConfig) {
    if (repoConfig.testDirs?.some((d) => filePath.includes(`/${d}/`))) {
      return "test";
    }
    if (repoConfig.entryPoints?.some((ep) => filePath.endsWith(ep))) {
      return "entry_point";
    }
    if (repoConfig.excludeGraph?.some((ex) => filePath.includes(ex))) {
      return "config";
    }
  }

  // Config extension check (early exit — .yaml, .lock etc have no domain logic)
  if (CONFIG_EXTENSIONS.has(ext) && !filePath.endsWith(".rb")) {
    return "config";
  }

  // Path segment: test directory
  for (const seg of segments) {
    if (TEST_PATH_SEGMENTS.has(seg)) {
      // "helpers" is ambiguous — Rails has app/helpers (domain) and spec/helpers (test)
      if (seg === "helpers" || seg === "support") {
        const hasTestContext = segments.some(
          (s) => s === "spec" || s === "test" || s === "__tests__" || s === "cypress",
        );
        if (!hasTestContext) continue;
      }
      return "test";
    }
  }

  // File name suffix: _test.go, *.spec.ts, Test.java etc
  for (const pattern of TEST_NAME_PATTERNS) {
    if (pattern.test(baseNoExt)) return "test";
  }

  // Class type signal: if tree-sitter already classified the class as "test"
  if (pf.classes.some((c) => c.type === "test")) return "test";

  // Config path segment
  for (const seg of segments) {
    if (CONFIG_PATH_SEGMENTS.has(seg)) {
      // Migrations: tag as config but still include in graph (they affect models)
      if (seg === "migrations") return "config";
      // Only mark as config if the file has no domain classes
      if (pf.classes.length === 0 && (pf.associations as Association[]).length === 0) {
        return "config";
      }
    }
  }

  // Entry-point basename
  if (ENTRY_POINT_BASENAMES.has(baseNoExt)) return "entry_point";

  return "domain";
}

/**
 * Second pass: after graph edges are computed, promote files with very high
 * inbound import degree to "entry_point" (they import everything but have no
 * domain meaning).
 *
 * Also detect polymorphic/shared-utility models and mark them "shared_utility"
 * so graph-builder can downweight their edges.
 */
export function applyGraphRoles(
  files: ParsedFile[],
  inboundImportDegree: Map<string, number>,
  inboundAssocDegree: Map<string, number>,
  IMPORT_HUB_THRESHOLD = 10,
): void {
  for (const pf of files) {
    if (pf.fileRole !== "domain") continue; // already classified

    // High inbound import count → structural entry point
    const importDeg = inboundImportDegree.get(pf.path) ?? 0;
    if (importDeg >= IMPORT_HUB_THRESHOLD) {
      pf.fileRole = "entry_point";
      continue;
    }

    // Polymorphic Rails association → shared utility
    // Universal signal: any model with a polymorphic belongs_to or
    // an association name ending in "able" is a shared concern
    const hasPolymorphic = pf.associations.some(
      (a) =>
        a.options?.includes("polymorphic") ||
        (a.type === "belongs_to" && a.name.endsWith("able")),
    );
    if (hasPolymorphic) {
      pf.fileRole = "shared_utility";
    }
  }
}

/**
 * Compute inbound import and association degree maps from the already-parsed files.
 * Used by `applyGraphRoles`.
 */
export function computeInboundDegrees(files: ParsedFile[]): {
  inboundImport: Map<string, number>;
  inboundAssoc: Map<string, number>;
} {
  const pathSet = new Set(files.map((f) => f.path));
  const inboundImport = new Map<string, number>();
  const inboundAssoc = new Map<string, number>();

  for (const pf of files) {
    // Count associations (rough — just by target_model names mapped to paths)
    for (const assoc of pf.associations) {
      // We don't have a full class index here, so we skip assoc degree
      // (graph-builder will handle this more precisely)
      void assoc;
    }

    // Count inbound imports
    for (const imp of pf.imports) {
      if (!imp.source.startsWith(".")) continue;

      const dir = pf.path.replace(/\/[^/]+$/, "");
      const parts = `${dir}/${imp.source}`.split("/");
      const resolved: string[] = [];
      for (const p of parts) {
        if (p === "..") resolved.pop();
        else if (p !== ".") resolved.push(p);
      }
      const base = resolved.join("/").replace(/\.(js|ts|jsx|tsx|vue|rb|py|go)$/, "");

      // Find matching file
      for (const target of files) {
        const targetBase = target.path.replace(/\.(js|ts|jsx|tsx|vue|rb|py|go)$/, "");
        if (targetBase === base && pathSet.has(target.path)) {
          inboundImport.set(target.path, (inboundImport.get(target.path) ?? 0) + 1);
          break;
        }
      }
    }
  }

  return { inboundImport, inboundAssoc };
}

// ---------------------------------------------------------------------------
// Per-repo srcmap.json config
// ---------------------------------------------------------------------------

export interface RepoConfig {
  /** Directories to always classify as test (e.g. ["spec", "e2e"]) */
  testDirs?: string[];
  /** Specific file paths to force as entry_point */
  entryPoints?: string[];
  /** Path substrings to exclude from graph (marked config) */
  excludeGraph?: string[];
}
