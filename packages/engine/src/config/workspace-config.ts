import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RepoEntry {
  /** Absolute or relative path to the repo root */
  path: string;
  /** Display name — defaults to the directory basename */
  name?: string;
}

/** Schema for `codeprism.config.json` placed at the workspace root. */
export interface WorkspaceConfig {
  /** Explicit list of repos to index */
  repos?: RepoEntry[];
  /** Glob patterns to exclude from indexing */
  exclude?: string[];
  /** Override the workspace root directory */
  workspaceRoot?: string;
}

/** Resolved repo entry with guaranteed absolute path and name. */
export interface ResolvedRepo {
  name: string;
  path: string;
}

/** Result of loading the workspace config. */
export interface LoadedWorkspaceConfig {
  workspaceRoot: string;
  repos: ResolvedRepo[];
  exclude: string[];
  /** Whether the config was loaded from a file or auto-discovered. */
  source: "file" | "auto";
}

const CONFIG_FILENAME = "codeprism.config.json";

// Markers that indicate a directory is a repository root.
const REPO_MARKERS = [
  "package.json",
  "Gemfile",
  "go.mod",
  "pyproject.toml",
  "Cargo.toml",
  ".git",
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load workspace configuration.
 *
 * 1. If `codeprism.config.json` exists at `workspaceRoot`, parse and validate it.
 * 2. Otherwise fall back to auto-discovery (scan sibling directories for repos).
 */
export function loadWorkspaceConfig(workspaceRoot: string): LoadedWorkspaceConfig {
  const configPath = join(workspaceRoot, CONFIG_FILENAME);
  if (existsSync(configPath)) return loadFromFile(configPath, workspaceRoot);

  return autoDiscover(workspaceRoot);
}

// ---------------------------------------------------------------------------
// File-based config
// ---------------------------------------------------------------------------

function loadFromFile(configPath: string, fallbackRoot: string): LoadedWorkspaceConfig {
  const raw = readFileSync(configPath, "utf-8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `Invalid JSON in ${configPath}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${configPath}: expected a JSON object at the top level`);
  }

  const cfg = parsed as Record<string, unknown>;
  const configDir = dirname(configPath);

  const workspaceRoot = resolveWorkspaceRoot(cfg, configDir, fallbackRoot);
  const repos = resolveRepos(cfg, configDir);
  const exclude = resolveExclude(cfg);

  return { workspaceRoot, repos, exclude, source: "file" };
}

function resolveWorkspaceRoot(
  cfg: Record<string, unknown>,
  configDir: string,
  fallback: string,
): string {
  if (!("workspaceRoot" in cfg)) return fallback;
  if (typeof cfg.workspaceRoot !== "string")
    throw new Error(`codeprism.config.json: "workspaceRoot" must be a string`);
  return resolve(configDir, cfg.workspaceRoot);
}

function resolveRepos(
  cfg: Record<string, unknown>,
  configDir: string,
): ResolvedRepo[] {
  if (!("repos" in cfg)) return [];
  if (!Array.isArray(cfg.repos)) {
    throw new Error(`codeprism.config.json: "repos" must be an array`);
  }

  return cfg.repos.map((entry: unknown, i: number) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`codeprism.config.json: repos[${i}] must be an object`);
    }
    const obj = entry as Record<string, unknown>;
    if (typeof obj.path !== "string" || obj.path.length === 0) {
      throw new Error(`codeprism.config.json: repos[${i}].path must be a non-empty string`);
    }
    if (obj.name !== undefined && typeof obj.name !== "string") {
      throw new Error(`codeprism.config.json: repos[${i}].name must be a string`);
    }

    const absPath = resolve(configDir, obj.path);
    const name = typeof obj.name === "string" ? obj.name : absPath.split("/").at(-1)!;
    return { name, path: absPath };
  });
}

function resolveExclude(cfg: Record<string, unknown>): string[] {
  if (!("exclude" in cfg)) return [];
  if (!Array.isArray(cfg.exclude)) {
    throw new Error(`codeprism.config.json: "exclude" must be an array`);
  }
  for (let i = 0; i < cfg.exclude.length; i++) {
    if (typeof cfg.exclude[i] !== "string") {
      throw new Error(`codeprism.config.json: exclude[${i}] must be a string`);
    }
  }
  return cfg.exclude as string[];
}

// ---------------------------------------------------------------------------
// Auto-discovery fallback
// ---------------------------------------------------------------------------

/**
 * Scans `workspaceRoot` for sibling directories that look like repos.
 * Skips hidden directories and the `codeprism` directory itself.
 */
function autoDiscover(workspaceRoot: string): LoadedWorkspaceConfig {
  const entries = readdirSync(workspaceRoot, { withFileTypes: true });
  const repos: ResolvedRepo[] = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "codeprism")
    .map((e) => ({ name: e.name, path: join(workspaceRoot, e.name) }))
    .filter((r) => REPO_MARKERS.some((marker) => existsSync(join(r.path, marker))));

  return { workspaceRoot, repos, exclude: [], source: "auto" };
}
