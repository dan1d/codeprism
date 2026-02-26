/**
 * Tests for benchmark-worker.ts helpers:
 *  - detectLanguageAndFramework: language/framework detection from repo structure
 *  - llmLabel slug construction: matches what submitBenchmark / runBenchmarkJob produce
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectLanguageAndFramework } from "../../services/benchmark-worker.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepo(structure: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "codeprism-bench-detect-"));
  for (const [relPath, content] of Object.entries(structure)) {
    const abs = join(dir, relPath);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content, "utf-8");
  }
  return dir;
}

const cleanups: string[] = [];
function tracked(dir: string): string {
  cleanups.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of cleanups.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// PHP / Laravel / Symfony / Slim / CakePHP
// ---------------------------------------------------------------------------

describe("detectLanguageAndFramework — PHP", () => {
  it("detects PHP/Laravel from composer.json require laravel/framework", () => {
    const dir = tracked(makeRepo({
      "composer.json": JSON.stringify({ require: { "laravel/framework": "^10.0" } }),
    }));
    const result = detectLanguageAndFramework(dir);
    expect(result.language).toBe("PHP");
    expect(result.framework).toBe("Laravel");
  });

  it("detects PHP/Laravel from composer.json require laravel/laravel", () => {
    const dir = tracked(makeRepo({
      "composer.json": JSON.stringify({ require: { "laravel/laravel": "^11.0" } }),
    }));
    const result = detectLanguageAndFramework(dir);
    expect(result.language).toBe("PHP");
    expect(result.framework).toBe("Laravel");
  });

  it("detects PHP/Symfony from composer.json require symfony/framework-bundle", () => {
    const dir = tracked(makeRepo({
      "composer.json": JSON.stringify({ require: { "symfony/framework-bundle": "^7.0", "symfony/symfony": "^7.0" } }),
    }));
    const result = detectLanguageAndFramework(dir);
    expect(result.language).toBe("PHP");
    expect(result.framework).toBe("Symfony");
  });

  it("detects PHP/Slim from composer.json", () => {
    const dir = tracked(makeRepo({
      "composer.json": JSON.stringify({ require: { "slim/slim": "^4.0" } }),
    }));
    const result = detectLanguageAndFramework(dir);
    expect(result.language).toBe("PHP");
    expect(result.framework).toBe("Slim");
  });

  it("detects PHP/CakePHP from composer.json", () => {
    const dir = tracked(makeRepo({
      "composer.json": JSON.stringify({ require: { "cakephp/cakephp": "^5.0" } }),
    }));
    const result = detectLanguageAndFramework(dir);
    expect(result.language).toBe("PHP");
    expect(result.framework).toBe("CakePHP");
  });

  it("detects plain PHP when composer.json has no known framework", () => {
    const dir = tracked(makeRepo({
      "composer.json": JSON.stringify({ require: { "monolog/monolog": "^3.0" } }),
    }));
    const result = detectLanguageAndFramework(dir);
    expect(result.language).toBe("PHP");
    expect(result.framework).toBe("PHP");
  });

  it("detects PHP from require-dev as well (laravel/laravel in devDependencies)", () => {
    const dir = tracked(makeRepo({
      "composer.json": JSON.stringify({ "require-dev": { "laravel/framework": "^10.0" } }),
    }));
    const result = detectLanguageAndFramework(dir);
    expect(result.language).toBe("PHP");
    expect(result.framework).toBe("Laravel");
  });
});

// ---------------------------------------------------------------------------
// Ruby
// ---------------------------------------------------------------------------

describe("detectLanguageAndFramework — Ruby", () => {
  it("detects Rails from Gemfile", () => {
    const dir = tracked(makeRepo({ "Gemfile": "gem 'rails', '~> 7.0'\n" }));
    const result = detectLanguageAndFramework(dir);
    expect(result.language).toBe("Ruby");
    expect(result.framework).toBe("Rails");
  });

  it("detects Sinatra from Gemfile", () => {
    const dir = tracked(makeRepo({ "Gemfile": "gem 'sinatra'\ngem 'rack'\n" }));
    const result = detectLanguageAndFramework(dir);
    expect(result.language).toBe("Ruby");
    expect(result.framework).toBe("Sinatra");
  });

  it("falls back to plain Ruby for unknown gems", () => {
    const dir = tracked(makeRepo({ "Gemfile": "gem 'pg'\ngem 'redis'\n" }));
    const result = detectLanguageAndFramework(dir);
    expect(result.language).toBe("Ruby");
    expect(result.framework).toBe("Ruby");
  });
});

// ---------------------------------------------------------------------------
// JavaScript / TypeScript
// ---------------------------------------------------------------------------

describe("detectLanguageAndFramework — JavaScript / TypeScript", () => {
  it("detects Next.js from package.json", () => {
    const dir = tracked(makeRepo({
      "package.json": JSON.stringify({ dependencies: { next: "^14.0.0", react: "^18.0.0" } }),
    }));
    const result = detectLanguageAndFramework(dir);
    expect(result.language).toBe("TypeScript");
    expect(result.framework).toBe("Next.js");
  });

  it("detects React from package.json", () => {
    const dir = tracked(makeRepo({
      "package.json": JSON.stringify({ dependencies: { react: "^18.0.0" } }),
    }));
    const result = detectLanguageAndFramework(dir);
    expect(result.framework).toBe("React");
  });

  it("detects Express from package.json", () => {
    const dir = tracked(makeRepo({
      "package.json": JSON.stringify({ dependencies: { express: "^4.18.0" } }),
    }));
    const result = detectLanguageAndFramework(dir);
    expect(result.language).toBe("JavaScript");
    expect(result.framework).toBe("Express");
  });

  it("detects Fastify from package.json", () => {
    const dir = tracked(makeRepo({
      "package.json": JSON.stringify({ dependencies: { fastify: "^4.0.0" } }),
    }));
    const result = detectLanguageAndFramework(dir);
    expect(result.language).toBe("TypeScript");
    expect(result.framework).toBe("Fastify");
  });

  it("detects Angular from package.json", () => {
    const dir = tracked(makeRepo({
      "package.json": JSON.stringify({ dependencies: { "@angular/core": "^17.0.0" } }),
    }));
    const result = detectLanguageAndFramework(dir);
    expect(result.language).toBe("TypeScript");
    expect(result.framework).toBe("Angular");
  });
});

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

describe("detectLanguageAndFramework — Go", () => {
  it("detects Gin from go.mod", () => {
    const dir = tracked(makeRepo({
      "go.mod": "module example.com/app\n\ngo 1.22\n\nrequire github.com/gin-gonic/gin v1.9.1\n",
    }));
    const result = detectLanguageAndFramework(dir);
    expect(result.language).toBe("Go");
    expect(result.framework).toBe("Gin");
  });

  it("detects plain Go for unknown module", () => {
    const dir = tracked(makeRepo({ "go.mod": "module example.com/app\n\ngo 1.22\n" }));
    const result = detectLanguageAndFramework(dir);
    expect(result.language).toBe("Go");
    expect(result.framework).toBe("Go");
  });
});

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

describe("detectLanguageAndFramework — Python", () => {
  it("detects FastAPI from requirements.txt", () => {
    const dir = tracked(makeRepo({ "requirements.txt": "fastapi==0.110.0\nuvicorn==0.29.0\n" }));
    const result = detectLanguageAndFramework(dir);
    expect(result.language).toBe("Python");
    expect(result.framework).toBe("FastAPI");
  });

  it("detects Django from requirements.txt", () => {
    const dir = tracked(makeRepo({ "requirements.txt": "Django==4.2.0\ncelery==5.3.0\n" }));
    const result = detectLanguageAndFramework(dir);
    expect(result.language).toBe("Python");
    expect(result.framework).toBe("Django");
  });
});

// ---------------------------------------------------------------------------
// Unknown fallback
// ---------------------------------------------------------------------------

describe("detectLanguageAndFramework — fallback", () => {
  it("returns Unknown/Unknown for empty repo", () => {
    const dir = tracked(makeRepo({}));
    const result = detectLanguageAndFramework(dir);
    expect(result.language).toBe("Unknown");
    expect(result.framework).toBe("Unknown");
  });
});

// ---------------------------------------------------------------------------
// llmLabel slug construction (mirrors logic in submitBenchmark / runBenchmarkJob)
// ---------------------------------------------------------------------------

describe("llmLabel slug construction", () => {
  function buildLlmLabel(provider: string, model?: string): string {
    return model ? `${provider}-${model}` : provider;
  }

  it("produces provider-model when model is provided", () => {
    expect(buildLlmLabel("anthropic", "claude-sonnet-4-5")).toBe("anthropic-claude-sonnet-4-5");
    expect(buildLlmLabel("openai", "gpt-4o")).toBe("openai-gpt-4o");
    expect(buildLlmLabel("gemini", "gemini-2.0-flash-exp")).toBe("gemini-gemini-2.0-flash-exp");
    expect(buildLlmLabel("deepseek", "deepseek-chat")).toBe("deepseek-deepseek-chat");
  });

  it("produces provider-only when model is omitted", () => {
    expect(buildLlmLabel("anthropic")).toBe("anthropic");
    expect(buildLlmLabel("openai")).toBe("openai");
  });

  it("produces valid DB-safe slug (no slashes, consistent format)", () => {
    const label = buildLlmLabel("anthropic", "claude-sonnet-4-5");
    expect(label).not.toContain("/");
    expect(label).toMatch(/^[a-z0-9-]+$/);
  });

  it("result slug for benchmarks page uses repo-slug + llmLabel", () => {
    function resultSlug(repo: string, llmLabel?: string): string {
      const repoSlug = repo.replace(/\//g, "-");
      return llmLabel ? `${repoSlug}-${llmLabel}` : repoSlug;
    }
    expect(resultSlug("mastodon/mastodon", "anthropic-claude-sonnet-4-5"))
      .toBe("mastodon-mastodon-anthropic-claude-sonnet-4-5");
    expect(resultSlug("expressjs/express"))
      .toBe("expressjs-express");
  });
});
