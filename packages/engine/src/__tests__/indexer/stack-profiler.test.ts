import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectStackProfile, saveRepoProfile } from "../../indexer/stack-profiler.js";
import { createTestDb, type TestDb } from "../helpers/db.js";

let testDb: TestDb;

vi.mock("../../db/connection.js", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

function makeRepo(structure: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "srcmap-profiler-"));
  for (const [relPath, content] of Object.entries(structure)) {
    const abs = join(dir, relPath);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content, "utf-8");
  }
  return dir;
}

describe("detectStackProfile", () => {
  let repoDir: string;

  beforeEach(() => {
    testDb = createTestDb();
  });

  afterEach(() => {
    if (repoDir) rmSync(repoDir, { recursive: true, force: true });
    testDb.close();
  });

  it("detects Rails from Gemfile with rails gem", () => {
    repoDir = makeRepo({ "Gemfile": "source 'https://rubygems.org'\ngem 'rails', '~> 7.0'\ngem 'pg'\n" });
    const profile = detectStackProfile(repoDir);
    expect(profile.primaryLanguage).toBe("ruby");
    expect(profile.frameworks).toContain("rails");
    expect(profile.packageManager).toBe("bundler");
    expect(profile.skillIds).toContain("rails");
  });

  it("detects Cuba from Gemfile", () => {
    repoDir = makeRepo({ "Gemfile": "gem 'cuba'\ngem 'redis'\n" });
    const profile = detectStackProfile(repoDir);
    expect(profile.primaryLanguage).toBe("ruby");
    expect(profile.frameworks).toContain("cuba");
  });

  it("detects Go from go.mod", () => {
    repoDir = makeRepo({
      "go.mod": "module github.com/example/app\n\ngo 1.21\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.1\n)\n",
    });
    const profile = detectStackProfile(repoDir);
    expect(profile.primaryLanguage).toBe("go");
    expect(profile.frameworks).toContain("gin");
    expect(profile.packageManager).toBe("go modules");
    expect(profile.skillIds).toContain("go");
  });

  it("detects Python/FastAPI from requirements.txt", () => {
    repoDir = makeRepo({ "requirements.txt": "fastapi==0.110.0\nuvicorn==0.29.0\npydantic==2.6.0\n" });
    const profile = detectStackProfile(repoDir);
    expect(profile.primaryLanguage).toBe("python");
    expect(profile.frameworks).toContain("fastapi");
    expect(profile.skillIds).toContain("fastapi");
    expect(profile.skillIds).toContain("python");
  });

  it("detects Next.js from package.json", () => {
    repoDir = makeRepo({
      "package.json": JSON.stringify({
        dependencies: { next: "^14.0.0", react: "^18.0.0" },
        devDependencies: { typescript: "^5.0.0" },
      }),
    });
    const profile = detectStackProfile(repoDir);
    expect(profile.primaryLanguage).toBe("typescript");
    expect(profile.frameworks).toContain("nextjs");
    expect(profile.frameworks).toContain("react");
    expect(profile.skillIds).toContain("nextjs");
  });

  it("detects Vue from package.json", () => {
    repoDir = makeRepo({
      "package.json": JSON.stringify({ dependencies: { vue: "^3.0.0" } }),
    });
    const profile = detectStackProfile(repoDir);
    expect(profile.frameworks).toContain("vue");
    expect(profile.skillIds).toContain("vue");
  });

  it("detects Lambda from serverless.yml", () => {
    repoDir = makeRepo({
      "serverless.yml": "service: billing-lambda\nruntime: python3.12\n",
      "requirements.txt": "boto3==1.34.0\n",
    });
    const profile = detectStackProfile(repoDir);
    expect(profile.isLambda).toBe(true);
    expect(profile.skillIds).toContain("lambda");
  });

  it("detects pnpm from lockfile", () => {
    repoDir = makeRepo({
      "package.json": JSON.stringify({ dependencies: { react: "^18.0.0" } }),
      "pnpm-lock.yaml": "lockfileVersion: '6.0'\n",
    });
    const profile = detectStackProfile(repoDir);
    expect(profile.packageManager).toBe("pnpm");
  });

  it("detects Django from requirements.txt", () => {
    repoDir = makeRepo({ "requirements.txt": "Django==4.2.0\ncelery==5.3.0\n" });
    const profile = detectStackProfile(repoDir);
    expect(profile.primaryLanguage).toBe("python");
    expect(profile.frameworks).toContain("django");
    expect(profile.frameworks).not.toContain("django_rest");
  });

  it("detects Flask from requirements.txt", () => {
    repoDir = makeRepo({ "requirements.txt": "Flask==3.0.0\nWerkzeug==3.0.0\n" });
    const profile = detectStackProfile(repoDir);
    expect(profile.primaryLanguage).toBe("python");
    expect(profile.frameworks).toContain("flask");
  });

  it("detects Python from pyproject.toml", () => {
    repoDir = makeRepo({
      "pyproject.toml": "[tool.poetry.dependencies]\npython = \"^3.11\"\nfastapi = \"^0.110.0\"\n",
    });
    const profile = detectStackProfile(repoDir);
    expect(profile.primaryLanguage).toBe("python");
    expect(profile.frameworks).toContain("fastapi");
  });

  it("detects Rust from Cargo.toml", () => {
    repoDir = makeRepo({ "Cargo.toml": "[package]\nname = \"myapp\"\nversion = \"0.1.0\"\n" });
    const profile = detectStackProfile(repoDir);
    expect(profile.primaryLanguage).toBe("rust");
  });

  it("detects PHP/Laravel from composer.json", () => {
    repoDir = makeRepo({
      // detectPhp looks for "laravel/laravel" string in composer.json content
      "composer.json": JSON.stringify({ require: { "laravel/laravel": "^10.0", "laravel/framework": "^10.0" } }),
    });
    const profile = detectStackProfile(repoDir);
    expect(profile.primaryLanguage).toBe("php");
    expect(profile.frameworks).toContain("laravel");
  });

  it("detects Java from pom.xml", () => {
    repoDir = makeRepo({ "pom.xml": "<project><modelVersion>4.0.0</modelVersion></project>" });
    const profile = detectStackProfile(repoDir);
    expect(profile.primaryLanguage).toBe("java");
  });

  it("detects Java from build.gradle", () => {
    repoDir = makeRepo({ "build.gradle": "apply plugin: 'java'" });
    const profile = detectStackProfile(repoDir);
    expect(profile.primaryLanguage).toBe("java");
  });

  it("detects Go echo framework from go.mod", () => {
    repoDir = makeRepo({
      "go.mod": "module example.com/app\n\ngo 1.21\n\nrequire (\n\tgithub.com/labstack/echo/v4 v4.11.0\n)\n",
    });
    const profile = detectStackProfile(repoDir);
    expect(profile.primaryLanguage).toBe("go");
    expect(profile.frameworks).toContain("echo");
  });

  it("detects React from package.json (without Next.js)", () => {
    repoDir = makeRepo({
      "package.json": JSON.stringify({ dependencies: { react: "^18.0.0", "react-dom": "^18.0.0" } }),
    });
    const profile = detectStackProfile(repoDir);
    expect(profile.frameworks).toContain("react");
    expect(profile.skillIds).toContain("react");
    expect(profile.frameworks).not.toContain("nextjs");
  });

  it("detects Sinatra from Gemfile", () => {
    repoDir = makeRepo({ "Gemfile": "gem 'sinatra'\ngem 'rack'\n" });
    const profile = detectStackProfile(repoDir);
    expect(profile.primaryLanguage).toBe("ruby");
    expect(profile.frameworks).toContain("sinatra");
  });

  it("detects yarn from lockfile", () => {
    repoDir = makeRepo({
      "package.json": JSON.stringify({ dependencies: { react: "^18.0.0" } }),
      "yarn.lock": "# THIS IS AN AUTOGENERATED FILE.\n",
    });
    const profile = detectStackProfile(repoDir);
    expect(profile.packageManager).toBe("yarn");
  });

  it("returns safe unknown profile for empty repo", () => {
    repoDir = makeRepo({});
    const profile = detectStackProfile(repoDir);
    expect(profile.primaryLanguage).toBe("unknown");
    expect(profile.frameworks).toEqual([]);
    expect(profile.isLambda).toBe(false);
    expect(profile.skillIds).toEqual([]);
  });

  // --- new skill detection ---

  it("detects nestjs from package.json", () => {
    repoDir = makeRepo({
      "package.json": JSON.stringify({
        dependencies: { "@nestjs/core": "^10.0.0", typescript: "^5.0.0" },
      }),
    });
    const profile = detectStackProfile(repoDir);
    expect(profile.frameworks).toContain("nestjs");
    expect(profile.skillIds).toContain("nestjs");
  });

  it("detects svelte from package.json", () => {
    repoDir = makeRepo({
      "package.json": JSON.stringify({ dependencies: { svelte: "^4.0.0" } }),
    });
    const profile = detectStackProfile(repoDir);
    expect(profile.frameworks).toContain("svelte");
    expect(profile.skillIds).toContain("svelte");
  });

  it("detects angular from package.json", () => {
    repoDir = makeRepo({
      "package.json": JSON.stringify({
        dependencies: { "@angular/core": "^17.0.0", typescript: "^5.0.0" },
      }),
    });
    const profile = detectStackProfile(repoDir);
    expect(profile.frameworks).toContain("angular");
    expect(profile.skillIds).toContain("angular");
  });

  it("detects gin and emits both gin and go skill IDs", () => {
    repoDir = makeRepo({
      "go.mod": "module example.com/app\n\ngo 1.21\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.1\n)\n",
    });
    const profile = detectStackProfile(repoDir);
    expect(profile.frameworks).toContain("gin");
    expect(profile.skillIds).toContain("gin");
    expect(profile.skillIds).toContain("go");
  });

  it("detects spring from pom.xml", () => {
    repoDir = makeRepo({
      "pom.xml":
        "<project><parent><artifactId>spring-boot-starter-parent</artifactId></parent></project>",
    });
    const profile = detectStackProfile(repoDir);
    expect(profile.frameworks).toContain("spring");
    expect(profile.skillIds).toContain("spring");
  });

  it("detects spring from build.gradle", () => {
    repoDir = makeRepo({
      "build.gradle": "plugins { id 'org.springframework.boot' version '3.2.0' }\ndependencies { implementation 'org.springframework.boot:spring-boot-starter-web' }",
    });
    const profile = detectStackProfile(repoDir);
    expect(profile.frameworks).toContain("spring");
    expect(profile.skillIds).toContain("spring");
    expect(profile.packageManager).toBe("gradle");
  });

  it("detects spring from build.gradle.kts (Kotlin DSL)", () => {
    repoDir = makeRepo({
      "build.gradle.kts": `plugins { id("org.springframework.boot") version "3.2.0" }\ndependencies { implementation("org.springframework.boot:spring-boot-starter-web") }`,
    });
    const profile = detectStackProfile(repoDir);
    expect(profile.frameworks).toContain("spring");
    expect(profile.skillIds).toContain("spring");
    expect(profile.packageManager).toBe("gradle");
  });

  it("detects django_rest from requirements.txt and implies django + python skill IDs", () => {
    repoDir = makeRepo({
      "requirements.txt": "django>=4.2\ndjangorestframework>=3.14\n",
    });
    const profile = detectStackProfile(repoDir);
    expect(profile.frameworks).toContain("django_rest");
    // DRF detection is exclusive: "django" is NOT pushed separately into frameworks
    // (buildSkillIds handles the "DRF implies Django" skill ID inference)
    expect(profile.frameworks).not.toContain("django");
    expect(profile.skillIds).toContain("django_rest");
    expect(profile.skillIds).toContain("django");
    expect(profile.skillIds).toContain("python");
  });

  it("does not emit dead java skill ID for plain Java project", () => {
    repoDir = makeRepo({ "pom.xml": "<project></project>" });
    const profile = detectStackProfile(repoDir);
    expect(profile.primaryLanguage).toBe("java");
    expect(profile.skillIds).not.toContain("java");
    expect(profile.skillIds).not.toContain("spring");
  });

  it("does not emit dead rust skill ID", () => {
    repoDir = makeRepo({
      "Cargo.toml": "[package]\nname = \"myapp\"\nversion = \"0.1.0\"\n",
    });
    const profile = detectStackProfile(repoDir);
    expect(profile.primaryLanguage).toBe("rust");
    expect(profile.skillIds).not.toContain("rust");
  });
});

describe("saveRepoProfile", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  it("inserts a repo profile into the repo_profiles table", () => {
    saveRepoProfile("backend", {
      primaryLanguage: "ruby",
      frameworks: ["rails"],
      isLambda: false,
      packageManager: "bundler",
      skillIds: ["rails"],
    });

    const row = testDb
      .prepare("SELECT * FROM repo_profiles WHERE repo = 'backend'")
      .get() as { primary_language: string; frameworks: string; skill_ids: string } | undefined;

    expect(row).toBeDefined();
    expect(row!.primary_language).toBe("ruby");
    expect(JSON.parse(row!.frameworks)).toContain("rails");
    expect(JSON.parse(row!.skill_ids)).toContain("rails");
  });

  it("upserts (replaces) on conflict", () => {
    saveRepoProfile("backend", {
      primaryLanguage: "ruby",
      frameworks: ["rails"],
      isLambda: false,
      packageManager: "bundler",
      skillIds: ["rails"],
    });

    saveRepoProfile("backend", {
      primaryLanguage: "ruby",
      frameworks: ["rails", "sinatra"],
      isLambda: false,
      packageManager: "bundler",
      skillIds: ["rails"],
    });

    const count = testDb
      .prepare("SELECT COUNT(*) AS n FROM repo_profiles WHERE repo = 'backend'")
      .get() as { n: number };
    expect(count.n).toBe(1);

    const row = testDb
      .prepare("SELECT frameworks FROM repo_profiles WHERE repo = 'backend'")
      .get() as { frameworks: string };
    expect(JSON.parse(row.frameworks)).toContain("sinatra");
  });

  it("stores isLambda as 1/0 integer", () => {
    saveRepoProfile("lambda-svc", {
      primaryLanguage: "python",
      frameworks: [],
      isLambda: true,
      packageManager: "pip",
      skillIds: ["lambda"],
    });

    const row = testDb
      .prepare("SELECT is_lambda FROM repo_profiles WHERE repo = 'lambda-svc'")
      .get() as { is_lambda: number };
    expect(row.is_lambda).toBe(1);
  });
});
