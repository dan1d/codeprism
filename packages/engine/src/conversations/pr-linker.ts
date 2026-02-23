/**
 * Links extracted insights to git commits/PRs via file-overlap matching.
 *
 * Strategy:
 *   1. Collect file paths mentioned in the transcript (regex scan)
 *   2. Find git commits that touched those same files in a ±7-day window
 *      around the transcript timestamp
 *   3. If a merged commit is found → trust_score boosted to 0.85
 *      If the commit was later reverted → stale = 1
 *
 * File-overlap is the most reliable signal because it's deterministic and
 * doesn't require any semantic matching.
 */

import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import type { Transcript } from "./parser.js";

const exec = promisify(execCb);

export interface PRLink {
  transcriptId: string;
  repo: string;
  commitSha: string | null;
  matchedFiles: string[];
  status: "merged" | "reverted" | "unknown";
}

// ---------------------------------------------------------------------------
// File path extraction from transcript text
// ---------------------------------------------------------------------------

const FILE_PATH_PATTERN =
  /(?:^|[\s`'"(])([a-zA-Z0-9_\-./]+\/[a-zA-Z0-9_\-./]+\.[a-zA-Z]{1,5})(?:[\s`'":#),]|$)/gm;

export function extractFilePaths(text: string): string[] {
  const paths = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = FILE_PATH_PATTERN.exec(text)) !== null) {
    const path = match[1]!.replace(/^[./]+/, "");
    if (path && !path.startsWith("http") && path.includes("/")) {
      paths.add(path);
    }
  }

  return [...paths];
}

// ---------------------------------------------------------------------------
// Git-based commit lookup
// ---------------------------------------------------------------------------

/**
 * Attempts to find a git commit in the given repo that:
 *   - Was made within ±7 days of the transcript date
 *   - Touched at least one of the files mentioned in the transcript
 *
 * Returns the best matching PRLink or null if no match.
 */
export async function findPRLink(
  transcript: Transcript,
  repoAbsPath: string,
  repoName: string,
  windowDays = 7,
): Promise<PRLink | null> {
  const referencedFiles = extractFilePaths(transcript.rawText);
  if (referencedFiles.length === 0) return null;

  // Build date window (ISO format)
  const transcriptDate = transcript.messages[0]?.timestamp
    ? new Date(transcript.messages[0].timestamp)
    : new Date();

  const after = new Date(transcriptDate.getTime() - windowDays * 86_400_000).toISOString();
  const before = new Date(transcriptDate.getTime() + windowDays * 86_400_000).toISOString();

  let gitLog: string;
  try {
    const result = await exec(
      `git -C "${repoAbsPath}" log --format="%H" --after="${after}" --before="${before}" --name-only`,
      { maxBuffer: 10 * 1024 * 1024 },
    );
    gitLog = result.stdout;
  } catch {
    return null;
  }

  // Parse commit blocks: SHA line, then file lines, blank line between blocks
  const blocks = gitLog.trim().split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    const sha = lines[0]?.trim();
    if (!sha || sha.length !== 40) continue;

    const changedFiles = lines.slice(1).map((l) => l.trim()).filter(Boolean);
    const matched = referencedFiles.filter((f) =>
      changedFiles.some((cf) => cf.includes(f) || f.includes(cf)),
    );

    if (matched.length > 0) {
      // Check if this commit was reverted
      const status = await checkRevertStatus(repoAbsPath, sha);
      return {
        transcriptId: transcript.id,
        repo: repoName,
        commitSha: sha,
        matchedFiles: matched,
        status,
      };
    }
  }

  return null;
}

async function checkRevertStatus(repoAbsPath: string, sha: string): Promise<"merged" | "reverted" | "unknown"> {
  try {
    // Check if there's a later "Revert" commit that reverts this SHA
    const result = await exec(
      `git -C "${repoAbsPath}" log --oneline --all --grep="Revert.*${sha.slice(0, 7)}"`,
      { maxBuffer: 1024 * 1024 },
    );
    if (result.stdout.trim()) return "reverted";
    return "merged";
  } catch {
    return "unknown";
  }
}
