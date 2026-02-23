/**
 * Project documentation generator.
 *
 * Generates structured documentation (About, Architecture, CodeStyle, Rules,
 * Styles, README) for each repository BEFORE card generation. The docs are
 * persisted in `project_docs` and injected as context into every card prompt,
 * giving the LLM high-level business understanding of the codebase.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Workspace root — set once from index-repos.ts before any doc is generated.
// Used to store relative paths in the DB instead of absolute machine paths.
// ---------------------------------------------------------------------------
let _workspaceRoot = "";

/** Call this once at the start of indexing with the absolute workspace root. */
export function setWorkspaceRoot(root: string): void {
  _workspaceRoot = root;
}

function relativizePath(absPath: string): string {
  if (!_workspaceRoot) return absPath;
  const prefix = _workspaceRoot.endsWith("/") ? _workspaceRoot : `${_workspaceRoot}/`;
  if (!prefix || prefix === "/") return absPath;
  return absPath.startsWith(prefix) ? absPath.slice(prefix.length) : absPath;
}
import { execSync } from "node:child_process";
import { nanoid } from "nanoid";
import { getDb } from "../db/connection.js";
import type { ProjectDoc } from "../db/schema.js";
import type { LLMProvider } from "../llm/provider.js";
import type { ParsedFile } from "./types.js";
import {
  DOC_SYSTEM_PROMPT,
  buildReadmePrompt,
  buildAboutPrompt,
  buildArchitecturePrompt,
  buildCodeStylePrompt,
  buildRulesPrompt,
  buildStylesPrompt,
  buildMemoryDocPrompt,
  buildSpecialistPrompt,
  buildApiContractsPrompt,
  buildChangelogPrompt,
  buildPagesPrompt,
  buildBeOverviewPrompt,
  buildBusinessPrompt,
  buildProductPrompt,
  buildCrossRepoPrompt,
  buildFrameworkBaseline,
  buildFrameworkArchitectureOnly,
  type DocType,
  type MemoryInput,
} from "./doc-prompts.js";
import { resolveSkills } from "../skills/index.js";
import { loadAllKnowledge } from "../skills/knowledge-loader.js";
import type { StackProfile } from "./stack-profiler.js";
import type { GitSignals } from "./git-signals.js";
import { getFileHeat, isInStaleDir } from "./git-signals.js";

// Max lines to include per file in doc prompts (keep costs low)
const MAX_DOC_FILE_LINES = 120;

// ---------------------------------------------------------------------------
// Phase 0 helpers — README seeding + heat-ordered file selection
// ---------------------------------------------------------------------------

/**
 * Reads the first existing README from a repo root directory (no LLM, no cost).
 * Returns up to 2000 chars to use as a prompt seed.
 */
export async function seedFromReadme(repoAbsPath: string): Promise<string> {
  const candidates = ["README.md", "readme.md", "README.rst", "README"];
  for (const name of candidates) {
    try {
      const raw = await import("node:fs/promises").then((m) =>
        m.readFile(join(repoAbsPath, name), "utf-8"),
      );
      return raw.slice(0, 2000);
    } catch {
      // try next candidate
    }
  }
  return "";
}

/**
 * Sorts parsed files by git heat descending and filters out stale directories.
 * Hot files (touched recently and often) float to the top of LLM prompts.
 */
export function selectByHeat(
  files: ParsedFile[],
  signals: GitSignals | null,
  max = 8,
): ParsedFile[] {
  if (!signals) return files.slice(0, max);

  return files
    .filter((f) => !isInStaleDir(f.path, signals.staleDirectories))
    .sort(
      (a, b) =>
        getFileHeat(b.path, signals.thermalMap) -
        getFileHeat(a.path, signals.thermalMap),
    )
    .slice(0, max);
}
// Small inter-call delay — doc generation is less rate-sensitive than cards
const DOC_INTER_CALL_DELAY_MS = 1000;

let lastDocLlmCallAt = 0;

interface SourceFile {
  path: string;
  content: string;
}

// ---------------------------------------------------------------------------
// File reading
// ---------------------------------------------------------------------------

function readTruncated(filePath: string, maxLines = MAX_DOC_FILE_LINES): string {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const lines = raw.split("\n");
    if (lines.length <= maxLines) return raw.trimEnd();
    return lines.slice(0, maxLines).join("\n") + `\n... (${lines.length - maxLines} more lines)`;
  } catch {
    return "";
  }
}

function tryRead(repoPath: string, relPaths: string[]): SourceFile | null {
  for (const rel of relPaths) {
    const abs = join(repoPath, rel);
    if (existsSync(abs)) {
      const content = readTruncated(abs);
      if (content) return { path: abs, content };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// File selection per doc type
// ---------------------------------------------------------------------------

function selectReadmeFiles(repoPath: string, parsed: ParsedFile[]): SourceFile[] {
  const files: SourceFile[] = [];

  // Package manager / project descriptor
  const pkgFile =
    tryRead(repoPath, ["package.json"]) ??
    tryRead(repoPath, ["Gemfile"]) ??
    tryRead(repoPath, ["pyproject.toml", "setup.py", "go.mod"]);
  if (pkgFile) files.push(pkgFile);

  // Existing README (may be partial / wrong — we use as context, not replacement)
  const readme = tryRead(repoPath, ["README.md", "README.rst", "README"]);
  if (readme) files.push({ ...readme, content: readTruncated(readme.path, 60) });

  // Main config / scripts
  const config =
    tryRead(repoPath, ["Makefile"]) ??
    tryRead(repoPath, [".env.example", ".env.sample"]);
  if (config) files.push(config);

  return files;
}

function selectAboutFiles(repoPath: string, parsed: ParsedFile[]): SourceFile[] {
  const files: SourceFile[] = [];

  // Same seed files as README but focus on the top models for domain context
  const pkg = tryRead(repoPath, ["package.json"]) ?? tryRead(repoPath, ["Gemfile"]);
  if (pkg) files.push(pkg);

  // Top 4 models by association count — they reveal the business domain
  const topModels = parsed
    .filter((f) => f.fileRole === "domain" && f.associations.length > 0)
    .sort((a, b) => b.associations.length - a.associations.length)
    .slice(0, 4);

  for (const model of topModels) {
    const content = readTruncated(model.path, 80);
    if (content) files.push({ path: model.path, content });
  }

  return files;
}

function selectArchitectureFiles(repoPath: string, parsed: ParsedFile[]): SourceFile[] {
  const files: SourceFile[] = [];

  // Routes file (Rails or JS router)
  const routes =
    tryRead(repoPath, ["config/routes.rb"]) ??
    tryRead(repoPath, ["src/routes/index.ts", "src/routes/index.js", "src/router/index.ts", "src/router/index.js", "routes/index.js"]);
  if (routes) files.push({ ...routes, content: readTruncated(routes.path, 150) });

  // DB schema — richest source of architectural truth for Rails apps
  const schema = tryRead(repoPath, ["db/schema.rb"]);
  if (schema) files.push({ ...schema, content: readTruncated(schema.path, 100) });

  // Top 5 most-connected domain models
  const topModels = parsed
    .filter((f) => f.fileRole === "domain" && f.classes.some((c) => c.type === "model"))
    .sort((a, b) => b.associations.length - a.associations.length)
    .slice(0, 5);
  for (const m of topModels) {
    const content = readTruncated(m.path, 60);
    if (content) files.push({ path: m.path, content });
  }

  // App entry point(s) for FE repos
  const entries = parsed.filter((f) => f.fileRole === "entry_point").slice(0, 2);
  for (const e of entries) {
    const content = readTruncated(e.path, 60);
    if (content) files.push({ path: e.path, content });
  }

  return files;
}

function selectCodeStyleFiles(parsed: ParsedFile[]): SourceFile[] {
  // Sample diverse domain files: 2 models, 2 controllers, 2 components/api, 2 other
  const pick = (role: string, type: string, max: number) =>
    parsed
      .filter((f) => f.fileRole === role && f.classes.some((c) => c.type === type))
      .slice(0, max);

  const models = pick("domain", "model", 2);
  const controllers = pick("domain", "controller", 2);
  const components = parsed
    .filter((f) => f.fileRole === "domain" && (f.apiCalls.length > 0 || f.classes.some((c) => c.type === "component")))
    .slice(0, 2);
  const others = parsed
    .filter((f) => f.fileRole === "domain")
    .filter((f) => !models.includes(f) && !controllers.includes(f) && !components.includes(f))
    .slice(0, 2);

  return [...models, ...controllers, ...components, ...others]
    .map((f) => ({ path: f.path, content: readTruncated(f.path, 60) }))
    .filter((f) => f.content);
}

function selectRulesFiles(repoPath: string, parsed: ParsedFile[]): SourceFile[] {
  const files: SourceFile[] = [];

  // Models with most validations (primary source of business rules)
  const validationRich = parsed
    .filter((f) => f.fileRole === "domain" && f.validations.length > 1)
    .sort((a, b) => b.validations.length - a.validations.length)
    .slice(0, 5);
  for (const f of validationRich) {
    const content = readTruncated(f.path, 100);
    if (content) files.push({ path: f.path, content });
  }

  // Pundit policies
  const policies = parsed
    .filter((f) => f.path.includes("/policies/") || f.path.includes("_policy.rb"))
    .slice(0, 4);
  for (const f of policies) {
    const content = readTruncated(f.path, 80);
    if (content) files.push({ path: f.path, content });
  }

  // Concerns / mixins
  const concerns = parsed
    .filter((f) => f.path.includes("/concerns/") && f.fileRole === "domain")
    .slice(0, 3);
  for (const f of concerns) {
    const content = readTruncated(f.path, 80);
    if (content) files.push({ path: f.path, content });
  }

  return files;
}

function selectStylesFiles(repoPath: string, parsed: ParsedFile[]): SourceFile[] {
  // Only meaningful for frontend repos
  const cssFiles = parsed
    .filter((f) =>
      f.path.endsWith(".scss") ||
      f.path.endsWith(".css") ||
      f.path.endsWith(".less") ||
      f.path.endsWith(".sass")
    )
    .filter((f) => !f.path.includes("node_modules"))
    .slice(0, 6);

  // Also check for design token files
  const tokens = tryRead(repoPath, [
    "src/styles/variables.scss",
    "src/styles/_variables.scss",
    "src/styles/tokens.css",
    "src/theme.js",
    "src/theme.ts",
  ]);

  const results: SourceFile[] = [];
  if (tokens) results.push(tokens);
  for (const f of cssFiles) {
    const content = readTruncated(f.path, 80);
    if (content) results.push({ path: f.path, content });
  }
  return results;
}

function selectApiContractsFiles(repoPath: string, _parsed: ParsedFile[]): SourceFile[] {
  const files: SourceFile[] = [];

  // Rails routes file — backbone of a BE API surface
  const routes = tryRead(repoPath, ["config/routes.rb"]);
  if (routes) files.push({ ...routes, content: readTruncated(routes.path, 200) });

  // OpenAPI / Swagger specification files
  const openapi = tryRead(repoPath, [
    "openapi.yaml", "swagger.yaml", "openapi.json", "swagger.json", "docs/api.yaml",
  ]);
  if (openapi) files.push({ ...openapi, content: readTruncated(openapi.path, 200) });

  // src/routes/ directory — collect up to 3 JS/TS route files
  const routesDir = join(repoPath, "src", "routes");
  if (existsSync(routesDir)) {
    try {
      const entries = readdirSync(routesDir)
        .filter((e) => /\.(js|ts|jsx|tsx)$/.test(e))
        .slice(0, 3);
      for (const entry of entries) {
        const abs = join(routesDir, entry);
        const content = readTruncated(abs, 80);
        if (content) files.push({ path: abs, content });
      }
    } catch { /* ignore */ }
  }

  // app/controllers/api/ — Rails API controllers, up to 3 files
  const apiControllersDir = join(repoPath, "app", "controllers", "api");
  if (existsSync(apiControllersDir)) {
    try {
      const entries = readdirSync(apiControllersDir)
        .filter((e) => e.endsWith(".rb"))
        .slice(0, 3);
      for (const entry of entries) {
        const abs = join(apiControllersDir, entry);
        const content = readTruncated(abs, 80);
        if (content) files.push({ path: abs, content });
      }
    } catch { /* ignore */ }
  }

  return files;
}

function selectChangelogFiles(repoPath: string): string[] {
  try {
    const output = execSync("git log --oneline --no-merges -30", {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Selects nav/sidebar files + page index files for FE page discovery.
 * Returns at most 15 files to keep the prompt cost low.
 */
function selectPagesFiles(repoPath: string, parsed: ParsedFile[]): SourceFile[] {
  const results: SourceFile[] = [];
  const seen = new Set<string>();

  const add = (path: string, maxLines = MAX_DOC_FILE_LINES) => {
    if (seen.has(path)) return;
    seen.add(path);
    const content = readTruncated(path, maxLines);
    if (content) results.push({ path, content });
  };

  // Nav / sidebar files — highest signal for page names
  const navFiles = parsed.filter((pf) => {
    const lower = pf.path.toLowerCase();
    return (
      lower.includes("sidebar") ||
      lower.includes("side-bar") ||
      lower.includes("navbar") ||
      lower.includes("nav-bar") ||
      lower.includes("navigation") ||
      lower.includes("sidenav") ||
      lower.includes("/nav/") ||
      lower.includes("/menu")
    );
  });
  for (const nf of navFiles.slice(0, 4)) add(nf.path, 150);

  // Router / routes file — shows all routes in one place
  const routerFile =
    tryRead(repoPath, ["src/router/index.ts", "src/router/index.js", "src/routes/index.ts", "src/routes/index.js"]) ??
    tryRead(repoPath, ["src/App.tsx", "src/App.jsx", "src/App.vue"]);
  if (routerFile) add(routerFile.path, 120);

  // Page index files — index.tsx/jsx/vue inside feature directories
  const pageIndexFiles = parsed
    .filter((pf) => {
      const lower = pf.path.toLowerCase();
      const base = pf.path.split("/").at(-1)?.toLowerCase() ?? "";
      return (
        (base === "index.tsx" || base === "index.jsx" || base === "index.vue" || base === "index.js") &&
        (lower.includes("/pages/") || lower.includes("/views/") || lower.includes("/screens/"))
      );
    })
    .slice(0, 8);
  for (const pf of pageIndexFiles) add(pf.path, 60);

  return results.slice(0, 15);
}

/**
 * Selects routes + top API controllers for BE overview discovery.
 */
function selectBeOverviewFiles(repoPath: string, parsed: ParsedFile[]): SourceFile[] {
  const results: SourceFile[] = [];
  const seen = new Set<string>();

  const add = (path: string, maxLines = MAX_DOC_FILE_LINES) => {
    if (seen.has(path)) return;
    seen.add(path);
    const content = readTruncated(path, maxLines);
    if (content) results.push({ path, content });
  };

  // Rails routes file
  const railsRoutes = tryRead(repoPath, ["config/routes.rb"]);
  if (railsRoutes) add(railsRoutes.path, 200);

  // OpenAPI spec
  const openapi = tryRead(repoPath, ["openapi.yaml", "swagger.yaml", "openapi.json", "swagger.json", "docs/api.yaml"]);
  if (openapi) add(openapi.path, 150);

  // JS/TS router files
  const jsRouter = tryRead(repoPath, ["src/routes/index.ts", "src/routes/index.js", "routes/index.js"]);
  if (jsRouter) add(jsRouter.path, 120);

  // Top controllers by association richness
  const controllers = parsed
    .filter((f) => f.classes.some((c) => c.type === "controller") && f.fileRole === "domain")
    .sort((a, b) => b.associations.length - a.associations.length)
    .slice(0, 5);
  for (const c of controllers) add(c.path, 80);

  return results.slice(0, 10);
}

/**
 * Parses the LLM-generated Pages.md content to extract a flat list of page names.
 * Looks for lines matching: `- **Page Name** — description`
 */
function parsePageNamesFromContent(content: string): string[] {
  const names: string[] = [];
  const re = /^[-*]\s+\*{1,2}([^*]+)\*{1,2}/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const name = m[1]!.trim();
    if (name.length > 1 && name.length < 60) names.push(name);
  }
  return [...new Set(names)];
}

// ---------------------------------------------------------------------------
// Changelog formatting (no LLM for conventional commits)
// ---------------------------------------------------------------------------

const CONVENTIONAL_PREFIX_RE =
  /^[0-9a-f]{7,} (feat|fix|chore|docs|refactor|test|style|perf|ci|build)(\(.+?\))?!?: /;

function hasConventionalCommits(messages: string[]): boolean {
  if (messages.length === 0) return false;
  const matching = messages.filter((m) => CONVENTIONAL_PREFIX_RE.test(m));
  return matching.length >= Math.min(3, Math.ceil(messages.length * 0.3));
}

function formatConventionalChangelog(repoName: string, messages: string[]): string {
  const SECTION_KEYS = ["feat", "fix", "refactor", "docs", "chore", "other"] as const;
  type SectionKey = (typeof SECTION_KEYS)[number];

  const grouped: Record<SectionKey, string[]> = {
    feat: [], fix: [], refactor: [], docs: [], chore: [], other: [],
  };

  const SECTION_MAP: Record<string, SectionKey> = {
    feat: "feat", fix: "fix", refactor: "refactor", docs: "docs",
    chore: "chore", ci: "chore", build: "chore", test: "chore",
    style: "other", perf: "other",
  };

  for (const msg of messages) {
    const match = msg.match(
      /^[0-9a-f]{7,} (feat|fix|chore|docs|refactor|test|style|perf|ci|build)(\((.+?)\))?!?: (.+)/,
    );
    if (match) {
      const type = match[1]!;
      const scope = match[3] ?? null;
      const description = match[4]!;
      const group: SectionKey = SECTION_MAP[type] ?? "other";
      grouped[group].push(scope ? `**${scope}**: ${description}` : description);
    } else {
      grouped.other.push(msg.replace(/^[0-9a-f]{7,} /, ""));
    }
  }

  const SECTION_LABELS: Record<SectionKey, string> = {
    feat: "New Features", fix: "Bug Fixes", refactor: "Refactoring",
    docs: "Documentation", chore: "Maintenance", other: "Other Changes",
  };

  const lines: string[] = [`# ${repoName} — Recent Changes\n`];
  for (const key of SECTION_KEYS) {
    const items = grouped[key];
    if (items.length > 0) {
      lines.push(`## ${SECTION_LABELS[key]}`);
      for (const item of items) lines.push(`- ${item}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// LLM call with light throttle
// ---------------------------------------------------------------------------

async function callDocLlm(
  llm: LLMProvider,
  prompt: string,
  label: string,
  maxTokens = 1200,
): Promise<string> {
  const now = Date.now();
  const wait = DOC_INTER_CALL_DELAY_MS - (now - lastDocLlmCallAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastDocLlmCallAt = Date.now();

  const content = await llm.generate(prompt, {
    systemPrompt: DOC_SYSTEM_PROMPT,
    maxTokens,
  });
  console.log(`  [doc] ${label} — ~${Math.ceil(content.length / 4)} output tokens`);
  return content;
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

function upsertDoc(doc: {
  repo: string;
  doc_type: DocType;
  title: string;
  content: string;
  sourceFilePaths: string[];
}): void {
  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM project_docs WHERE repo = ? AND doc_type = ?")
    .get(doc.repo, doc.doc_type) as { id: string } | undefined;

  const id = existing?.id ?? nanoid();
  // TODO: populate applied_baseline_hash (sha1 of the frameworkBaseline used) once
  // baseline-staleness detection is implemented. The column exists (migration v17);
  // wire it here and add a staleness check in docExists() to trigger regeneration
  // when sha1(currentBaseline) != stored_hash.
  db.prepare(`
    INSERT INTO project_docs (id, repo, doc_type, title, content, stale, source_file_paths, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, ?, datetime('now'))
    ON CONFLICT (repo, doc_type) DO UPDATE SET
      title             = excluded.title,
      content           = excluded.content,
      stale             = 0,
      source_file_paths = excluded.source_file_paths,
      updated_at        = datetime('now')
  `).run(id, doc.repo, doc.doc_type, doc.title, doc.content, JSON.stringify(doc.sourceFilePaths.map(relativizePath)));
}

function docExists(repo: string, docType: DocType): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT 1 FROM project_docs WHERE repo = ? AND doc_type = ? AND stale = 0")
    .get(repo, docType);
  return !!row;
}

// ---------------------------------------------------------------------------
// Early-stage page / BE discovery (runs before flow detection)
// ---------------------------------------------------------------------------

/**
 * Analyzes FE nav and page files with the LLM to produce a "pages" doc and
 * returns the list of discovered page names so route-extractor can use them
 * instead of a hardcoded NAV_SKIP_LABELS list.
 *
 * No-ops when LLM is unavailable or the doc already exists and is fresh.
 * Returns an empty array in those cases so the caller can fall back gracefully.
 */
export async function discoverFrontendPages(
  repoName: string,
  repoPath: string,
  parsedFiles: ParsedFile[],
  llm: LLMProvider | null,
): Promise<string[]> {
  if (!llm) return [];

  // If a fresh pages doc already exists, load the names from it
  const db = getDb();
  const existing = db
    .prepare("SELECT content FROM project_docs WHERE repo = ? AND doc_type = 'pages' AND stale = 0")
    .get(repoName) as { content: string } | undefined;
  if (existing) {
    return parsePageNamesFromContent(existing.content);
  }

  const files = selectPagesFiles(repoPath, parsedFiles);
  if (files.length === 0) return [];

  console.log(`  [pages] discovering FE pages for ${repoName} (${files.length} files)`);
  try {
    const prompt = buildPagesPrompt(repoName, files);
    const content = await callDocLlm(llm, prompt, `${repoName}/pages`, 1000);
    upsertDoc({
      repo: repoName,
      doc_type: "pages",
      title: `${repoName} — Pages`,
      content,
      sourceFilePaths: files.map((f) => f.path),
    });
    return parsePageNamesFromContent(content);
  } catch (err) {
    console.warn(`  [pages] failed for ${repoName}: ${err}`);
    return [];
  }
}

/**
 * Analyzes BE routes and controllers with the LLM to produce a "be_overview" doc.
 * Runs before flow detection so the doc is available early for the UI.
 *
 * No-ops when LLM is unavailable or the doc already exists and is fresh.
 */
export async function discoverBeOverview(
  repoName: string,
  repoPath: string,
  parsedFiles: ParsedFile[],
  llm: LLMProvider | null,
  fePagesContext = "",
  branchContext?: import("./doc-prompts.js").BranchContext,
): Promise<void> {
  if (!llm) return;

  if (docExists(repoName, "be_overview")) return;

  const files = selectBeOverviewFiles(repoPath, parsedFiles);
  if (files.length === 0) return;

  console.log(`  [be_overview] generating BE overview for ${repoName} (${files.length} files)`);
  try {
    const prompt = buildBeOverviewPrompt(repoName, files, fePagesContext, branchContext);
    const content = await callDocLlm(llm, prompt, `${repoName}/be_overview`, 1000);
    upsertDoc({
      repo: repoName,
      doc_type: "be_overview",
      title: `${repoName} — Backend Overview`,
      content,
      sourceFilePaths: files.map((f) => f.path),
    });
  } catch (err) {
    console.warn(`  [be_overview] failed for ${repoName}: ${err}`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GeneratedProjectDoc {
  docType: DocType;
  title: string;
  content: string;
  sourceFilePaths: string[];
}

export interface ProjectDocOptions {
  skipExisting?: boolean; // skip doc types that already exist and are fresh (default: true)
  forceRegenerate?: boolean; // regenerate all, even if fresh
  isFrontend?: boolean; // include styles doc
  skillLabel?: string;
  stackProfile?: StackProfile;
  /** Branch diff context — injected into prompts when indexing a non-base branch */
  branchContext?: import("./doc-prompts.js").BranchContext;
}

/**
 * Generates all project documentation for a single repository.
 * Returns the list of generated docs (may be empty if all were skipped).
 *
 * @param skillLabel - Stack/skill label (e.g. "ruby, rails") passed to specialist generation.
 */
export async function generateProjectDocs(
  repoName: string,
  repoPath: string,
  parsedFiles: ParsedFile[],
  llm: LLMProvider,
  options: ProjectDocOptions = {},
): Promise<GeneratedProjectDoc[]> {
  const { skipExisting = true, forceRegenerate = false, isFrontend, skillLabel, stackProfile, branchContext } = options;

  // Build per-doc-type framework baselines from resolved skills.
  // The section mix is intentionally asymmetric:
  //   code_style gets Testing — test conventions are a coding style concern.
  //   rules gets Performance — query/N+1 rules are enforced as domain constraints (not just style).
  //
  // Knowledge is loaded from (priority order):
  //   1. SRCMAP_KNOWLEDGE_DIR/<id>.md   — user / team override
  //   2. <workspace>/.srcmap/knowledge/<id>.md — workspace-local community contribution
  //   3. src/skills/knowledge/<id>.md   — built-in (shipped with srcmap)
  const resolvedSkills = stackProfile ? resolveSkills(stackProfile.skillIds) : [];
  const workspaceRoot = resolve(repoPath, "..");
  const knowledgeMap = resolvedSkills.length > 0
    ? await loadAllKnowledge(resolvedSkills, workspaceRoot)
    : new Map<string, import("../skills/types.js").BestPractices>();
  const resolvedPractices = resolvedSkills.map((s) => knowledgeMap.get(s.id) ?? s.bestPractices);
  const codeStyleBaseline = resolvedPractices.length > 0
    ? buildFrameworkBaseline(resolvedPractices, { includeTesting: true })
    : "";
  const rulesBaseline = resolvedPractices.length > 0
    ? buildFrameworkBaseline(resolvedPractices, { includePerformance: true })
    : "";
  const frameworkArchBaseline = resolvedPractices.length > 0
    ? buildFrameworkArchitectureOnly(resolvedPractices)
    : "";

  // Detect if this looks like a frontend repo
  const hasFrontendFiles = isFrontend ??
    parsedFiles.some((f) => ["javascript", "typescript", "vue"].includes(f.language) &&
      (f.path.endsWith(".jsx") || f.path.endsWith(".tsx") || f.path.endsWith(".vue") ||
       f.path.includes("/components/") || f.path.includes("/pages/")));

  const hasCssFiles = parsedFiles.some((f) =>
    f.path.endsWith(".scss") || f.path.endsWith(".css") || f.path.endsWith(".less")
  );

  type DocSpec = {
    type: DocType;
    title: string;
    files: SourceFile[];
    buildPrompt: (files: SourceFile[]) => string;
  };

  const docSpecs: DocSpec[] = [
    {
      type: "readme",
      title: `${repoName} — README`,
      files: selectReadmeFiles(repoPath, parsedFiles),
      buildPrompt: (f) => buildReadmePrompt(repoName, f, branchContext),
    },
    {
      type: "about",
      title: `${repoName} — About`,
      files: selectAboutFiles(repoPath, parsedFiles),
      buildPrompt: (f) => buildAboutPrompt(repoName, f, branchContext),
    },
    {
      type: "architecture",
      title: `${repoName} — Architecture`,
      files: selectArchitectureFiles(repoPath, parsedFiles),
      buildPrompt: (f) => buildArchitecturePrompt(repoName, f, branchContext),
    },
    {
      type: "code_style",
      title: `${repoName} — Code Style`,
      files: selectCodeStyleFiles(parsedFiles),
      buildPrompt: (f) => buildCodeStylePrompt(repoName, f, codeStyleBaseline, branchContext),
    },
    {
      type: "rules",
      title: `${repoName} — Business Rules`,
      files: selectRulesFiles(repoPath, parsedFiles),
      buildPrompt: (f) => buildRulesPrompt(repoName, f, rulesBaseline, branchContext),
    },
  ];

  if (hasFrontendFiles && hasCssFiles) {
    docSpecs.push({
      type: "styles",
      title: `${repoName} — Styles`,
      files: selectStylesFiles(repoPath, parsedFiles),
      buildPrompt: (f) => buildStylesPrompt(repoName, f),
    });
  }

  // API Contracts — backend repos only (detected by presence of Rails routes/controllers)
  const isBackend =
    existsSync(join(repoPath, "config", "routes.rb")) ||
    existsSync(join(repoPath, "app", "controllers", "api"));

  if (isBackend) {
    const apiContractsFiles = selectApiContractsFiles(repoPath, parsedFiles);
    if (apiContractsFiles.length > 0) {
      docSpecs.push({
        type: "api_contracts",
        title: `${repoName} — API Contracts`,
        files: apiContractsFiles,
        buildPrompt: (f) => buildApiContractsPrompt(repoName, f),
      });
    }
  }

  const generated: GeneratedProjectDoc[] = [];

  for (const spec of docSpecs) {
    if (!forceRegenerate && skipExisting && docExists(repoName, spec.type)) {
      console.log(`  [doc] ${spec.type} — skipped (already fresh)`);
      continue;
    }

    if (spec.files.length === 0) {
      console.log(`  [doc] ${spec.type} — skipped (no source files found)`);
      continue;
    }

    try {
      const content = await callDocLlm(
        llm,
        spec.buildPrompt(spec.files),
        `${repoName}/${spec.type}`,
      );

      const doc: GeneratedProjectDoc = {
        docType: spec.type,
        title: spec.title,
        content,
        sourceFilePaths: spec.files.map((f) => f.path),
      };

      upsertDoc({ repo: repoName, doc_type: spec.type, ...doc });
      generated.push(doc);
    } catch (err) {
      console.warn(`  [doc] ${spec.type} — LLM failed: ${String(err).slice(0, 100)}`);
    }
  }

  // Changelog — generated from git log; no LLM for conventional commits repos
  if (forceRegenerate || !docExists(repoName, "changelog")) {
    const commitMessages = selectChangelogFiles(repoPath);
    if (commitMessages.length > 0) {
      let changelogContent: string;

      if (hasConventionalCommits(commitMessages)) {
        changelogContent = formatConventionalChangelog(repoName, commitMessages);
        console.log(`  [doc] changelog — formatted from conventional commits (no LLM)`);
      } else {
        try {
          changelogContent = await callDocLlm(
            llm,
            buildChangelogPrompt(repoName, commitMessages),
            `${repoName}/changelog`,
          );
        } catch (err) {
          // Fall back to simple list if LLM fails
          changelogContent = `# ${repoName} — Recent Changes\n\n` +
            commitMessages.map((m) => `- ${m.replace(/^[0-9a-f]{7,} /, "")}`).join("\n");
          console.warn(`  [doc] changelog — LLM failed, using plain list: ${String(err).slice(0, 80)}`);
        }
      }

      const changelogDoc: GeneratedProjectDoc = {
        docType: "changelog",
        title: `${repoName} — Changelog`,
        content: changelogContent,
        sourceFilePaths: [],
      };
      upsertDoc({ repo: repoName, doc_type: "changelog", ...changelogDoc });
      generated.push(changelogDoc);
    } else {
      console.log(`  [doc] changelog — skipped (no git history found)`);
    }
  } else {
    console.log(`  [doc] changelog — skipped (already fresh)`);
  }

  // Specialist — generated last, requires about + architecture + rules to exist
  await generateSpecialistDoc(repoName, skillLabel ?? "", llm, options, frameworkArchBaseline);

  return generated;
}

/**
 * Generates the specialist identity card for a repo.
 * Requires about + architecture (and ideally rules) to already be present in the DB.
 * Called at the end of generateProjectDocs() so all base docs exist.
 */
async function generateSpecialistDoc(
  repoName: string,
  skillLabel: string,
  llm: LLMProvider,
  options: { skipExisting?: boolean; forceRegenerate?: boolean } = {},
  frameworkBestPractices?: string,
): Promise<void> {
  const { skipExisting = true, forceRegenerate = false } = options;

  if (!forceRegenerate && skipExisting && docExists(repoName, "specialist")) {
    console.log(`  [doc] specialist — skipped (already fresh)`);
    return;
  }

  const db = getDb();
  const docs = db
    .prepare(
      `SELECT doc_type, content FROM project_docs
       WHERE repo = ? AND doc_type IN ('about', 'architecture', 'rules') AND stale = 0`,
    )
    .all(repoName) as { doc_type: string; content: string }[];

  if (docs.length < 2) {
    console.log(`  [doc] specialist — skipped (insufficient context: ${docs.length}/3 base docs ready)`);
    return;
  }

  const aboutContent = docs.find((d) => d.doc_type === "about")?.content ?? "";
  const archContent = docs.find((d) => d.doc_type === "architecture")?.content ?? "";
  const rulesContent = docs.find((d) => d.doc_type === "rules")?.content ?? "";

  try {
    const content = await callDocLlm(
      llm,
      buildSpecialistPrompt(repoName, skillLabel, aboutContent, archContent, rulesContent, frameworkBestPractices),
      `${repoName}/specialist`,
      500,
    );

    upsertDoc({
      repo: repoName,
      doc_type: "specialist",
      title: `${repoName} — Specialist`,
      content,
      sourceFilePaths: [],
    });
  } catch (err) {
    console.warn(`  [doc] specialist — LLM failed: ${String(err).slice(0, 100)}`);
  }
}

/**
 * Loads about, architecture, specialist and memory docs for a repo from the
 * DB and formats them as a project context string to inject into card prompts.
 * Specialist is preferred over about+architecture when available.
 */
export function loadProjectContext(repoName: string): string {
  const db = getDb();
  const docs = db
    .prepare(
      `SELECT doc_type, content FROM project_docs
       WHERE repo = ? AND doc_type IN ('about', 'architecture', 'specialist', 'memory', 'business', 'product') AND stale = 0`,
    )
    .all(repoName) as { doc_type: string; content: string }[];

  if (docs.length === 0) return "";

  const specialist = docs.find((d) => d.doc_type === "specialist")?.content;
  const about = docs.find((d) => d.doc_type === "about")?.content ?? "";
  const arch = docs.find((d) => d.doc_type === "architecture")?.content ?? "";
  const memory = docs.find((d) => d.doc_type === "memory")?.content;
  const business = docs.find((d) => d.doc_type === "business")?.content;
  const product = docs.find((d) => d.doc_type === "product")?.content;

  const parts: string[] = [];

  if (specialist) {
    // Specialist is the richest source — use it directly
    parts.push(`### Specialist Context: ${repoName}\n${specialist.slice(0, 1200)}`);
  } else {
    if (about) {
      const words = about.split(/\s+/).slice(0, 300).join(" ");
      parts.push(`### Project: ${repoName}\n${words}`);
    }
    if (arch) {
      const words = arch.split(/\s+/).slice(0, 200).join(" ");
      parts.push(`### Architecture\n${words}`);
    }
  }

  // Business context — critical invariants the AI must not violate
  if (business) {
    const words = business.split(/\s+/).slice(0, 200).join(" ");
    parts.push(`### Business Context\n${words}`);
  }

  // Product context — user journeys (FE repos only)
  if (product) {
    const words = product.split(/\s+/).slice(0, 150).join(" ");
    parts.push(`### Product Journeys\n${words}`);
  }

  // Append recent team memory when available
  if (memory) {
    const words = memory.split(/\s+/).slice(0, 150).join(" ");
    parts.push(`### Recent Team Memory\n${words}`);
  }

  return parts.length > 0 ? `## Project Context\n\n${parts.join("\n\n")}\n\n` : "";
}

// ---------------------------------------------------------------------------
// Business / Product / Cross-repo doc generation
// ---------------------------------------------------------------------------

/**
 * Generates a Business.md doc capturing operational context, critical workflows,
 * and business invariants. Sources from about + rules + service objects.
 */
export async function generateBusinessDoc(
  repoName: string,
  llm: LLMProvider,
  readmeSeed = "",
  options: { skipExisting?: boolean; forceRegenerate?: boolean } = {},
): Promise<void> {
  const { skipExisting = true, forceRegenerate = false } = options;
  if (!forceRegenerate && skipExisting && docExists(repoName, "business")) {
    console.log(`  [doc] business — skipped (already fresh)`);
    return;
  }

  const db = getDb();
  // Source: about + rules docs already in DB
  const sourceDocs = db
    .prepare(
      `SELECT doc_type, content FROM project_docs
       WHERE repo = ? AND doc_type IN ('about', 'rules') AND stale = 0`,
    )
    .all(repoName) as { doc_type: string; content: string }[];

  if (sourceDocs.length === 0) {
    console.log(`  [doc] business — skipped (no about/rules docs yet)`);
    return;
  }

  const sourceFiles: SourceFile[] = sourceDocs.map((d) => ({
    path: `${repoName}/${d.doc_type}.md`,
    content: d.content.slice(0, 800),
  }));

  try {
    const content = await callDocLlm(
      llm,
      buildBusinessPrompt(repoName, sourceFiles, readmeSeed),
      `${repoName}/business`,
      900,
    );
    upsertDoc({ repo: repoName, doc_type: "business", title: `${repoName} — Business`, content, sourceFilePaths: [] });
    console.log(`  [doc] business — generated`);
  } catch (err) {
    console.warn(`  [doc] business — LLM failed: ${String(err).slice(0, 100)}`);
  }
}

/**
 * Generates a Product.md doc documenting user journeys from the FE router,
 * navigation, and active page components.
 */
export async function generateProductDoc(
  repoName: string,
  repoPath: string,
  parsedFiles: ParsedFile[],
  llm: LLMProvider,
  readmeSeed = "",
  options: { skipExisting?: boolean; forceRegenerate?: boolean } = {},
): Promise<void> {
  const { skipExisting = true, forceRegenerate = false } = options;
  if (!forceRegenerate && skipExisting && docExists(repoName, "product")) {
    console.log(`  [doc] product — skipped (already fresh)`);
    return;
  }

  const db = getDb();
  const pagesDoc = (db
    .prepare(`SELECT content FROM project_docs WHERE repo = ? AND doc_type = 'pages' AND stale = 0`)
    .get(repoName) as { content: string } | undefined)?.content ?? "";

  // Select active page components (not Storybook or test files)
  const pageFiles = parsedFiles
    .filter((f) => {
      const p = f.path.toLowerCase();
      return (
        (f.fileRole === "domain" || f.fileRole === "entry_point") &&
        !p.includes("stories") &&
        !p.includes("storybook") &&
        !p.includes("cypress") &&
        !p.includes(".test.") &&
        !p.includes(".spec.")
      );
    })
    .filter((f) =>
      f.path.endsWith(".tsx") || f.path.endsWith(".jsx") || f.path.endsWith(".vue") ||
      f.path.endsWith(".ts") || f.path.endsWith(".js")
    )
    .slice(0, 8);

  if (pageFiles.length === 0) {
    console.log(`  [doc] product — skipped (no active page components found)`);
    return;
  }

  const sourceFiles: SourceFile[] = pageFiles.map((f) => ({
    path: f.path,
    content: readTruncated(f.path, 60),
  })).filter((f) => f.content);

  try {
    const content = await callDocLlm(
      llm,
      buildProductPrompt(repoName, sourceFiles, readmeSeed, pagesDoc),
      `${repoName}/product`,
      1000,
    );
    upsertDoc({ repo: repoName, doc_type: "product", title: `${repoName} — Product`, content, sourceFilePaths: pageFiles.map((f) => f.path) });
    console.log(`  [doc] product — generated`);
  } catch (err) {
    console.warn(`  [doc] product — LLM failed: ${String(err).slice(0, 100)}`);
  }
}

/**
 * Generates a workspace-level CrossRepo.md that maps FE pages/journeys to BE
 * API endpoints. Stored under repo = '_workspace' for workspace-level retrieval.
 */
export async function generateCrossRepoDoc(
  feRepoName: string,
  beRepoName: string,
  llm: LLMProvider,
  options: { skipExisting?: boolean; forceRegenerate?: boolean } = {},
): Promise<void> {
  const { skipExisting = true, forceRegenerate = false } = options;
  if (!forceRegenerate && skipExisting && docExists("_workspace", "cross_repo")) {
    console.log(`  [doc] cross_repo — skipped (already fresh)`);
    return;
  }

  const db = getDb();
  const getDoc = (repo: string, type: string) =>
    (db.prepare(`SELECT content FROM project_docs WHERE repo = ? AND doc_type = ? AND stale = 0`).get(repo, type) as { content: string } | undefined)?.content ?? "";

  const fePagesDoc = getDoc(feRepoName, "pages");
  const feProductDoc = getDoc(feRepoName, "product");
  const beApiDoc = getDoc(beRepoName, "api_contracts");

  if (!fePagesDoc && !feProductDoc) {
    console.log(`  [doc] cross_repo — skipped (no FE pages/product docs yet)`);
    return;
  }

  try {
    const content = await callDocLlm(
      llm,
      buildCrossRepoPrompt(`${feRepoName} → ${beRepoName}`, fePagesDoc, feProductDoc, beApiDoc),
      `cross_repo`,
      1000,
    );
    upsertDoc({ repo: "_workspace", doc_type: "cross_repo", title: "Cross-Repo Map", content, sourceFilePaths: [] });
    console.log(`  [doc] cross_repo — generated`);
  } catch (err) {
    console.warn(`  [doc] cross_repo — LLM failed: ${String(err).slice(0, 100)}`);
  }
}

// ---------------------------------------------------------------------------
// Living Memory — heartbeat function (called every 10 srcmap_save_insight)
// ---------------------------------------------------------------------------

/**
 * Regenerates the global team memory doc from recent dev_insight cards and
 * query patterns. Called automatically as a fire-and-forget background job
 * every time a dev_insight count crosses a multiple of 10.
 *
 * Stores the result under repo = '__memory__'.
 */
export async function patchMemoryDoc(): Promise<void> {
  const db = getDb();
  const llm = (await import("../llm/provider.js")).createLLMProvider();

  const recentInsights = db
    .prepare(
      `SELECT title, flow, content, created_at FROM cards
       WHERE card_type = 'dev_insight' AND stale = 0
       ORDER BY created_at DESC LIMIT 10`,
    )
    .all() as MemoryInput["recentInsights"];

  const topFlows = db
    .prepare(
      `SELECT c.flow, COUNT(m.id) AS queryCount
       FROM metrics m
       JOIN json_each(m.response_cards) je
       JOIN cards c ON c.id = je.value
       WHERE m.timestamp > datetime('now', '-30 days')
         AND m.response_cards IS NOT NULL
         AND m.response_cards != '[]'
       GROUP BY c.flow
       ORDER BY queryCount DESC
       LIMIT 10`,
    )
    .all() as MemoryInput["topFlows"];

  const input: MemoryInput = { recentInsights, topFlows };

  let content: string;

  if (llm) {
    try {
      content = await llm.generate(buildMemoryDocPrompt(input), {
        systemPrompt: DOC_SYSTEM_PROMPT,
        maxTokens: 600,
        temperature: 0.2,
      });
    } catch {
      content = buildFallbackMemoryContent(input);
    }
  } else {
    content = buildFallbackMemoryContent(input);
  }

  upsertDoc({
    repo: "__memory__",
    doc_type: "memory",
    title: "Team Memory",
    content,
    sourceFilePaths: [],
  });

  console.log("[memory] Patched team memory doc");
}

function buildFallbackMemoryContent(input: MemoryInput): string {
  const insightLines = input.recentInsights
    .map((i) => `- **${i.title}** (${i.flow}) — ${i.content.slice(0, 120)}`)
    .join("\n");
  const flowLines = input.topFlows
    .map((f) => `- ${f.flow}: ${f.queryCount} queries`)
    .join("\n");

  return `## Recent Insights\n${insightLines || "(none)"}\n\n## Active Flows\n${flowLines || "(no data)"}`;
}

// ---------------------------------------------------------------------------
// Workspace Specialist — cross-repo overview doc
// ---------------------------------------------------------------------------

/**
 * Generates a workspace-level specialist doc that understands relationships
 * between all repos in the monorepo. Stored under repo = '__workspace__'.
 *
 * Requires at least one per-repo specialist doc to already exist.
 */
export async function generateWorkspaceSpecialist(
  allRepoNames: string[],
  llm: LLMProvider,
): Promise<void> {
  const db = getDb();

  const specialistDocs = db
    .prepare(
      `SELECT repo, content FROM project_docs
       WHERE doc_type = 'specialist' AND stale = 0 AND repo != '__workspace__'`,
    )
    .all() as { repo: string; content: string }[];

  if (specialistDocs.length === 0) {
    console.log("[workspace] No per-repo specialist docs found — skipping workspace specialist");
    return;
  }

  // Cross-repo api_endpoint edges (FE→BE connections)
  const crossRepoEdges = db
    .prepare(
      `SELECT DISTINCT ge.repo as source_repo, ge.target_file, ge.metadata
       FROM graph_edges ge
       WHERE ge.relation = 'api_endpoint'
       LIMIT 20`,
    )
    .all() as { source_repo: string; target_file: string; metadata: string }[];

  const repoSummaries = allRepoNames
    .map((repo) => {
      const doc = specialistDocs.find((d) => d.repo === repo);
      const summary = doc ? doc.content.slice(0, 400) : "(no specialist doc yet)";
      return `### ${repo}\n${summary}`;
    })
    .join("\n\n");

  const edgeLines = crossRepoEdges
    .slice(0, 20)
    .map((e) => {
      let meta: Record<string, unknown> = {};
      try { meta = JSON.parse(e.metadata) as Record<string, unknown>; } catch { /* ignore */ }
      const endpoint = (meta["endpoint"] as string | undefined) ?? "api_endpoint";
      return `- ${e.source_repo} → ${e.target_file} (${endpoint})`;
    })
    .join("\n");

  const prompt =
    `Generate a Workspace Overview for an AI coding assistant managing a multi-repo codebase.\n\n` +
    `Repos:\n\n${repoSummaries}\n\n` +
    `Cross-repo API connections:\n${edgeLines || "(none detected)"}\n\n` +
    `Create a 400-word workspace overview covering:\n` +
    `1. How the repos relate to each other\n` +
    `2. Key cross-service data flows\n` +
    `3. Shared domain concepts\n` +
    `4. Common gotchas when working across repos`;

  try {
    const now = Date.now();
    const wait = DOC_INTER_CALL_DELAY_MS - (now - lastDocLlmCallAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastDocLlmCallAt = Date.now();

    const content = await llm.generate(prompt, {
      systemPrompt: DOC_SYSTEM_PROMPT,
      maxTokens: 600,
    });

    console.log(`[workspace] Specialist generated (~${Math.ceil(content.length / 4)} tokens)`);

    upsertDoc({
      repo: "__workspace__",
      doc_type: "specialist",
      title: "Workspace — Specialist Overview",
      content,
      sourceFilePaths: [],
    });
  } catch (err) {
    console.warn(`[workspace] Specialist generation failed: ${String(err).slice(0, 100)}`);
  }
}
