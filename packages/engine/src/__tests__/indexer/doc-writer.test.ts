import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeDocsToFilesystem, type DocToWrite } from "../../indexer/doc-writer.js";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("writeDocsToFilesystem", () => {
  let workspaceDir: string;
  let repoDir: string;

  beforeEach(async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), "srcmap-test-"));
    repoDir = await mkdtemp(join(tmpdir(), "srcmap-repo-"));
  });

  afterEach(async () => {
    await rm(workspaceDir, { recursive: true, force: true });
    await rm(repoDir, { recursive: true, force: true });
  });

  it("writes docs to /ai-srcmap/ under each repo root", async () => {
    const docs: DocToWrite[] = [
      { repoAbsPath: repoDir, docType: "readme", content: "# Hello" },
      { repoAbsPath: repoDir, docType: "about", content: "About the project" },
    ];

    const result = await writeDocsToFilesystem(docs, workspaceDir);

    expect(result.written).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);

    const readmeContent = await readFile(join(repoDir, "ai-srcmap", "README.md"), "utf-8");
    expect(readmeContent).toBe("# Hello");

    const aboutContent = await readFile(join(repoDir, "ai-srcmap", "ABOUT.md"), "utf-8");
    expect(aboutContent).toBe("About the project");
  });

  it("writes cross_repo doc under workspace root", async () => {
    const docs: DocToWrite[] = [
      { repoAbsPath: repoDir, docType: "cross_repo", content: "# Cross Repo" },
    ];

    const result = await writeDocsToFilesystem(docs, workspaceDir);

    expect(result.written).toBe(1);
    expect(existsSync(join(workspaceDir, "ai-srcmap", "CROSS_REPO.md"))).toBe(true);
  });

  it("skips files whose content hash matches existing file (idempotent write)", async () => {
    const docs: DocToWrite[] = [
      { repoAbsPath: repoDir, docType: "rules", content: "## Rules" },
    ];

    // Write once
    await writeDocsToFilesystem(docs, workspaceDir);

    // Write again — should skip
    const result = await writeDocsToFilesystem(docs, workspaceDir);
    expect(result.written).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("overwrites when content changes", async () => {
    const docs1: DocToWrite[] = [{ repoAbsPath: repoDir, docType: "readme", content: "v1" }];
    const docs2: DocToWrite[] = [{ repoAbsPath: repoDir, docType: "readme", content: "v2" }];

    await writeDocsToFilesystem(docs1, workspaceDir);
    const result = await writeDocsToFilesystem(docs2, workspaceDir);

    expect(result.written).toBe(1);
    expect(result.skipped).toBe(0);

    const content = await readFile(join(repoDir, "ai-srcmap", "README.md"), "utf-8");
    expect(content).toBe("v2");
  });
});
