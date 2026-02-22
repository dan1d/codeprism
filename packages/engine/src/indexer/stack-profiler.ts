import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "../db/connection.js";

export interface StackProfile {
  primaryLanguage:
    | "ruby"
    | "python"
    | "go"
    | "typescript"
    | "javascript"
    | "php"
    | "rust"
    | "java"
    | "unknown";
  frameworks: string[];
  isLambda: boolean;
  packageManager: string;
  skillIds: string[];
}

const DEFAULT_PROFILE: StackProfile = {
  primaryLanguage: "unknown",
  frameworks: [],
  isLambda: false,
  packageManager: "",
  skillIds: [],
};

function safeReadFile(filePath: string): string {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

function detectLambda(repoPath: string, packageJsonMain?: string): boolean {
  const lambdaManifests = [
    "serverless.yml",
    "serverless.yaml",
    "template.yaml",
    "template.yml",
    "sam.yaml",
    "sam.yml",
  ];
  for (const f of lambdaManifests) {
    if (existsSync(join(repoPath, f))) return true;
  }
  if (existsSync(join(repoPath, ".aws-sam"))) return true;

  const handlerFiles = [
    "handler.py",
    "handler.rb",
    "handler.js",
    "handler.ts",
  ];
  for (const f of handlerFiles) {
    if (existsSync(join(repoPath, f))) return true;
  }

  if (packageJsonMain && /index\.handler/.test(packageJsonMain)) return true;

  return false;
}

function buildSkillIds(
  primaryLanguage: StackProfile["primaryLanguage"],
  frameworks: string[],
  isLambda: boolean,
): string[] {
  const ids: string[] = [];

  if (primaryLanguage === "ruby") {
    if (frameworks.includes("rails")) ids.push("rails");
    // cuba has no dedicated skill
  } else if (primaryLanguage === "go") {
    ids.push("go");
  } else if (primaryLanguage === "python") {
    if (frameworks.includes("fastapi")) {
      ids.push("fastapi", "python");
    } else if (frameworks.includes("django")) {
      ids.push("django", "python");
    } else if (frameworks.includes("flask")) {
      ids.push("flask", "python");
    } else {
      ids.push("python");
    }
  } else if (primaryLanguage === "typescript" || primaryLanguage === "javascript") {
    if (frameworks.includes("nextjs")) {
      ids.push("nextjs", "react");
    } else if (frameworks.includes("react")) {
      ids.push("react");
    } else if (frameworks.includes("vue")) {
      ids.push("vue");
    }
  } else if (primaryLanguage === "rust") {
    ids.push("rust");
  } else if (primaryLanguage === "php") {
    if (frameworks.includes("laravel")) {
      ids.push("laravel", "php");
    }
  } else if (primaryLanguage === "java") {
    ids.push("java");
  }

  if (isLambda) ids.push("lambda");

  return ids;
}

function detectRuby(repoPath: string): StackProfile {
  const gemfile = safeReadFile(join(repoPath, "Gemfile"));
  const frameworks: string[] = [];

  if (/gem\s+['"]rails['"]/.test(gemfile)) frameworks.push("rails");
  if (/gem\s+['"]cuba['"]/.test(gemfile)) frameworks.push("cuba");
  if (/gem\s+['"]sinatra['"]/.test(gemfile)) frameworks.push("sinatra");

  const isLambda = detectLambda(repoPath);
  const skillIds = buildSkillIds("ruby", frameworks, isLambda);

  return {
    primaryLanguage: "ruby",
    frameworks,
    isLambda,
    packageManager: "bundler",
    skillIds,
  };
}

function detectGo(repoPath: string): StackProfile {
  const frameworks: string[] = [];

  try {
    const entries = readdirSync(repoPath);
    for (const entry of entries) {
      if (!entry.endsWith(".go")) continue;
      const content = safeReadFile(join(repoPath, entry));
      if (content.includes("gin-gonic/gin")) frameworks.push("gin");
      if (content.includes("labstack/echo")) frameworks.push("echo");
      if (content.includes("gofiber/fiber")) frameworks.push("fiber");
      if (content.includes("go-chi/chi") || content.includes(`"chi"`)) frameworks.push("chi");
    }
  } catch {
    // ignore read errors
  }

  const uniqueFrameworks = [...new Set(frameworks)];
  const isLambda = detectLambda(repoPath);
  const skillIds = buildSkillIds("go", uniqueFrameworks, isLambda);

  return {
    primaryLanguage: "go",
    frameworks: uniqueFrameworks,
    isLambda,
    packageManager: "go modules",
    skillIds,
  };
}

function detectPython(repoPath: string): StackProfile {
  const reqPath = join(repoPath, "requirements.txt");
  const pyprojectPath = join(repoPath, "pyproject.toml");

  const content =
    (existsSync(reqPath) ? safeReadFile(reqPath) : "") +
    (existsSync(pyprojectPath) ? safeReadFile(pyprojectPath) : "");

  const lower = content.toLowerCase();
  const frameworks: string[] = [];

  if (lower.includes("fastapi")) frameworks.push("fastapi");
  if (lower.includes("flask")) frameworks.push("flask");
  if (lower.includes("django")) frameworks.push("django");
  if (lower.includes("starlette")) frameworks.push("starlette");

  const isLambda = detectLambda(repoPath);
  const skillIds = buildSkillIds("python", frameworks, isLambda);

  return {
    primaryLanguage: "python",
    frameworks,
    isLambda,
    packageManager: "pip",
    skillIds,
  };
}

function detectNode(repoPath: string): StackProfile {
  const pkgContent = safeReadFile(join(repoPath, "package.json"));

  interface PackageJson {
    main?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }

  let pkg: PackageJson = {};
  try {
    pkg = JSON.parse(pkgContent) as PackageJson;
  } catch {
    // malformed package.json — proceed with empty object
  }

  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };
  const depNames = Object.keys(allDeps);

  const hasTypeScript =
    depNames.includes("typescript") ||
    existsSync(join(repoPath, "tsconfig.json"));

  const primaryLanguage: StackProfile["primaryLanguage"] = hasTypeScript
    ? "typescript"
    : "javascript";

  const frameworks: string[] = [];
  if (depNames.includes("next")) frameworks.push("nextjs");
  if (depNames.includes("react")) frameworks.push("react");
  if (depNames.includes("vue")) frameworks.push("vue");
  if (depNames.includes("express")) frameworks.push("express");
  if (depNames.includes("fastify")) frameworks.push("fastify");

  let packageManager = "npm";
  if (existsSync(join(repoPath, "pnpm-lock.yaml"))) {
    packageManager = "pnpm";
  } else if (existsSync(join(repoPath, "yarn.lock"))) {
    packageManager = "yarn";
  }

  const isLambda = detectLambda(repoPath, pkg.main);
  const skillIds = buildSkillIds(primaryLanguage, frameworks, isLambda);

  return {
    primaryLanguage,
    frameworks,
    isLambda,
    packageManager,
    skillIds,
  };
}

function detectRust(repoPath: string): StackProfile {
  const cargoContent = safeReadFile(join(repoPath, "Cargo.toml"));
  const frameworks: string[] = [];

  if (cargoContent.includes("actix-web")) frameworks.push("actix");
  if (cargoContent.includes("axum")) frameworks.push("axum");
  if (cargoContent.includes("rocket")) frameworks.push("rocket");

  const isLambda = detectLambda(repoPath);
  const skillIds = buildSkillIds("rust", frameworks, isLambda);

  return {
    primaryLanguage: "rust",
    frameworks,
    isLambda,
    packageManager: "cargo",
    skillIds,
  };
}

function detectPhp(repoPath: string): StackProfile {
  const composerContent = safeReadFile(join(repoPath, "composer.json"));
  const frameworks: string[] = [];

  if (composerContent.includes("laravel/laravel")) frameworks.push("laravel");

  const isLambda = detectLambda(repoPath);
  const skillIds = buildSkillIds("php", frameworks, isLambda);

  return {
    primaryLanguage: "php",
    frameworks,
    isLambda,
    packageManager: "composer",
    skillIds,
  };
}

function detectJava(repoPath: string): StackProfile {
  const hasPom = existsSync(join(repoPath, "pom.xml"));
  const hasBuildGradle = existsSync(join(repoPath, "build.gradle"));

  const packageManager = hasPom ? "maven" : hasBuildGradle ? "gradle" : "";
  const isLambda = detectLambda(repoPath);
  const skillIds = buildSkillIds("java", [], isLambda);

  return {
    primaryLanguage: "java",
    frameworks: [],
    isLambda,
    packageManager,
    skillIds,
  };
}

/**
 * Detects the technology stack of a repository by inspecting manifest files.
 * Returns a StackProfile describing the primary language, frameworks, package
 * manager, Lambda usage, and applicable skill IDs.
 *
 * All file reads are wrapped in try/catch — no exception will propagate to
 * the caller.
 */
export function detectStackProfile(repoPath: string): StackProfile {
  try {
    if (existsSync(join(repoPath, "Gemfile"))) return detectRuby(repoPath);
    if (existsSync(join(repoPath, "go.mod"))) return detectGo(repoPath);
    if (
      existsSync(join(repoPath, "requirements.txt")) ||
      existsSync(join(repoPath, "pyproject.toml"))
    )
      return detectPython(repoPath);
    if (existsSync(join(repoPath, "package.json"))) return detectNode(repoPath);
    if (existsSync(join(repoPath, "Cargo.toml"))) return detectRust(repoPath);
    if (existsSync(join(repoPath, "composer.json"))) return detectPhp(repoPath);
    if (
      existsSync(join(repoPath, "pom.xml")) ||
      existsSync(join(repoPath, "build.gradle"))
    )
      return detectJava(repoPath);
  } catch {
    // fall through to default
  }

  return { ...DEFAULT_PROFILE };
}

/**
 * Persists a StackProfile for the given repo name into the `repo_profiles`
 * SQLite table using INSERT OR REPLACE.
 */
export function saveRepoProfile(repoName: string, profile: StackProfile): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO repo_profiles
      (repo, primary_language, frameworks, is_lambda, package_manager, skill_ids, detected_at)
    VALUES
      (?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  stmt.run(
    repoName,
    profile.primaryLanguage,
    JSON.stringify(profile.frameworks),
    profile.isLambda ? 1 : 0,
    profile.packageManager,
    JSON.stringify(profile.skillIds),
  );
}
