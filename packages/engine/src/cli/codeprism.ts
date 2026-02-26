#!/usr/bin/env node
/**
 * codeprism CLI entrypoint
 *
 * Usage:
 *   pnpm codeprism index              — index all repos (auto model, auto quality, auto scope)
 *   pnpm codeprism index --force      — reindex everything regardless of git changes
 *   pnpm codeprism index --repo <n>   — restrict to a single repo (development use)
 *   pnpm codeprism import-transcripts — extract insights from AI conversation transcripts
 */
/* eslint-disable no-console */

import { Command } from "commander";
import { resolve } from "node:path";
import { userWorkspaceRootFrom } from "../utils/workspace.js";
import { loadWorkspaceConfig } from "../config/workspace-config.js";

const program = new Command("codeprism");
program.version("0.1.0");

// ---------------------------------------------------------------------------
// codeprism index
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
    "biases file selection and doc prompts toward the ticket domain",
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

    console.log(
      `[codeprism] Workspace: ${config.workspaceRoot} (${config.source} config, ${config.repos.length} repos)`,
    );

    // Parse ticket ID from URL or raw ID
    let ticketId: string | undefined;
    if (opts.ticket) {
      const match = opts.ticket.match(/\b([A-Z]{2,}-\d+)\b/);
      ticketId = match ? match[1] : opts.ticket.toUpperCase();
    }

    if (ticketId) {
      console.log(`[codeprism] Ticket context: ${ticketId}${opts.ticketDesc ? ` — ${opts.ticketDesc}` : ""}`);
    }

    const { runIndex } = await import("./index-repos.js");

    const repoName = opts.repo;
    if (repoName) {
      const allRepos = config.repos;
      const repo = allRepos.find((r) => r.name === repoName);
      if (!repo) {
        console.error(
          `[codeprism] Unknown repo "${repoName}". Known: ${allRepos.map((r) => r.name).join(", ")}`,
        );
        process.exit(1);
      }
      await runIndex(config.workspaceRoot, repo.name, resolve(repo.path), {
        force: opts.force,
        branch: opts.branch,
        ticketId,
        ticketDesc: opts.ticketDesc,
        skipDocs: opts.skipDocs,
        forceDocs: opts.forceDocs,
        fetchRemote: opts.fetchRemote,
      });
      return;
    }

    for (const repo of config.repos) {
      await runIndex(config.workspaceRoot, repo.name, resolve(repo.path), {
        force: opts.force,
        branch: opts.branch,
        ticketId,
        ticketDesc: opts.ticketDesc,
        skipDocs: opts.skipDocs,
        forceDocs: opts.forceDocs,
        fetchRemote: opts.fetchRemote,
      });
    }
  });

// ---------------------------------------------------------------------------
// codeprism import-transcripts
// ---------------------------------------------------------------------------

program
  .command("import-transcripts")
  .description("Import AI assistant transcripts into team memory cards")
  .option("--dry-run", "only print what would be imported", false)
  .action(async (opts: { dryRun: boolean }) => {
    const { importTranscripts } = await import("./import-transcripts.js");
    await importTranscripts(process.cwd(), { dryRun: opts.dryRun });
  });

// ---------------------------------------------------------------------------
// codeprism generate-skills
// ---------------------------------------------------------------------------

program
  .command("generate-skills")
  .description("Generate knowledge skill markdown files (LLM-assisted)")
  .option("--skill <id>", "limit generation to a single skill ID")
  .option("--force", "overwrite existing files", false)
  .option(
    "--output-dir <dir>",
    "custom output directory (community use: ~/.codeprism/knowledge/ or <workspace>/.codeprism/knowledge/)",
  )
  .action(async (opts: { skill?: string; force: boolean; outputDir?: string }) => {
    const { generateSkills } = await import("./generate-skills.js");
    await generateSkills({ skill: opts.skill, force: opts.force, outputDir: opts.outputDir });
  });

// ---------------------------------------------------------------------------
// codeprism check
// ---------------------------------------------------------------------------

program
  .command("check")
  .description("LLM-powered diff checker (rules) for PRs")
  .option("--base <branch>", "base branch to diff against", "main")
  .option("--repo <name>", "override repo name in report")
  .option("--strict", "exit 1 on any violation (incl. warnings)", false)
  .option("--json", "machine-readable JSON output", false)
  .action(async (opts: { base: string; repo?: string; strict: boolean; json: boolean }) => {
    const { runCheck } = await import("./check.js");
    await runCheck(process.cwd(), opts);
  });

// ---------------------------------------------------------------------------
// codeprism rules list / add / delete
// ---------------------------------------------------------------------------

program
  .command("rules")
  .description("Manage rules stored in the engine database")
  .argument("<action>", "list | add | delete")
  .argument("[rule]", "rule text (for add)")
  .option("--repo <name>", "repo name (defaults to current dir name)")
  .action(async (action: string, rule: string | undefined, opts: { repo?: string }) => {
    const { runRules } = await import("./rules.js");
    await runRules(process.cwd(), { action, rule, repo: opts.repo });
  });

// ---------------------------------------------------------------------------
// codeprism sync
// ---------------------------------------------------------------------------

program
  .command("sync")
  .description(
    "Notify the running codeprism server about git changes (post-merge / post-pull). " +
    "Never blocks — exits 0 if server is unreachable.",
  )
  .option("--repo <name>", "repo name (defaults to current dir name)")
  .option("--port <n>", "codeprism server port (default: CODEPRISM_PORT env or 4000)", parseInt)
  .option("--event-type <t>", "save|merge|pull|rebase|checkout")
  .option("--prev-head <sha>", "previous HEAD SHA (for checkout/rewrite)")
  .option("--dry-run", "show what would be sent without contacting the server", false)
  .action(async (opts: { repo?: string; port?: number; eventType?: string; prevHead?: string; dryRun: boolean }) => {
    const { runSync } = await import("./sync.js");
    await runSync(process.cwd(), {
      repo: opts.repo,
      port: opts.port,
      eventType: opts.eventType as "save" | "merge" | "pull" | "rebase" | "checkout" | undefined,
      prevHead: opts.prevHead,
      dryRun: opts.dryRun,
    });
  });

// ---------------------------------------------------------------------------
// codeprism install-hook
// ---------------------------------------------------------------------------

program
  .command("install-hook")
  .description(
    "Install git hooks (post-commit, post-merge, post-checkout, post-rewrite) in the current repository. " +
    "These hooks post changed files to the codeprism engine to keep cards fresh automatically.",
  )
  .option("--base <branch>", "base branch to diff against in the pre-push hook", "main")
  .option("--strict", "block push on warnings too", false)
  .option("--engine-url <url>", "codeprism engine base URL (default: http://localhost:4000)")
  .action(async (opts: { base: string; strict: boolean; engineUrl?: string }) => {
    const { installHook } = await import("./install-hook.js");
    await installHook(process.cwd(), opts);
  });

program.parse(process.argv);

