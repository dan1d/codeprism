import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { selectByHeat, seedFromReadme } from "../../indexer/doc-generator.js";
import type { GitSignals } from "../../indexer/git-signals.js";
import type { ParsedFile } from "../../indexer/types.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeFile(path: string, fileRole = "domain"): ParsedFile {
  return {
    path,
    repo: "test-repo",
    language: "ruby",
    fileRole: fileRole as ParsedFile["fileRole"],
    classes: [],
    functions: [],
    routes: [],
    associations: [],
    imports: [],
    exports: [],
    apiCalls: [],
    storeUsages: [],
    callbacks: [],
    validations: [],
  };
}

describe("selectByHeat", () => {
  const files = [
    makeFile("app/models/user.rb"),
    makeFile("app/controllers/auth_controller.rb"),
    makeFile("app/legacy/old_stuff.rb"),
    makeFile("storybook/stories/Button.stories.tsx"),
    makeFile("app/models/report.rb"),
  ];

  it("sorts files by heat descending", () => {
    const signals: GitSignals = {
      thermalMap: new Map([
        ["app/models/user.rb", 0.9],
        ["app/controllers/auth_controller.rb", 0.7],
        ["app/models/report.rb", 0.4],
        ["app/legacy/old_stuff.rb", 0.1],
        ["storybook/stories/Button.stories.tsx", 0.0],
      ]),
      staleDirectories: new Set(["storybook"]),
      branch: "main",
      branchDiff: null,
    };

    const selected = selectByHeat(files, signals, 4);

    // storybook is stale — should be excluded
    expect(selected.map((f) => f.path)).not.toContain("storybook/stories/Button.stories.tsx");

    // Hot files should appear before cold files
    const paths = selected.map((f) => f.path);
    expect(paths.indexOf("app/models/user.rb")).toBeLessThan(
      paths.indexOf("app/models/report.rb"),
    );
  });

  it("respects the max limit", () => {
    const signals: GitSignals = {
      thermalMap: new Map(files.map((f) => [f.path, 0.5])),
      staleDirectories: new Set(),
      branch: "main",
      branchDiff: null,
    };

    const selected = selectByHeat(files, signals, 3);
    expect(selected.length).toBe(3);
  });

  it("falls back to slice when signals are null", () => {
    const selected = selectByHeat(files, null, 3);
    expect(selected.length).toBe(3);
    expect(selected[0]!.path).toBe(files[0]!.path);
  });

  it("excludes files in stale directories", () => {
    const signals: GitSignals = {
      thermalMap: new Map(),
      staleDirectories: new Set(["app"]),
      branch: "main",
      branchDiff: null,
    };

    const selected = selectByHeat(files, signals, 10);
    for (const f of selected) {
      expect(f.path.startsWith("app/")).toBe(false);
    }
  });
});

describe("seedFromReadme", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "codeprism-readme-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reads README.md when present", async () => {
    await writeFile(join(tmpDir, "README.md"), "# My Project\n\nThis is a great app.");
    const seed = await seedFromReadme(tmpDir);
    expect(seed).toContain("My Project");
    expect(seed).toContain("great app");
  });

  it("falls back to readme.md (lowercase)", async () => {
    await writeFile(join(tmpDir, "readme.md"), "# Lowercase README");
    const seed = await seedFromReadme(tmpDir);
    expect(seed).toContain("Lowercase README");
  });

  it("returns empty string when no README exists", async () => {
    const seed = await seedFromReadme(tmpDir);
    expect(seed).toBe("");
  });

  it("truncates content to 2000 chars", async () => {
    const longContent = "x".repeat(5000);
    await writeFile(join(tmpDir, "README.md"), longContent);
    const seed = await seedFromReadme(tmpDir);
    expect(seed.length).toBeLessThanOrEqual(2000);
  });
});
