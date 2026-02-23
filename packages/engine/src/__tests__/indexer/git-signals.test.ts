import { describe, it, expect } from "vitest";
import { buildGitSignals, getFileHeat, isInStaleDir } from "../../indexer/git-signals.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("getFileHeat", () => {
  it("returns heat from thermalMap", () => {
    const map = new Map([["src/models/user.rb", 0.8], ["src/legacy.rb", 0.1]]);
    expect(getFileHeat("src/models/user.rb", map)).toBe(0.8);
  });

  it("returns 0 for files not in thermal window", () => {
    const map = new Map<string, number>();
    expect(getFileHeat("some/cold/file.rb", map)).toBe(0);
  });

  it("strips leading ./ from paths", () => {
    const map = new Map([["src/app.ts", 0.5]]);
    expect(getFileHeat("./src/app.ts", map)).toBe(0.5);
  });
});

describe("isInStaleDir", () => {
  it("returns true for files whose top-level dir is stale", () => {
    const stale = new Set(["cypress", "storybook"]);
    expect(isInStaleDir("cypress/e2e/auth.spec.ts", stale)).toBe(true);
    expect(isInStaleDir("storybook/stories/Button.stories.ts", stale)).toBe(true);
  });

  it("returns false for active directories", () => {
    const stale = new Set(["cypress"]);
    expect(isInStaleDir("src/models/user.rb", stale)).toBe(false);
    expect(isInStaleDir("app/controllers/users_controller.rb", stale)).toBe(false);
  });
});

describe("buildGitSignals", () => {
  it("returns empty signals for a non-git directory", async () => {
    const signals = await buildGitSignals(tmpdir());
    expect(signals.thermalMap.size).toBe(0);
    expect(signals.staleDirectories.size).toBe(0);
  });

  it("handles empty git repos gracefully", async () => {
    const signals = await buildGitSignals(join(tmpdir(), "does-not-exist-xyz"));
    expect(signals.thermalMap).toBeInstanceOf(Map);
    expect(signals.staleDirectories).toBeInstanceOf(Set);
  });
});
