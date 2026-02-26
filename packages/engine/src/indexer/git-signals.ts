/**
 * Git-based signals for the codeprism indexer.
 *
 * A single `git log` pass extracts two signals used throughout the pipeline:
 *   - thermalMap   — normalized commit frequency per file (0.0 cold → 1.0 hot)
 *   - staleDirectories — top-level dirs with zero commits in the last STALE_THRESHOLD_DAYS
 *
 * These drive file-selection ordering (hot files go first in LLM prompts), card
 * quality tiering (hot flows get premium LLM cards), and stale-dir filtering.
 */

import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const exec = promisify(execCb);

export const STALE_THRESHOLD_DAYS = 150;
export const THERMAL_WINDOW_DAYS = 180;

export interface GitSignals {
  /** filePath (relative to repoPath) → normalized commit frequency 0.0–1.0 */
  thermalMap: Map<string, number>;
  /**
   * Top-level directory names (relative, no trailing slash) that received
   * zero commits within THERMAL_WINDOW_DAYS. Safe to skip in LLM prompts.
   */
  staleDirectories: Set<string>;
  /** Currently checked-out branch name at the time of indexing */
  branch: string;
  /** Branch diff context (null when on main/master — no extra context needed) */
  branchDiff: BranchDiffContext | null;
}

// ---------------------------------------------------------------------------
// Workspace-level branch signal — cross-repo epic/branch detection
// ---------------------------------------------------------------------------

export interface RepoBranchSummary {
  repo: string;
  branch: string;
  branchClass: BranchClass;
  targetEnvironment: TargetEnvironment | null;
  ticketIds: string[];
  commitsAhead: number;
}

export interface WorkspaceBranchSignal {
  /**
   * The dominant non-base branch if 2+ repos share the same branch name.
   * This is the "epic" or "feature" branch the team is working on.
   * null if repos are on different branches or all on base branches.
   */
  epicBranch: string | null;
  /** Class of the epic branch */
  epicBranchClass: BranchClass;
  /** Target environment of the epic branch (e.g. "demo" for demo/orlando) */
  epicTargetEnvironment: TargetEnvironment | null;
  /** Names of repos currently on the epic branch */
  epicRepos: string[];
  /**
   * Repos still on their base branch — they haven't picked up the epic yet.
   * Their docs should note "this repo has no branch-specific changes for this epic."
   */
  behindRepos: string[];
  /**
   * Repos on a non-base branch that is **not** the epic branch.
   * Each team member may be on a different personal/task branch.
   * These repos are diverged from both base and the epic — worth flagging in cross-repo docs.
   */
  splitRepos: string[];
  /** Per-repo branch state, ordered as supplied */
  repoBranches: RepoBranchSummary[];
  /** All ticket IDs found across all repo branch names, deduplicated */
  allTicketIds: string[];
  /**
   * Remote branch details per repo, keyed by repo name.
   * Populated by `git fetch` — no API token needed.
   * Contains recent commit messages and changed files for the epic branch.
   */
  remoteBranches: Map<string, RemoteBranchSummary>;
}

export interface RemoteBranchSummary {
  /** Branch name as it appears on the remote (without "origin/") */
  branch: string;
  /** The 5 most recent commit subject lines on this remote branch */
  recentCommits: string[];
  /** Files changed on this branch vs the repo's base branch */
  changedFiles: string[];
}

/**
 * Builds the workspace-level branch signal by inspecting all repos in parallel.
 *
 * This is the entry point that replaces per-repo `getCurrentBranch()` calls —
 * it gives the full cross-repo picture before any per-repo processing begins.
 */
export async function buildWorkspaceBranchSignal(
  repos: Array<{ name: string; absPath: string }>,
  opts: {
    ticketId?: string;
    branchOverride?: string;
    /**
     * Run `git fetch --all --prune` before collecting remote branch details.
     * Opt-in only to avoid surprise network I/O. Default: false.
     */
    fetchRemote?: boolean;
  } = {},
): Promise<WorkspaceBranchSignal> {
  // 1. Collect branch state from all repos in parallel
  const summaries = await Promise.all(
    repos.map(async (repo) => {
      const branch = opts.branchOverride ?? await getCurrentBranch(repo.absPath);
      const { branchClass, targetEnvironment } = classifyBranch(branch);
      const ticketIds = [...branch.matchAll(/\b([A-Z]{2,}-\d+)\b/g)].map((m) => m[1]!);

      let commitsAhead = 0;
      if (branchClass !== "base") {
        try {
          // Find what to diff against
          const baseCandidates = ["staging", "develop", "main", "master"];
          for (const candidate of baseCandidates) {
            if (candidate === branch) continue;
            try {
              await exec(`git -C "${repo.absPath}" rev-parse --verify ${candidate}`, { maxBuffer: 512 });
              const r = await exec(`git -C "${repo.absPath}" rev-list --count ${candidate}..HEAD`, { maxBuffer: 512 });
              commitsAhead = parseInt(r.stdout.trim(), 10) || 0;
              break;
            } catch { /* try next */ }
          }
        } catch { /* ignore */ }
      }

      return { repo: repo.name, branch, branchClass, targetEnvironment, ticketIds, commitsAhead } satisfies RepoBranchSummary;
    }),
  );

  // 2. Identify the dominant non-base branch (the "epic")
  //    Count how many repos are on each non-base branch
  const branchCounts = new Map<string, string[]>(); // branch → repo names
  for (const s of summaries) {
    if (s.branchClass !== "base") {
      const existing = branchCounts.get(s.branch) ?? [];
      existing.push(s.repo);
      branchCounts.set(s.branch, existing);
    }
  }

  // Sort by count desc, then name alphabetically for determinism
  const sorted = [...branchCounts.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );
  const [epicBranch, epicRepoNames] = sorted[0] ?? [null, []];

  // Also consider the explicitly provided --ticket flag to find participating repos
  const explicitTicketId = opts.ticketId;
  const epicSummary = epicBranch
    ? summaries.find((s) => s.branch === epicBranch)
    : null;

  const epicRepos = epicRepoNames;
  const behindRepos = summaries
    .filter((s) => s.branchClass === "base" && (epicBranch !== null || explicitTicketId !== undefined))
    .map((s) => s.repo);
  // Repos on a non-base branch that is NOT the epic branch — each is diverged independently
  const splitRepos = epicBranch
    ? summaries
        .filter((s) => s.branchClass !== "base" && s.branch !== epicBranch)
        .map((s) => s.repo)
    : [];

  // Merge all ticket IDs from branch names + explicit --ticket
  const allTicketIds = [
    ...new Set([
      ...(explicitTicketId ? [explicitTicketId] : []),
      ...summaries.flatMap((s) => s.ticketIds),
    ]),
  ];

  // 3. Optionally fetch remote branch details via `git fetch`.
  //    Opt-in only (fetchRemote: true / --fetch-remote CLI flag) to avoid
  //    unexpected network I/O during offline or CI runs.
  const remoteBranches = new Map<string, RemoteBranchSummary>();
  if (opts.fetchRemote && (epicBranch || allTicketIds.length > 0)) {
    await fetchRemoteBranchDetails(repos, epicBranch, allTicketIds, remoteBranches);
  }

  return {
    epicBranch,
    epicBranchClass: epicSummary?.branchClass ?? "feature",
    epicTargetEnvironment: epicSummary?.targetEnvironment ?? null,
    epicRepos,
    behindRepos,
    splitRepos,
    repoBranches: summaries,
    allTicketIds,
    remoteBranches,
  };
}

/**
 * Uses `git fetch --all` + `git branch -r` to discover remote branches across
 * all repos and extract context for the epic branch / ticket.
 *
 * No API token required — pure git. Works with any git host.
 * Failures per-repo are silently skipped; enrichment is always additive.
 */
async function fetchRemoteBranchDetails(
  repos: Array<{ name: string; absPath: string }>,
  epicBranch: string | null,
  ticketIds: string[],
  out: Map<string, RemoteBranchSummary>,
): Promise<void> {
  await Promise.all(
    repos.map(async (repo) => {
      try {
        // Fetch remote state (quiet, no output needed)
        await exec(`git -C "${repo.absPath}" fetch --all --prune --quiet`, {
          maxBuffer: 10 * 1024 * 1024,
          timeout: 30_000,
        }).catch(() => { /* fetch can fail offline — continue with cached refs */ });

        // List all remote branches
        const branchListResult = await exec(
          `git -C "${repo.absPath}" branch -r --format="%(refname:short)"`,
          { maxBuffer: 1024 * 1024 },
        );
        const remoteBranches = branchListResult.stdout
          .split("\n")
          .map((l) => l.trim().replace(/^origin\//, ""))
          .filter(Boolean);

        // Find the best matching remote branch:
        // 1. Exact match on epicBranch
        // 2. Branch name contains a ticket ID
        const candidateBranch =
          (epicBranch && remoteBranches.includes(epicBranch) ? epicBranch : null) ??
          remoteBranches.find((b) => ticketIds.some((t) => b.includes(t))) ??
          null;

        if (!candidateBranch) return;

        const remoteRef = `origin/${candidateBranch}`;

        // Find base to diff against
        let baseBranch = "main";
        for (const candidate of ["origin/staging", "origin/develop", "origin/main", "origin/master"]) {
          if (candidate === remoteRef) continue;
          try {
            await exec(`git -C "${repo.absPath}" rev-parse --verify ${candidate}`, { maxBuffer: 512 });
            baseBranch = candidate;
            break;
          } catch { /* try next */ }
        }

        // Recent commit subjects on this remote branch (context for prompts)
        const logResult = await exec(
          `git -C "${repo.absPath}" log "${remoteRef}" --format="%s" -n 8 --no-merges`,
          { maxBuffer: 512 * 1024 },
        ).catch(() => ({ stdout: "" }));
        const recentCommits = logResult.stdout
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);

        // Files changed on this remote branch vs base
        const diffResult = await exec(
          `git -C "${repo.absPath}" diff --name-only "${baseBranch}...${remoteRef}"`,
          { maxBuffer: 5 * 1024 * 1024 },
        ).catch(() => ({ stdout: "" }));
        const changedFiles = diffResult.stdout
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);

        out.set(repo.name, { branch: candidateBranch, recentCommits, changedFiles });
      } catch {
        // Any unexpected error — skip this repo silently
      }
    }),
  );
}

/**
 * Builds git signals for a single repository root in one git log pass.
 *
 * Falls back to an empty map + empty set if the directory is not a git repo
 * or git is unavailable — all callers must handle zero-heat gracefully.
 */
export async function buildGitSignals(repoAbsPath: string): Promise<GitSignals> {
  const branch = await getCurrentBranch(repoAbsPath);
  const branchDiff = await buildBranchDiffContext(repoAbsPath, branch);
  const empty: GitSignals = { thermalMap: new Map(), staleDirectories: new Set(), branch, branchDiff };

  let stdout: string;
  try {
    const result = await exec(
      `git -C "${repoAbsPath}" log ` +
      `--since="${THERMAL_WINDOW_DAYS} days ago" ` +
      `--format="%ct" --name-only --no-merges`,
      { maxBuffer: 50 * 1024 * 1024 },
    );
    stdout = result.stdout;
  } catch {
    return empty;
  }

  if (!stdout.trim()) return empty;

  // Parse the log output: each commit block is a timestamp line, blank line,
  // file list, then another blank line.
  const commitCount = new Map<string, number>();
  const lines = stdout.split("\n");

  let inFileList = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      inFileList = false;
      continue;
    }
    // Timestamp lines are pure integers
    if (/^\d+$/.test(trimmed)) {
      inFileList = true;
      continue;
    }
    if (inFileList) {
      commitCount.set(trimmed, (commitCount.get(trimmed) ?? 0) + 1);
    }
  }

  if (commitCount.size === 0) return empty;

  // Normalize to 0–1 heat score
  const maxCount = Math.max(...commitCount.values());
  const thermalMap = new Map<string, number>(
    [...commitCount.entries()].map(([f, c]) => [f, c / maxCount]),
  );

  // Derive stale directories: top-level dirs with no files in the thermal map
  const staleDirectories = detectStaleFromThermal(thermalMap, repoAbsPath);

  return { thermalMap, staleDirectories, branch, branchDiff };
}

/**
 * Returns the name of the currently checked-out branch in a git repo.
 * Falls back to "main" if git is unavailable or the repo has no commits.
 */
export async function getCurrentBranch(repoAbsPath: string): Promise<string> {
  try {
    const result = await exec(
      `git -C "${repoAbsPath}" rev-parse --abbrev-ref HEAD`,
      { maxBuffer: 1024 },
    );
    return result.stdout.trim() || "main";
  } catch {
    return "main";
  }
}

/**
 * Semantic classification of a branch by its purpose.
 *
 *  base        — integration branches (main, master, develop, trunk)
 *  environment — long-lived deployment branches (staging, production, demo/*, release/*)
 *  feature     — short-lived developer branches (feature/*, ENG-*, fix/*, etc.)
 */
export type BranchClass = "base" | "environment" | "feature";

/**
 * The target deployment environment implied by the branch name.
 * Only set for `environment` class branches.
 */
export type TargetEnvironment = "demo" | "staging" | "production" | "release" | "other";

/** Branch names that are always treated as base integration branches. */
const BASE_BRANCH_NAMES = new Set(["main", "master", "develop", "trunk"]);

/** Regex patterns that identify environment branches and their target env. */
const ENVIRONMENT_PATTERNS: Array<[RegExp, TargetEnvironment]> = [
  [/^demo(\/.*)?$/i,          "demo"],
  [/^staging(\/.*)?$/i,       "staging"],
  [/^prod(uction)?(\/.*)?$/i, "production"],
  [/^release(\/.*)?$/i,       "release"],
  // NOTE: hotfix/* is intentionally omitted here — it's treated as a "feature"
  // branch so it diffs against the nearest integration branch (staging/main)
  // rather than being skipped as a long-lived environment branch.
];

/**
 * Classifies a branch by its semantic purpose.
 * Used to decide which base to diff against and how to frame prompt context.
 */
export function classifyBranch(branch: string): {
  branchClass: BranchClass;
  targetEnvironment: TargetEnvironment | null;
} {
  if (BASE_BRANCH_NAMES.has(branch)) {
    return { branchClass: "base", targetEnvironment: null };
  }
  for (const [pattern, env] of ENVIRONMENT_PATTERNS) {
    if (pattern.test(branch)) {
      return { branchClass: "environment", targetEnvironment: env };
    }
  }
  return { branchClass: "feature", targetEnvironment: null };
}

/**
 * Returns true if the given branch is a base/integration branch.
 */
export function isBaseBranch(branch: string): boolean {
  return BASE_BRANCH_NAMES.has(branch);
}

export interface BranchDiffContext {
  /** Current branch name */
  branch: string;
  /** Semantic classification of the current branch */
  branchClass: BranchClass;
  /** Target deployment environment (demo, staging, production…) — null for feature/base branches */
  targetEnvironment: TargetEnvironment | null;
  /** Base branch this branch diverged from */
  baseBranch: string;
  /**
   * Relative file paths changed on this branch vs base.
   * Empty when on a base branch or when git diff is unavailable.
   */
  changedFiles: string[];
  /** Number of commits ahead of base */
  commitsAhead: number;
  /**
   * Ticket IDs extracted from the branch name (e.g. ENG-756 from feature/ENG-756-remote-auth).
   * Empty array when none found.
   */
  ticketIds: string[];
}

/**
 * Builds branch-aware diff context for non-base branches.
 * Used to inject "what changed on this branch" into doc prompts so the
 * generated docs reflect `demo/orlando` or `feature/billing-v2`, not main.
 *
 * Returns null when the repo is on a base branch (no extra context needed).
 */
export async function buildBranchDiffContext(
  repoAbsPath: string,
  currentBranch?: string,
): Promise<BranchDiffContext | null> {
  const branch = currentBranch ?? await getCurrentBranch(repoAbsPath);
  const { branchClass, targetEnvironment } = classifyBranch(branch);

  if (branchClass === "base") return null;

  // ---------------------------------------------------------------------------
  // Determine the right base branch to diff against, by class:
  //
  //  feature     → diff against the nearest environment or integration branch
  //                (tries staging, develop, main, master in order — skips self)
  //  environment → diff against the nearest integration branch
  //                (demo/orlando diffs against staging if it exists, else main)
  // ---------------------------------------------------------------------------
  // Both feature and environment branches diff against the nearest integration branch.
  const baseCandidates = ["staging", "develop", "main", "master"];

  let baseBranch = "main";
  for (const candidate of baseCandidates) {
    if (candidate === branch) continue; // don't diff a branch against itself
    try {
      await exec(`git -C "${repoAbsPath}" rev-parse --verify ${candidate}`, { maxBuffer: 512 });
      baseBranch = candidate;
      break;
    } catch {
      // candidate doesn't exist, try next
    }
  }

  // Extract ticket IDs from branch name (e.g. ENG-756, JIRA-123, BB-42)
  const ticketIds = [...branch.matchAll(/\b([A-Z]{2,}-\d+)\b/g)].map((m) => m[1]!);

  let changedFiles: string[] = [];
  let commitsAhead = 0;

  try {
    const diffResult = await exec(
      `git -C "${repoAbsPath}" diff --name-only "${baseBranch}...HEAD"`,
      { maxBuffer: 5 * 1024 * 1024 },
    );
    changedFiles = diffResult.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    // diff unavailable — diverged too far or base missing
  }

  try {
    const aheadResult = await exec(
      `git -C "${repoAbsPath}" rev-list --count "${baseBranch}..HEAD"`,
      { maxBuffer: 512 },
    );
    commitsAhead = parseInt(aheadResult.stdout.trim(), 10) || 0;
  } catch {
    // ignore
  }

  return { branch, branchClass, targetEnvironment, baseBranch, changedFiles, commitsAhead, ticketIds };
}

/**
 * Returns the normalized heat for a file path (relative to repoPath).
 * Returns 0 if the file has never been committed in the thermal window.
 */
export function getFileHeat(filePath: string, thermalMap: Map<string, number>): number {
  // thermalMap keys are relative paths; try both with and without leading ./
  return (
    thermalMap.get(filePath) ??
    thermalMap.get(filePath.replace(/^\.\//, "")) ??
    0
  );
}

/**
 * Returns true if the file's first path segment matches any stale directory.
 */
export function isInStaleDir(filePath: string, staleDirectories: Set<string>): boolean {
  const topLevel = filePath.split("/")[0] ?? "";
  return staleDirectories.has(topLevel);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function detectStaleFromThermal(
  thermalMap: Map<string, number>,
  repoAbsPath: string,
): Set<string> {
  const stale = new Set<string>();

  // Collect all top-level directory names in the repo (excluding .git)
  let topDirs: string[] = [];
  try {
    topDirs = readdirSync(repoAbsPath)
      .filter((entry) => {
        if (entry.startsWith(".")) return false;
        try {
          return statSync(join(repoAbsPath, entry)).isDirectory();
        } catch {
          return false;
        }
      });
  } catch {
    return stale;
  }

  // Build a set of top-level directory prefixes that appear in the thermal map
  const hotPrefixes = new Set<string>();
  for (const filePath of thermalMap.keys()) {
    const topLevel = filePath.split("/")[0];
    if (topLevel) hotPrefixes.add(topLevel);
  }

  for (const dir of topDirs) {
    if (!hotPrefixes.has(dir)) {
      stale.add(dir);
    }
  }

  return stale;
}
