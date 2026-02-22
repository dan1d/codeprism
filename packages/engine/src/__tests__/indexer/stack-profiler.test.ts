import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectStackProfile } from "../../indexer/stack-profiler.js";

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

  afterEach(() => {
    if (repoDir) rmSync(repoDir, { recursive: true, force: true });
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
      // A root-level .go file importing gin so the profiler can detect the framework
      "main.go": 'package main\n\nimport "github.com/gin-gonic/gin"\n\nfunc main() { r := gin.Default(); r.Run() }\n',
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

  it("returns safe unknown profile for empty repo", () => {
    repoDir = makeRepo({});
    const profile = detectStackProfile(repoDir);
    expect(profile.primaryLanguage).toBe("unknown");
    expect(profile.frameworks).toEqual([]);
    expect(profile.isLambda).toBe(false);
    expect(profile.skillIds).toEqual([]);
  });
});
