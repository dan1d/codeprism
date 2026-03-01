import { execSync } from "node:child_process";
import { nanoid } from "nanoid";
import { getDb } from "../db/connection.js";
import type { Card, PrImport } from "../db/schema.js";
import { getLLMFromDb } from "./instance.js";

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface GhPr {
  number: number;
  title: string;
  body: string;
  url: string;
  headRefName: string;
  mergedAt: string | null;
}

export interface PrImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

/* ------------------------------------------------------------------ */
/*  Git remote → GitHub repo slug                                       */
/* ------------------------------------------------------------------ */

/**
 * Parses a git remote URL into a "owner/repo" GitHub slug.
 * Handles both SSH (git@github.com:owner/repo.git) and
 * HTTPS (https://github.com/owner/repo.git) formats.
 */
function parseGithubSlug(remoteUrl: string): string | null {
  const clean = remoteUrl.trim();
  // SSH: git@github.com:owner/repo.git
  const ssh = clean.match(/git@github\.com:(.+?)(?:\.git)?$/);
  if (ssh) return ssh[1];
  // HTTPS: https://github.com/owner/repo.git or git://github.com/...
  const https = clean.match(/github\.com\/(.+?)(?:\.git)?$/);
  if (https) return https[1];
  return null;
}

function detectGithubSlug(repoPath: string): string | null {
  try {
    const raw = execSync(`git -C "${repoPath}" remote get-url origin 2>/dev/null`, {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    return parseGithubSlug(raw);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  gh CLI wrappers                                                     */
/* ------------------------------------------------------------------ */

function fetchMergedPRs(slug: string, since: string | null, limit = 30): GhPr[] {
  try {
    const raw = execSync(
      `gh pr list --repo "${slug}" --state merged --json number,title,body,url,headRefName,mergedAt --limit ${limit}`,
      { encoding: "utf-8", timeout: 15000 },
    );
    const prs = JSON.parse(raw) as GhPr[];
    if (!since) return prs;
    return prs.filter((p) => p.mergedAt && p.mergedAt > since);
  } catch {
    return [];
  }
}

function fetchPrDiff(slug: string, prNumber: number): string {
  try {
    const diff = execSync(
      `gh pr diff ${prNumber} --repo "${slug}" --patch 2>/dev/null`,
      { encoding: "utf-8", timeout: 20000 },
    );
    // Truncate large diffs — keep first 5000 chars, prioritising file headers
    return diff.length > 5000 ? diff.slice(0, 5000) + "\n... (diff truncated)" : diff;
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------------ */
/*  Flow detection from changed files                                   */
/* ------------------------------------------------------------------ */

/**
 * Extracts changed file paths from a unified diff string.
 */
function extractChangedFiles(diff: string): string[] {
  const files: string[] = [];
  for (const line of diff.split("\n")) {
    const m = line.match(/^diff --git a\/(.+?) b\//);
    if (m) files.push(m[1]);
  }
  return files;
}

/**
 * Finds the most relevant existing flow by looking for cards whose
 * source_files overlap with the PR's changed files.
 * Falls back to the branch name (cleaned up) if no match.
 */
function detectFlow(changedFiles: string[], branchName: string, localRepo: string): string {
  if (changedFiles.length === 0) return sanitizeBranchToFlow(branchName);

  const db = getDb();
  const flowCounts = new Map<string, number>();

  for (const file of changedFiles.slice(0, 20)) {
    // Use LIKE to match the file path anywhere in the JSON array
    const rows = db
      .prepare(
        `SELECT flow FROM cards WHERE stale = 0 AND source_files LIKE ? AND source_repos LIKE ?`,
      )
      .all(`%${file}%`, `%${localRepo}%`) as { flow: string }[];
    for (const r of rows) {
      flowCounts.set(r.flow, (flowCounts.get(r.flow) ?? 0) + 1);
    }
  }

  if (flowCounts.size > 0) {
    // Return the flow with the most file matches
    return [...flowCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  return sanitizeBranchToFlow(branchName);
}

/** Turns "ddiaz/ENG-753/authorizations-for-inactive-patients" → "ENG-753 Authorizations For Inactive Patients" */
function sanitizeBranchToFlow(branch: string): string {
  const parts = branch.split("/");
  const meaningful = parts.find((p) => /^ENG-\d+/.test(p) || p.length > 8) ?? branch;
  return meaningful
    .replace(/^(ENG-\d+[-/]?)/, (m) => m.replace(/[-/]+$/, "") + " ")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/* ------------------------------------------------------------------ */
/*  LLM prompt                                                          */
/* ------------------------------------------------------------------ */

const PR_SYSTEM_PROMPT = `You are generating developer knowledge cards for an internal codebase knowledge base.
Focus on architectural reasoning — WHY decisions were made, not just WHAT changed.
Be precise: use class names, method names, and file paths exactly as they appear in the diff.
Write in past tense ("was added", "now centralizes"). Keep it under 300 words.`;

function buildPrPrompt(pr: GhPr, diff: string, localRepo: string): string {
  const descSection = pr.body.trim()
    ? `## PR Description\n${pr.body.slice(0, 2000)}`
    : "";

  const diffSection = diff.trim()
    ? `## Code Diff\n\`\`\`diff\n${diff}\n\`\`\``
    : "";

  return `Generate a \`dev_insight\` knowledge card for this merged pull request in the **${localRepo}** repository.

PR #${pr.number}: ${pr.title}
Branch: ${pr.headRefName}
Merged: ${pr.mergedAt ?? "recently"}
URL: ${pr.url}

${descSection}

${diffSection}

## Output format
Write a developer knowledge card in markdown:

# ${pr.title}

## What changed
2–4 bullet points describing the specific classes, methods, or patterns that were modified.
Use backtick formatting for all code identifiers.

## Why it was designed this way
1–2 paragraphs explaining the architectural decision — the tradeoffs considered and why this approach was chosen over alternatives.

## What future developers must know
2–3 bullet points of non-obvious implications, gotchas, or follow-on considerations.

## Ticket
${pr.headRefName.match(/ENG-\d+/)?.[0] ?? "—"} · [PR #${pr.number}](${pr.url})

Keep total length under 300 words. Do not list every file in the diff.`;
}

/* ------------------------------------------------------------------ */
/*  Main export                                                         */
/* ------------------------------------------------------------------ */

export interface ImportPrsOptions {
  repoPaths: Array<{ name: string; path: string }>;
  limit?: number;
}

export async function importNewPRs(opts: ImportPrsOptions): Promise<PrImportResult> {
  const llm = getLLMFromDb();
  if (!llm) return { imported: 0, skipped: 0, errors: ["LLM not configured"] };

  const db = getDb();
  const result: PrImportResult = { imported: 0, skipped: 0, errors: [] };

  const insertCard = db.prepare(
    `INSERT OR IGNORE INTO cards
       (id, flow, title, content, card_type, source_files, source_repos, tags,
        valid_branches, commit_sha, identifiers)
     VALUES (?, ?, ?, ?, 'dev_insight', '[]', ?, '["pr-insight"]', NULL, NULL, ?)`,
  );

  const insertPr = db.prepare(
    `INSERT OR IGNORE INTO pr_imports
       (id, github_repo, local_repo, pr_number, pr_title, pr_body, pr_url, branch, merged_at, card_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const repo of opts.repoPaths) {
    const slug = detectGithubSlug(repo.path);
    if (!slug) {
      result.errors.push(`${repo.name}: no GitHub remote detected`);
      continue;
    }

    // Find the most recent import for this repo (use as "since" filter)
    const lastImport = db
      .prepare(
        "SELECT MAX(merged_at) AS last FROM pr_imports WHERE github_repo = ?",
      )
      .get(slug) as { last: string | null };

    const prs = fetchMergedPRs(slug, lastImport.last, opts.limit ?? 30);

    if (prs.length === 0) {
      console.log(`  [${repo.name}] No new merged PRs since last import`);
      continue;
    }

    console.log(`  [${repo.name}] Importing ${prs.length} merged PR(s) from ${slug}…`);

    for (const pr of prs) {
      if (!pr.mergedAt) { result.skipped++; continue; }

      // Skip if already imported
      const exists = db
        .prepare("SELECT id FROM pr_imports WHERE github_repo = ? AND pr_number = ?")
        .get(slug, pr.number);
      if (exists) { result.skipped++; continue; }

      try {
        const diff = fetchPrDiff(slug, pr.number);
        const changedFiles = extractChangedFiles(diff);
        const flow = detectFlow(changedFiles, pr.headRefName, repo.name);

        const prompt = buildPrPrompt(pr, diff, repo.name);
        const content = await llm.generate(prompt, {
          maxTokens: 800,
          temperature: 0.1,
          systemPrompt: PR_SYSTEM_PROMPT,
        });

        // Strip leading # title line (it's stored in `title` separately)
        const cleanContent = content.replace(/^#[^\n]*\n?/, "").trim();

        // Extract identifiers from changed files (class names from paths)
        const identifiers = changedFiles
          .map((f) =>
            f
              .split("/")
              .pop()!
              .replace(/\.(rb|ts|tsx|js|py|go)$/, "")
              .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
          )
          .join(" ");

        const cardId = nanoid();
        insertCard.run(
          cardId,
          flow,
          pr.title,
          cleanContent,
          JSON.stringify([repo.name]),
          identifiers,
        );

        // Rebuild FTS for the new card
        db.exec("INSERT INTO cards_fts(cards_fts) VALUES('rebuild')");

        insertPr.run(
          nanoid(),
          slug,
          repo.name,
          pr.number,
          pr.title,
          pr.body ?? "",
          pr.url,
          pr.headRefName,
          pr.mergedAt,
          cardId,
        );

        result.imported++;
        console.log(`    PR #${pr.number}: "${pr.title}" → flow "${flow}"`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`PR #${pr.number}: ${msg.slice(0, 120)}`);
      }
    }
  }

  return result;
}
