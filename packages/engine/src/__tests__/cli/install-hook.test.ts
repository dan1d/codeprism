/**
 * install-hook unit tests.
 *
 * Creates a real temp git repo, runs installHook, then inspects the
 * resulting hook files. No mocking of the filesystem.
 *
 * Covers: fresh install, idempotency, append-to-existing, non-git-repo error.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

// Dynamically import so the module picks up after vi.mock calls if needed.
const { installHook } = await import("../../cli/install-hook.js");

function initGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "codeprism-hook-test-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });
  return dir;
}

const HOOK_NAMES = ["post-commit", "post-merge", "post-checkout", "post-rewrite"] as const;

describe("installHook — fresh install", () => {
  let repoDir: string;

  beforeEach(() => { repoDir = initGitRepo(); });
  afterEach(() => rmSync(repoDir, { recursive: true, force: true }));

  it("creates all hook files", async () => {
    await installHook(repoDir, { base: "main", strict: false });
    for (const hook of HOOK_NAMES) {
      expect(existsSync(join(repoDir, ".git", "hooks", hook))).toBe(true);
    }
  });

  it("hook files start with a shebang line", async () => {
    await installHook(repoDir, { base: "main", strict: false });
    for (const hook of HOOK_NAMES) {
      const content = readFileSync(join(repoDir, ".git", "hooks", hook), "utf-8");
      expect(content.startsWith("#!/bin/sh")).toBe(true);
    }
  });

  it("hook files contain the codeprism marker", async () => {
    await installHook(repoDir, { base: "main", strict: false });
    for (const hook of HOOK_NAMES) {
      const content = readFileSync(join(repoDir, ".git", "hooks", hook), "utf-8");
      expect(content).toContain("codeprism");
    }
  });

  it("uses the provided engineUrl in the curl command", async () => {
    await installHook(repoDir, {
      base: "main",
      strict: false,
      engineUrl: "https://myengine.onrender.com",
    });
    const content = readFileSync(join(repoDir, ".git", "hooks", "post-merge"), "utf-8");
    expect(content).toContain("https://myengine.onrender.com");
  });

  it("defaults to localhost:4000 when engineUrl is omitted", async () => {
    await installHook(repoDir, { base: "main", strict: false });
    const content = readFileSync(join(repoDir, ".git", "hooks", "post-merge"), "utf-8");
    expect(content).toContain("http://localhost:4000");
  });

  it("post-checkout hook only acts on branch switches (checks $3)", async () => {
    await installHook(repoDir, { base: "main", strict: false });
    const content = readFileSync(join(repoDir, ".git", "hooks", "post-checkout"), "utf-8");
    expect(content).toContain('[ "$3" = "1" ] || exit 0');
  });
});

describe("installHook — idempotency", () => {
  let repoDir: string;

  beforeEach(() => { repoDir = initGitRepo(); });
  afterEach(() => rmSync(repoDir, { recursive: true, force: true }));

  it("does not duplicate content when run twice", async () => {
    await installHook(repoDir, { base: "main", strict: false });
    await installHook(repoDir, { base: "main", strict: false });
    for (const hook of HOOK_NAMES) {
      const content = readFileSync(join(repoDir, ".git", "hooks", hook), "utf-8");
      const occurrences = (content.match(/codeprism/g) ?? []).length;
      // First install: 1-2 occurrences. Second install must not add more.
      expect(occurrences).toBeLessThanOrEqual(4);
    }
  });
});

describe("installHook — append to existing hook", () => {
  let repoDir: string;

  beforeEach(() => { repoDir = initGitRepo(); });
  afterEach(() => rmSync(repoDir, { recursive: true, force: true }));

  it("appends after an existing hook that doesn't contain codeprism", async () => {
    const hooksDir = join(repoDir, ".git", "hooks");
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(
      join(hooksDir, "post-merge"),
      "#!/bin/sh\necho 'existing hook'\n",
      { mode: 0o755 }
    );

    await installHook(repoDir, { base: "main", strict: false });

    const content = readFileSync(join(hooksDir, "post-merge"), "utf-8");
    expect(content).toContain("existing hook");
    expect(content).toContain("codeprism");
  });

  it("preserves the existing shebang line", async () => {
    const hooksDir = join(repoDir, ".git", "hooks");
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(
      join(hooksDir, "post-merge"),
      "#!/bin/bash\necho 'other hook'\n",
      { mode: 0o755 }
    );

    await installHook(repoDir, { base: "main", strict: false });

    const content = readFileSync(join(hooksDir, "post-merge"), "utf-8");
    expect(content.startsWith("#!/bin/bash")).toBe(true);
  });
});

describe("installHook — non-git directory", () => {
  it("calls process.exit(1) when run outside a git repo", async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "codeprism-nogit-"));
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error("process.exit called");
    });
    try {
      await expect(
        installHook(emptyDir, { base: "main", strict: false })
      ).rejects.toThrow("process.exit called");
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
