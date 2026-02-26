/**
 * Writes generated project documentation to the filesystem under /ai-codeprism/.
 *
 * Files are written idempotently: if the content hash matches the existing
 * file, the write is skipped to avoid spurious git diffs.
 *
 * Layout:
 *   <repo-root>/ai-codeprism/<FILENAME>.md   — per-repo docs
 *   <workspace-root>/ai-codeprism/CROSS_REPO.md — workspace-level cross-repo doc
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DocType } from "./doc-prompts.js";

const AI_DOCS_DIR = "ai-codeprism";

/** Maps DocType → filename in /ai-codeprism/ */
const DOC_FILENAME: Record<DocType, string> = {
  readme:        "README.md",
  about:         "ABOUT.md",
  architecture:  "ARCHITECTURE.md",
  code_style:    "CODE_STYLE.md",
  rules:         "RULES.md",
  styles:        "STYLES.md",
  api_contracts: "API_CONTRACTS.md",
  specialist:    "SPECIALIST.md",
  changelog:     "CHANGELOG.md",
  memory:        "MEMORY.md",
  pages:         "PAGES.md",
  be_overview:   "BE_OVERVIEW.md",
  business:      "BUSINESS.md",
  product:       "PRODUCT.md",
  cross_repo:    "CROSS_REPO.md",
};

export interface DocToWrite {
  repoAbsPath: string;
  docType: DocType;
  content: string;
}

export interface WriteResult {
  written: number;
  skipped: number;
  errors: string[];
}

/**
 * Writes a batch of generated docs to their /ai-codeprism/ filesystem locations.
 * Skips files where the content hash matches the existing file content.
 *
 * @param docs — list of docs to write
 * @param workspaceAbsPath — root of the workspace (for cross_repo doc)
 */
export async function writeDocsToFilesystem(
  docs: DocToWrite[],
  workspaceAbsPath: string,
): Promise<WriteResult> {
  const result: WriteResult = { written: 0, skipped: 0, errors: [] };

  for (const doc of docs) {
    try {
      const dir = doc.docType === "cross_repo"
        ? join(workspaceAbsPath, AI_DOCS_DIR)
        : join(doc.repoAbsPath, AI_DOCS_DIR);

      const filename = DOC_FILENAME[doc.docType];
      const filePath = join(dir, filename);

      // Ensure /ai-codeprism/ directory exists; on first creation also update .gitignore
      const dirIsNew = !existsSync(dir);
      if (dirIsNew) {
        await mkdir(dir, { recursive: true });
        await ensureGitignoreEntry(doc.repoAbsPath === workspaceAbsPath
          ? workspaceAbsPath
          : doc.repoAbsPath);
      }

      // Hash-skip: don't write if content unchanged
      if (existsSync(filePath)) {
        const existing = await readFile(filePath, "utf-8").catch(() => "");
        if (sha256(existing) === sha256(doc.content)) {
          result.skipped++;
          continue;
        }
      }

      await writeFile(filePath, doc.content, "utf-8");
      result.written++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${doc.docType}: ${msg}`);
    }
  }

  return result;
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Appends `ai-codeprism/` to the repo's .gitignore if the entry isn't already
 * present. Called once per repo on the first time the ai-codeprism/ dir is created.
 * Failures are silently ignored — the absence of a .gitignore entry is a
 * cosmetic issue, not a functional one.
 */
async function ensureGitignoreEntry(repoAbsPath: string): Promise<void> {
  const gitignorePath = join(repoAbsPath, ".gitignore");
  const entry = `${AI_DOCS_DIR}/`;
  try {
    const existing = existsSync(gitignorePath)
      ? await readFile(gitignorePath, "utf-8")
      : "";
    if (existing.split("\n").some((line) => line.trim() === entry)) return;
    // Append with a leading newline to avoid merging with the last line
    await appendFile(gitignorePath, `\n${entry}\n`, "utf-8");
  } catch {
    // Non-fatal: we just skip the .gitignore update silently
  }
}
