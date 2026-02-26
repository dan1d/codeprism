/**
 * Unit tests for services/catalog.ts
 *
 * Each test gets an isolated temp directory so the catalog SQLite DB is
 * completely fresh. vi.resetModules() + vi.doMock() re-initialises the
 * module-level singletons (_db, _seeded) for every test.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cp-catalog-test-"));
  vi.resetModules();
  // Redirect getDataDir so the catalog DB lands in our temp dir
  vi.doMock("../../db/connection.js", () => ({ getDataDir: () => tmpDir }));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// getCatalog
// ---------------------------------------------------------------------------

describe("getCatalog", () => {
  it("returns seeded entries on first call", async () => {
    const { getCatalog } = await import("../../services/catalog.js");
    const catalog = getCatalog();
    expect(catalog.length).toBeGreaterThan(0);
  });

  it("every entry has at least one default prompt", async () => {
    const { getCatalog } = await import("../../services/catalog.js");
    const catalog = getCatalog();
    for (const entry of catalog) {
      expect(entry.prompts.some((p) => p.isDefault), `${entry.repo} missing default prompt`).toBe(true);
    }
  });

  it("returns consistent shape with required fields", async () => {
    const { getCatalog } = await import("../../services/catalog.js");
    const [first] = getCatalog();
    expect(first).toHaveProperty("repo");
    expect(first).toHaveProperty("name");
    expect(first).toHaveProperty("language");
    expect(first).toHaveProperty("description");
    expect(typeof first.requiresKey).toBe("boolean");
    expect(Array.isArray(first.prompts)).toBe(true);
    expect(first.prompts[0]).toHaveProperty("id");
    expect(first.prompts[0]).toHaveProperty("prompt");
    expect(first.prompts[0]).toHaveProperty("runCount");
    expect(first.prompts[0]).toHaveProperty("createdAt");
  });

  it("runCount defaults to 0 for all seeded prompts", async () => {
    const { getCatalog } = await import("../../services/catalog.js");
    const catalog = getCatalog();
    const allPrompts = catalog.flatMap((e) => e.prompts);
    expect(allPrompts.every((p) => p.runCount === 0)).toBe(true);
  });

  it("is idempotent — second call returns same count", async () => {
    const { getCatalog } = await import("../../services/catalog.js");
    const first = getCatalog();
    const second = getCatalog();
    expect(second.length).toBe(first.length);
  });
});

// ---------------------------------------------------------------------------
// addCatalogPrompt
// ---------------------------------------------------------------------------

describe("addCatalogPrompt", () => {
  it("adds a prompt to an existing repo and returns an id", async () => {
    const { getCatalog, addCatalogPrompt } = await import("../../services/catalog.js");
    const [first] = getCatalog();
    const id = addCatalogPrompt(first.repo, "How does error handling work here?");
    expect(typeof id).toBe("number");
    expect(id).toBeGreaterThan(0);
  });

  it("new prompt appears in subsequent getCatalog call", async () => {
    const { getCatalog, addCatalogPrompt } = await import("../../services/catalog.js");
    const [first] = getCatalog();
    const prompt = "How are database migrations handled?";
    addCatalogPrompt(first.repo, prompt);
    const catalog = getCatalog();
    const entry = catalog.find((e) => e.repo === first.repo)!;
    expect(entry.prompts.some((p) => p.prompt === prompt)).toBe(true);
  });

  it("new prompt has isDefault=false", async () => {
    const { getCatalog, addCatalogPrompt } = await import("../../services/catalog.js");
    const [first] = getCatalog();
    const id = addCatalogPrompt(first.repo, "How does caching work?");
    const catalog = getCatalog();
    const entry = catalog.find((e) => e.repo === first.repo)!;
    const added = entry.prompts.find((p) => p.id === id)!;
    expect(added.isDefault).toBe(false);
  });

  it("trims and truncates prompts to 500 chars", async () => {
    const { getCatalog, addCatalogPrompt } = await import("../../services/catalog.js");
    const [first] = getCatalog();
    const long = "A".repeat(600);
    const id = addCatalogPrompt(first.repo, long);
    const catalog = getCatalog();
    const entry = catalog.find((e) => e.repo === first.repo)!;
    const added = entry.prompts.find((p) => p.id === id)!;
    expect(added.prompt.length).toBe(500);
  });

  it("throws 404 for unknown repo", async () => {
    const { addCatalogPrompt } = await import("../../services/catalog.js");
    expect(() => addCatalogPrompt("unknown/repo-xyz", "Some question?")).toThrowError(
      /not in the benchmark catalog/,
    );
  });

  it("thrown error for unknown repo has statusCode 404", async () => {
    const { addCatalogPrompt } = await import("../../services/catalog.js");
    try {
      addCatalogPrompt("unknown/not-a-real-repo", "Some question?");
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as { statusCode?: number }).statusCode).toBe(404);
    }
  });
});

// ---------------------------------------------------------------------------
// incrementPromptRunCount
// ---------------------------------------------------------------------------

describe("incrementPromptRunCount", () => {
  it("increments run_count by 1", async () => {
    const { getCatalog, addCatalogPrompt, incrementPromptRunCount } = await import("../../services/catalog.js");
    const [first] = getCatalog();
    const id = addCatalogPrompt(first.repo, "How does routing work?");

    incrementPromptRunCount(id);
    incrementPromptRunCount(id);

    const catalog = getCatalog();
    const entry = catalog.find((e) => e.repo === first.repo)!;
    const prompt = entry.prompts.find((p) => p.id === id)!;
    expect(prompt.runCount).toBe(2);
  });

  it("is a no-op for non-existent prompt id", async () => {
    const { incrementPromptRunCount } = await import("../../services/catalog.js");
    // Should not throw
    expect(() => incrementPromptRunCount(999_999)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getCatalog prompt ordering
// ---------------------------------------------------------------------------

describe("getCatalog prompt ordering", () => {
  it("default prompts sort before user prompts", async () => {
    const { getCatalog, addCatalogPrompt } = await import("../../services/catalog.js");
    const [first] = getCatalog();
    addCatalogPrompt(first.repo, "A user contributed question here?");

    const catalog = getCatalog();
    const entry = catalog.find((e) => e.repo === first.repo)!;
    const firstNonDefault = entry.prompts.findIndex((p) => !p.isDefault);
    const lastDefault = [...entry.prompts].reverse().findIndex((p) => p.isDefault);
    // All defaults come before any non-default
    expect(firstNonDefault).toBeGreaterThan(entry.prompts.length - 1 - lastDefault);
  });

  it("higher run_count prompts sort before lower ones within same group", async () => {
    const { getCatalog, addCatalogPrompt, incrementPromptRunCount } = await import("../../services/catalog.js");
    const [first] = getCatalog();
    const id1 = addCatalogPrompt(first.repo, "First user prompt?");
    const id2 = addCatalogPrompt(first.repo, "Second user prompt?");

    // Give id2 higher run count
    incrementPromptRunCount(id2);
    incrementPromptRunCount(id2);
    incrementPromptRunCount(id1);

    const catalog = getCatalog();
    const entry = catalog.find((e) => e.repo === first.repo)!;
    const userPrompts = entry.prompts.filter((p) => !p.isDefault);
    const idx1 = userPrompts.findIndex((p) => p.id === id1);
    const idx2 = userPrompts.findIndex((p) => p.id === id2);
    // id2 has run_count=2, id1 has run_count=1 → id2 should come first
    expect(idx2).toBeLessThan(idx1);
  });
});

// ---------------------------------------------------------------------------
// closeCatalogDb
// ---------------------------------------------------------------------------

describe("closeCatalogDb", () => {
  it("can be called without throwing when db is open", async () => {
    const { getCatalog, closeCatalogDb } = await import("../../services/catalog.js");
    getCatalog(); // opens the DB
    expect(() => closeCatalogDb()).not.toThrow();
  });

  it("is idempotent — double close does not throw", async () => {
    const { getCatalog, closeCatalogDb } = await import("../../services/catalog.js");
    getCatalog();
    closeCatalogDb();
    expect(() => closeCatalogDb()).not.toThrow();
  });
});
