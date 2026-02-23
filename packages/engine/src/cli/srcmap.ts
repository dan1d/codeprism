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

    // Parse ticket ID from URL or raw ID
    let ticketId: string | undefined;
    if (opts.ticket) {
      // Extract ID from URL like https://linear.app/gobiobridge/issue/ENG-756/ability-to-add-...
      const match = opts.ticket.match(/\b([A-Z]{2,}-\d+)\b/);
      ticketId = match ? match[1] : opts.ticket.toUpperCase();
    }

    // Repos are inferred from the workspace root
    const { resolve: noderesolve } = await import("node:path");
    const allRepos = [
      { name: "biobridge-backend",   path: noderesolve(workspaceRoot, "biobridge-backend") },
      { name: "biobridge-frontend",  path: noderesolve(workspaceRoot, "biobridge-frontend") },
      { name: "bp-monitor-api",      path: noderesolve(workspaceRoot, "bp-monitor-api") },
      { name: "bp-monitor-frontend", path: noderesolve(workspaceRoot, "bp-monitor-frontend") },
    ];

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

program.parse(process.argv);
