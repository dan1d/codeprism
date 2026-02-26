#!/usr/bin/env node
/**
 * srcmap check — LLM-powered PR rule checker.
 *
 * Core logic lives in `runCheckCore` which returns structured data.
 * The `runCheckCli` wrapper handles stdout formatting and process.exit for CLI use.
 * The HTTP API calls `runCheckCore` directly — no stdout capture, no process.exit.
 *
 * CLI usage:
 *   srcmap check                      # diff HEAD vs main
 *   srcmap check --base develop       # diff HEAD vs develop
 *   srcmap check --repo biobridge-fe  # override repo name in report
 *   srcmap check --strict             # exit 1 on any violation (incl. warnings)
 *   srcmap check --json               # machine-readable output
 */

import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { getDb } from "../db/connection.js";
import { createLLMProvider } from "../llm/provider.js";
import type { TeamRule, RuleViolation, RuleCheckResult } from "../db/schema.js";

export interface CheckOptions {
  base: string;
  repo?: string;
  strict: boolean;
  triggeredBy?: string;
}

export interface CheckCoreResult extends RuleCheckResult {
  check_id: string;
  branch: string;
  repo: string;
  commit_sha: string;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Git helpers — all with a 10 s timeout so they can never hang the event loop
// ---------------------------------------------------------------------------

function git(cmd: string, cwd: string): string {
  try {
    return execSync(`git ${cmd}`, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10_000,
    }).trim();
  } catch {
    return "";
  }
}

function getDiff(cwd: string, base: string): string {
  let diff = git(`diff ${base}...HEAD -- ":(exclude)*.lock" ":(exclude)yarn.lock" ":(exclude)package-lock.json"`, cwd);
  if (!diff) diff = git("diff HEAD~1 HEAD", cwd);
  return diff.slice(0, 15_000);
}

function getCommitSha(cwd: string): string { return git("rev-parse --short HEAD", cwd); }
function getCurrentBranch(cwd: string): string { return git("rev-parse --abbrev-ref HEAD", cwd); }

function getRepoName(cwd: string): string {
  const remote = git("remote get-url origin", cwd);
  if (remote) {
    const m = remote.match(/([^/]+?)(?:\.git)?$/);
    if (m) return m[1]!;
  }
  return cwd.split("/").pop() ?? "unknown";
}

// ---------------------------------------------------------------------------
// Scope filtering — match rule scope against diff file extensions
// ---------------------------------------------------------------------------

const SCOPE_EXTENSIONS: Record<string, string[]> = {
  rails:   [".rb", ".erb", ".rake"],
  react:   [".tsx", ".jsx", ".ts", ".js"],
  vue:     [".vue", ".ts", ".js"],
  go:      [".go"],
  python:  [".py"],
  django:  [".py"],
  nextjs:  [".tsx", ".ts", ".jsx", ".js"],
  angular: [".ts", ".html"],
  laravel: [".php"],
  spring:  [".java", ".kt"],
};

function rulesForDiff(rules: TeamRule[], diffFiles: string[]): TeamRule[] {
  return rules.filter((rule) => {
    if (!rule.scope) return true; // null scope = applies to everything
    const exts = SCOPE_EXTENSIONS[rule.scope.toLowerCase()] ?? [];
    if (exts.length === 0) return true; // unknown scope — include rather than silently drop
    return diffFiles.some((f) => exts.some((ext) => f.endsWith(ext)));
  });
}

// ---------------------------------------------------------------------------
// LLM check
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `
You are a code review bot. You receive:
1. A list of team rules (name, description, severity).
2. A git diff of code changes.

Your job: identify specific violations of the listed rules in the diff.

Output ONLY a JSON array of violation objects. If no violations, return [].
Each object must have EXACTLY these fields:
{
  "rule_id":    "<id from the rule list>",
  "rule_name":  "<name from the rule list>",
  "severity":   "<error|warning|info>",
  "file":       "<file path from the diff, or 'unknown'>",
  "line":       <line number as integer, or null>,
  "snippet":    "<the offending code snippet, max 120 chars>",
  "explanation": "<why this violates the rule, max 160 chars>"
}

Be precise. Only flag actual violations visible in the diff hunks (lines starting with +).
Do not flag lines being removed (-). Do not invent violations.
`.trim();

async function checkWithLLM(
  rules: TeamRule[],
  diff: string,
  llm: ReturnType<typeof createLLMProvider>,
): Promise<RuleViolation[]> {
  if (!llm) throw new Error("No LLM configured. Set CODEPRISM_LLM_PROVIDER + CODEPRISM_LLM_API_KEY.");
  if (!diff.trim()) return [];

  const ruleList = rules
    .map((r) => `- ID: ${r.id}\n  Name: ${r.name}\n  Rule: ${r.description}\n  Severity: ${r.severity}${r.scope ? `\n  Scope: ${r.scope}` : ""}`)
    .join("\n\n");

  const prompt = `## Team Rules\n\n${ruleList}\n\n## Git Diff\n\n\`\`\`diff\n${diff}\n\`\`\`\n\nReturn a JSON array of violations only. No markdown, no explanation outside JSON.`;
  const raw = await llm.generate(prompt, { systemPrompt: SYSTEM_PROMPT, maxTokens: 2000 });

  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as RuleViolation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Core — returns structured data, NO stdout writes, NO process.exit, NO closeDb
// Called by both the CLI wrapper and the HTTP API handler.
// ---------------------------------------------------------------------------

export async function runCheckCore(cwd: string, opts: CheckOptions): Promise<CheckCoreResult> {
  const db = getDb();
  const allRules = db.prepare("SELECT * FROM team_rules WHERE enabled = 1").all() as TeamRule[];

  const branch    = getCurrentBranch(cwd);
  const repoName  = opts.repo ?? getRepoName(cwd);
  const commitSha = getCommitSha(cwd);
  const diff      = getDiff(cwd, opts.base);

  const filesChanged = [...new Set(
    (diff.match(/^diff --git a\/.+ b\/(.+)$/gm) ?? [])
      .map((l) => l.replace(/^diff --git a\/.+ b\//, "")),
  )];

  // Filter rules by scope before sending to LLM
  const applicableRules = rulesForDiff(allRules, filesChanged);

  let violations: RuleViolation[] = [];
  let error: string | null = null;

  if (applicableRules.length > 0) {
    const llm = createLLMProvider();
    try {
      violations = await checkWithLLM(applicableRules, diff, llm);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  const passed =
    violations.filter((v) => v.severity === "error").length === 0 &&
    (!opts.strict || violations.length === 0);

  const checkId = `chk_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  db.prepare(`
    INSERT INTO rule_checks (id, repo, branch, base_branch, commit_sha, violations, checked_rules, files_checked, passed, triggered_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    checkId, repoName, branch, opts.base, commitSha,
    JSON.stringify(violations),
    applicableRules.length, filesChanged.length,
    passed ? 1 : 0,
    opts.triggeredBy ?? "cli",
  );

  return {
    check_id: checkId,
    branch,
    repo: repoName,
    commit_sha: commitSha,
    violations,
    checked_rules: applicableRules.length,
    files_checked: filesChanged.length,
    passed,
    error,
  };
}

// ---------------------------------------------------------------------------
// CLI wrapper — formats output and calls process.exit.
// ONLY called by the `srcmap check` CLI command, never by the HTTP API.
// ---------------------------------------------------------------------------

export async function runCheckCli(cwd: string, opts: CheckOptions & { json: boolean }): Promise<void> {
  const allRules = getDb().prepare("SELECT * FROM team_rules WHERE enabled = 1").all() as TeamRule[];

  if (allRules.length === 0) {
    console.log("srcmap check: No active rules defined. Add rules via the dashboard or `srcmap rules add`.");
    return;
  }

  if (!opts.json) {
    const repoName = opts.repo ?? getRepoName(cwd);
    const branch   = getCurrentBranch(cwd);
    console.log(`\nsrcmap check · ${repoName} · ${branch} vs ${opts.base}`);
    console.log(`Checking ${allRules.length} rule${allRules.length !== 1 ? "s" : ""}…\n`);
  }

  const result = await runCheckCore(cwd, opts);

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.passed ? 0 : 1);
  }

  if (result.error) {
    console.error(`  ✗ LLM error: ${result.error}\n`);
    return; // don't block push on LLM failures
  }

  if (result.violations.length === 0) {
    console.log(`  ✓ All rules passed (${result.files_checked} file${result.files_checked !== 1 ? "s" : ""} checked)\n`);
    return;
  }

  const byFile = new Map<string, RuleViolation[]>();
  for (const v of result.violations) {
    const list = byFile.get(v.file) ?? [];
    list.push(v);
    byFile.set(v.file, list);
  }

  const ICON:  Record<string, string> = { error: "✗", warning: "⚠", info: "ℹ" };
  const LABEL: Record<string, string> = { error: "ERROR", warning: "WARN ", info: "INFO " };

  for (const [file, vs] of byFile) {
    console.log(`  ${file}`);
    for (const v of vs) {
      const location = v.line ? `:${v.line}` : "";
      console.log(`    ${ICON[v.severity] ?? "·"} [${LABEL[v.severity] ?? "     "}] ${v.rule_name}${location}`);
      console.log(`      ${v.explanation}`);
      if (v.snippet) console.log(`      \`${v.snippet.slice(0, 100)}\``);
    }
    console.log();
  }

  const errorCount = result.violations.filter((v) => v.severity === "error").length;
  const warnCount  = result.violations.filter((v) => v.severity === "warning").length;
  const parts: string[] = [];
  if (errorCount) parts.push(`${errorCount} error${errorCount !== 1 ? "s" : ""}`);
  if (warnCount)  parts.push(`${warnCount} warning${warnCount !== 1 ? "s" : ""}`);

  if (result.passed) {
    console.log(`  ⚠  ${parts.join(", ")} (non-blocking)\n`);
  } else {
    console.log(`  ✗  ${parts.join(", ")} — PR blocked by rule violations\n`);
    process.exit(1);
  }
}
