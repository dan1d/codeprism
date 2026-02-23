#!/usr/bin/env node
/**
 * srcmap CLI entrypoint
 *
 * Usage:
 *   pnpm srcmap index              — index all repos (auto model, auto quality, auto scope)
 *   pnpm srcmap index --force      — reindex everything regardless of git changes
 *   pnpm srcmap index --repo <n>   — restrict to a single repo (development use)
 *   pnpm srcmap import-transcripts — extract insights from AI conversation transcripts
 */

import { Command } from "commander";
import { resolve } from "node:path";
import { userWorkspaceRootFrom } from "../utils/workspace.js";
import { loadWorkspaceConfig } from "../config/workspace-config.js";

const program = new Command("srcmap");
program.version("0.1.0");

// ---------------------------------------------------------------------------
// srcmap index
// ---------------------------------------------------------------------------

program
  .command("index")
  .description("Index repositories — model, quality, and scope chosen automatically")
  .option("--force", "reindex all repos regardless of git changes", false)
  .option("--repo <name>", "restrict to a single repo (development use)")
  .option("--branch <name>", "treat all repos as being on this branch (overrides git detection)")
  .option(
    "--ticket <id>",
    "ticket ID or URL being worked on (e.g. ENG-756 or https://linear.app/.../ENG-756/...); " +
    "biases file selection and doc prompts toward the ticket domain"
  )
  .option("--ticket-desc <text>", "short description of the ticket (injected into prompts)")
  .option("--skip-docs", "skip all doc generation (faster, uses existing docs)", false)
  .option("--force-docs", "force regeneration of all docs even if they exist", false)
  .option("--fetch-remote", "run git fetch --all on each repo before branch signal collection", false)
  .action(async (opts: {
    force: boolean;
    repo?: string;
    branch?: string;
    ticket?: string;
    ticketDesc?: string;
    skipDocs: boolean;
    forceDocs: boolean;
    fetchRemote: boolean;
  }) => {
    const workspaceRoot = userWorkspaceRootFrom(import.meta.url);
    const config = loadWorkspaceConfig(workspaceRoot);

    console.log(`[srcmap] Workspace: ${config.workspaceRoot} (${config.source} config, ${config.repos.length} repos)`);

    // Parse ticket ID from URL or raw ID
    let ticketId: string | undefined;
    if (opts.ticket) {
      const match = opts.ticket.match(/\b([A-Z]{2,}-\d+)\b/);
      ticketId = match ? match[1] : opts.ticket.toUpperCase();
    }

    const allRepos = config.repos.map((r) => ({ name: r.name, path: r.path }));

    const repos = opts.repo
      ? allRepos.filter((r) => r.name === opts.repo)
      : allRepos;

    if (opts.repo && repos.length === 0) {
      console.error(`[srcmap] Unknown repo "${opts.repo}". Known: ${allRepos.map((r) => r.name).join(", ")}`);
      process.exit(1);
    }

    if (ticketId) {
      console.log(`[srcmap] Ticket context: ${ticketId}${opts.ticketDesc ? ` — ${opts.ticketDesc}` : ""}`);
    }

    const { indexRepos } = await import("./index-repos.js");
    await indexRepos(repos, workspaceRoot, {
      force: opts.force,
      branchOverride: opts.branch,
      ticketId,
      ticketDescription: opts.ticketDesc,
      skipDocs: opts.skipDocs,
      forceDocs: opts.forceDocs,
      fetchRemote: opts.fetchRemote,
    });
  });

// ---------------------------------------------------------------------------
// srcmap import-transcripts
// ---------------------------------------------------------------------------

program
  .command("import-transcripts")
  .description("Extract team knowledge from AI conversation transcripts")
  .option("--dry-run", "parse and extract but do not write to DB", false)
  .option("--force", "re-extract from already-imported transcripts", false)
  .action(async (opts: { dryRun: boolean; force: boolean }) => {
    const { importTranscripts } = await import("./import-transcripts.js");
    await importTranscripts(opts);
  });

// ---------------------------------------------------------------------------
// srcmap generate-skills
// ---------------------------------------------------------------------------

program
  .command("generate-skills")
  .description(
    "Generate skill knowledge/*.md files using an LLM. " +
    "Built-in skills go to src/skills/knowledge/ (requires review before committing). " +
    "Use --output-dir for community/team-specific knowledge outside the engine package."
  )
  .option("--skill <id>", "generate only for a specific skill ID (e.g. rails, react, myframework)")
  .option("--force", "overwrite existing knowledge/*.md files", false)
  .option(
    "--output-dir <path>",
    "custom output directory (community use: ~/.srcmap/knowledge/ or <workspace>/.srcmap/knowledge/)"
  )
  .action(async (opts: { skill?: string; force: boolean; outputDir?: string }) => {
    const { generateSkillKnowledge } = await import("./generate-skills.js");
    await generateSkillKnowledge({ skillFilter: opts.skill, force: opts.force, outputDir: opts.outputDir });
  });

// ---------------------------------------------------------------------------
// srcmap check
// ---------------------------------------------------------------------------

program
  .command("check")
  .description(
    "Check staged/uncommitted changes (or a branch diff) against team rules. " +
    "Exits 0 if all error-severity rules pass, 1 if any error-severity violations are found. " +
    "Designed to run as a pre-push git hook or in CI."
  )
  .option("--base <branch>", "base branch to diff against", "main")
  .option("--repo <name>", "repository name override (default: inferred from git remote)")
  .option("--strict", "exit 1 on any violation including warnings", false)
  .option("--json", "output machine-readable JSON", false)
  .option("--triggered-by <who>", "label for the check origin (e.g. pre-push, ci, manual)")
  .action(async (opts: { base: string; repo?: string; strict: boolean; json: boolean; triggeredBy?: string }) => {
    const { runCheckCli } = await import("./check.js");
    await runCheckCli(process.cwd(), {
      base: opts.base,
      repo: opts.repo,
      strict: opts.strict,
      json: opts.json,
      triggeredBy: opts.triggeredBy,
    });
  });

// ---------------------------------------------------------------------------
// srcmap rules list / add / delete
// ---------------------------------------------------------------------------

const rulesCmd = program
  .command("rules")
  .description("Manage team coding rules (list, add, toggle, delete)");

rulesCmd
  .command("list")
  .description("List all team rules")
  .action(async () => {
    const { listRules } = await import("./rules.js");
    await listRules();
  });

rulesCmd
  .command("add")
  .description("Add a new rule")
  .option("--name <n>", "rule name")
  .option("--desc <d>", "rule description")
  .option("--severity <s>", "error | warning | info", "warning")
  .option("--scope <s>", "limit to a framework (rails, react, …)")
  .option("--by <who>", "created by (team member name)")
  .action(async (opts: { name?: string; desc?: string; severity?: string; scope?: string; by?: string }) => {
    const { addRule } = await import("./rules.js");
    await addRule(opts);
  });

rulesCmd
  .command("delete")
  .description("Delete a rule by ID")
  .argument("<id>", "rule ID")
  .action(async (id: string) => {
    const { deleteRule } = await import("./rules.js");
    await deleteRule(id);
  });

// ---------------------------------------------------------------------------
// srcmap install-hook
// ---------------------------------------------------------------------------

program
  .command("install-hook")
  .description(
    "Install a git pre-push hook in the current repository that runs `srcmap check` before every push. " +
    "Exits 1 and blocks the push if any error-severity rules are violated."
  )
  .option("--base <branch>", "base branch to diff against in the hook", "main")
  .option("--strict", "block on warnings too", false)
  .action(async (opts: { base: string; strict: boolean }) => {
    const { installHook } = await import("./install-hook.js");
    await installHook(process.cwd(), opts);
  });

program.parse(process.argv);
