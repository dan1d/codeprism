import { resolve, join } from "node:path";
import { userWorkspaceRootFrom } from "../utils/workspace.js";
import { execSync } from "node:child_process";
import { getDb, closeDb } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";
import { registry } from "../indexer/tree-sitter.js";
import { buildGraph } from "../indexer/graph-builder.js";
import { detectFlows } from "../indexer/flow-detector.js";
import { extractSeedFlows } from "../indexer/route-extractor.js";
import { generateCards } from "../indexer/card-generator.js";
import {
  generateProjectDocs,
  loadProjectContext,
  generateWorkspaceSpecialist,
  discoverFrontendPages,
  discoverBeOverview,
  setWorkspaceRoot as setDocWorkspaceRoot,
  seedFromReadme,
  generateBusinessDoc,
  generateProductDoc,
  generateCrossRepoDoc,
} from "../indexer/doc-generator.js";
import { getEmbedder } from "../embeddings/local-embedder.js";
import { createLLMProvider } from "../llm/provider.js";
import { computeSpecificity } from "../search/specificity.js";
import { generateAndSaveAllRepoSignals } from "../search/repo-signals.js";
import { loadRepoConfig } from "../indexer/repo-config.js";
import { loadIgnoreConfig } from "../config/ignore.js";
import { buildGitSignals, buildWorkspaceBranchSignal, type BranchDiffContext } from "../indexer/git-signals.js";
import type { BranchContext } from "../indexer/doc-prompts.js";
import { writeDocsToFilesystem, type DocToWrite } from "../indexer/doc-writer.js";
import type { ParsedFile } from "../indexer/types.js";

export interface IndexOptions {
  /** Reindex all repos regardless of git changes */
  force?: boolean;
  /** Restrict to a single repo by name */
  repo?: string | null;
  /** Override detected branch for all repos (e.g. "demo/orlando") */
  branchOverride?: string;
  /** Ticket ID being worked on (e.g. "ENG-756") — stored in search_config + injected into prompts */
  ticketId?: string;
  /** Short description of the ticket, injected into branch context prompts */
  ticketDescription?: string;
  /** Skip all doc generation (equivalent to --skip-docs flag) */
  skipDocs?: boolean;
  /** Force regeneration of all docs even if they already exist */
  forceDocs?: boolean;
  /**
   * Run `git fetch --all` on each repo before branch signal collection.
   * Disabled by default to avoid surprising network I/O — pass `--fetch-remote`
   * on the CLI or set this to true when you need up-to-date remote branch data.
   */
  fetchRemote?: boolean;
}

/** Returns the HEAD commit SHA for a given repo directory, or null if git is unavailable. */
function getHeadSha(repoPath: string): string | null {
  try {
    return execSync("git rev-parse HEAD", { cwd: repoPath, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

interface RepoConfig {
  name: string;
  path: string;
}

/**
 * Strip the workspace root prefix from an absolute path so only the
 * repo-relative portion is stored in the DB.
 * e.g. "/Users/r1/biobridge/biobridge-backend/app/models/user.rb"
 *   →  "biobridge-backend/app/models/user.rb"
 */
function relativizePath(absPath: string, root: string): string {
  if (!root) return absPath;
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return absPath.startsWith(prefix) ? absPath.slice(prefix.length) : absPath;
}

export async function indexRepos(repos: RepoConfig[], workspaceRoot: string, opts: IndexOptions = {}): Promise<void> {
  const { ticketId, ticketDescription } = opts;
  const skipDocs = opts.skipDocs ?? false;
  const forceDocs = opts.forceDocs ?? false;
  const db = getDb();
  runMigrations(db);

  // Purge expired conv_insight cards (expires_at is set at insert time, 90-day TTL)
  const purged = db
    .prepare(`DELETE FROM cards WHERE expires_at IS NOT NULL AND expires_at < ?`)
    .run(new Date().toISOString());
  if (purged.changes > 0) {
    console.log(`Purged ${purged.changes} expired conv_insight card(s)`);
  }

  // Persist workspace root so other modules (invalidator, API) can resolve absolute paths
  db.prepare(
    `INSERT OR REPLACE INTO search_config (key, value) VALUES ('workspace_root', ?)`
  ).run(workspaceRoot);

  // Tell doc-generator about the workspace root so it can store relative paths too
  setDocWorkspaceRoot(workspaceRoot);

  const llm = createLLMProvider();
  if (llm) {
    const provider = process.env["CODEPRISM_LLM_PROVIDER"] ?? "anthropic";
    console.log(`LLM: ${llm.model} (provider: ${provider})`);
    if (provider === "gemini") {
      console.log(`     Free tier: 15 RPM / 1M tokens/day — throttled to ~14 RPM`);
      console.log(`     Get a free key at https://ai.google.dev/`);
    } else if (provider === "deepseek") {
      console.log(`     DeepSeek-V3: ~$0.14/1M input tokens, ~$0.28/1M output tokens`);
      console.log(`     Get a key at https://platform.deepseek.com/`);
    }
  } else {
    console.log(`LLM: disabled — using structural cards`);
    console.log(`     Tip: set CODEPRISM_LLM_PROVIDER=deepseek and CODEPRISM_LLM_API_KEY for richer cards`);
  }

  console.log(`\n=== codeprism indexer ===\n`);
  console.log(`Repos to index: ${repos.map((r) => r.name).join(", ")}\n`);

  const allParsed: ParsedFile[] = [];
  const commitShaByRepo = new Map<string, string>();

  // =========================================================================
  // Phase 0 — Intelligence Gathering (no LLM except README inference)
  // =========================================================================
  console.log(`\n=== Phase 0: Intelligence Gathering ===\n`);

  // 0a. Read existing READMEs (raw fs, zero cost)
  const readmeSeedByRepo = new Map<string, string>();
  for (const repo of repos) {
    const seed = await seedFromReadme(resolve(repo.path));
    if (seed) readmeSeedByRepo.set(repo.name, seed);
  }
  console.log(`  READMEs read: ${readmeSeedByRepo.size}/${repos.length}`);

  // 0b. Workspace-level branch signal (all repos in parallel) → epic detection + remote branch fetch
  console.log(`  Building workspace branch signal...`);
  const workspaceBranchSignal = await buildWorkspaceBranchSignal(
    repos.map((r) => ({ name: r.name, absPath: resolve(r.path) })),
    { ticketId, branchOverride: undefined, fetchRemote: opts.fetchRemote ?? false },
  );

  if (workspaceBranchSignal.epicBranch) {
    const envLabel = workspaceBranchSignal.epicTargetEnvironment
      ? ` [${workspaceBranchSignal.epicTargetEnvironment.toUpperCase()}]`
      : "";
    console.log(`  Epic branch: ${workspaceBranchSignal.epicBranch}${envLabel}`);
    console.log(`    On epic:   ${workspaceBranchSignal.epicRepos.join(", ") || "none"}`);
    if (workspaceBranchSignal.behindRepos.length > 0) {
      console.log(`    Behind:    ${workspaceBranchSignal.behindRepos.join(", ")} (still on base)`);
    }
  }
  if (workspaceBranchSignal.allTicketIds.length > 0) {
    console.log(`  Tickets:  ${workspaceBranchSignal.allTicketIds.join(", ")}`);
  }

  // 0c. Per-repo thermal map (git log pass) + build per-repo BranchContext with cross-repo awareness
  const gitSignalsByRepo = new Map<string, Awaited<ReturnType<typeof buildGitSignals>>>();
  const branchContextByRepo = new Map<string, BranchContext>();

  for (const repo of repos) {
    const signals = await buildGitSignals(resolve(repo.path));
    gitSignalsByRepo.set(repo.name, signals);
    const hotFiles = [...signals.thermalMap.values()].filter((h) => h > 0.6).length;
    const branchLabel = signals.branchDiff
      ? `${signals.branch} (+${signals.branchDiff.commitsAhead} vs ${signals.branchDiff.baseBranch}, ${signals.branchDiff.changedFiles.length} changed files)`
      : signals.branch;
    console.log(`  [${repo.name}] branch: ${branchLabel} | ${signals.thermalMap.size} files in thermal window, ${hotFiles} hot, ${signals.staleDirectories.size} stale dirs`);

    // Build cross-repo siblings: other repos on the same epic branch (excluding self)
    const crossRepoBranches = workspaceBranchSignal.epicRepos
      .filter((r) => r !== repo.name)
      .map((siblingName) => {
        const remote = workspaceBranchSignal.remoteBranches.get(siblingName);
        const siblingBranch = workspaceBranchSignal.repoBranches.find((b) => b.repo === siblingName);
        return {
          repo: siblingName,
          branch: siblingBranch?.branch ?? workspaceBranchSignal.epicBranch ?? "unknown",
          changedFiles: remote?.changedFiles ?? [],
          recentCommits: remote?.recentCommits ?? [],
        };
      })
      .filter((s) => s.changedFiles.length > 0 || s.recentCommits.length > 0);

    const mergedTicketIds = [
      ...new Set([
        ...(ticketId ? [ticketId] : []),
        ...workspaceBranchSignal.allTicketIds,
        ...(signals.branchDiff?.ticketIds ?? []),
      ]),
    ];

    if (signals.branchDiff) {
      branchContextByRepo.set(repo.name, {
        ...signals.branchDiff,
        ticketIds: mergedTicketIds,
        ticketDescription,
        crossRepoBranches,
        behindRepos: workspaceBranchSignal.behindRepos,
      });
    } else if (ticketId || workspaceBranchSignal.epicBranch) {
      // Repo is on a base branch but workspace has an active epic — note it as "behind"
      branchContextByRepo.set(repo.name, {
        branch: signals.branch,
        branchClass: "base",
        targetEnvironment: null,
        baseBranch: signals.branch,
        changedFiles: [],
        commitsAhead: 0,
        ticketIds: mergedTicketIds,
        ticketDescription,
        crossRepoBranches,
        behindRepos: [], // this repo IS the behind one; siblings are in epicRepos
      });
    }
  }

  // Store last_indexed_at + ticket context in search_config
  db.prepare(`INSERT OR REPLACE INTO search_config (key, value) VALUES ('last_indexed_at', ?)`).run(new Date().toISOString());
  if (ticketId) {
    db.prepare(`INSERT OR REPLACE INTO search_config (key, value) VALUES ('current_ticket_id', ?)`).run(ticketId);
    if (ticketDescription) {
      db.prepare(`INSERT OR REPLACE INTO search_config (key, value) VALUES ('current_ticket_desc', ?)`).run(ticketDescription);
    }
    console.log(`  Ticket context stored: ${ticketId}`);
  }

  // Build a merged thermalMap keyed by **absolute** file path so lookups from
  // ParsedFile.path (absolute) and flow.files (absolute) both work without
  // namespace collisions across repos.
  const allThermalMap = new Map<string, number>();
  for (const repo of repos) {
    const repoAbsPath = resolve(repo.path);
    const signals = gitSignalsByRepo.get(repo.name);
    if (!signals) continue;
    for (const [repoRelPath, heat] of signals.thermalMap) {
      const absPath = join(repoAbsPath, repoRelPath);
      allThermalMap.set(absPath, Math.max(allThermalMap.get(absPath) ?? 0, heat));
    }
  }

  // Detect frameworks once across all repos before parsing
  const allRootPaths = repos.map((r) => resolve(r.path));
  const detectedFrameworks = await registry.detectFrameworks(allRootPaths);
  if (detectedFrameworks.length > 0) {
    console.log(`Detected frameworks: ${detectedFrameworks.join(", ")}`);
  }

  const ignoreConfig = loadIgnoreConfig(workspaceRoot);

  for (const repo of repos) {
    const absPath = resolve(repo.path);

    // Record HEAD SHA so cards can be stamped with the commit they came from
    const sha = getHeadSha(absPath);
    if (sha) {
      commitShaByRepo.set(repo.name, sha);
    } else {
      console.warn(`  [${repo.name}] Could not read HEAD SHA — cards won't have source_commit stamped (not a git repo?)`);
    }
    const repoConfig = loadRepoConfig(absPath);
    console.log(`Parsing ${repo.name} at ${absPath}...`);
    const parsed = await registry.parseDirectory(absPath, repo.name, repoConfig, ignoreConfig);

    // Log role breakdown per repo
    const roleCounts: Record<string, number> = {};
    for (const pf of parsed) {
      roleCounts[pf.fileRole] = (roleCounts[pf.fileRole] ?? 0) + 1;
    }
    const roleStr = Object.entries(roleCounts)
      .map(([r, c]) => `${r}: ${c}`)
      .join(", ");
    console.log(`  -> ${parsed.length} files parsed (${roleStr})`);
    allParsed.push(...parsed);
  }

  console.log(`\nTotal files parsed: ${allParsed.length}`);

  console.log(`\nBuilding dependency graph...`);
  const edges = buildGraph(allParsed);
  console.log(`  -> ${edges.length} edges found`);

  db.prepare("DELETE FROM graph_edges").run();
  const insertEdge = db.prepare(
    `INSERT INTO graph_edges (source_file, target_file, relation, metadata, repo)
     VALUES (?, ?, ?, ?, ?)`
  );
  const insertEdgeTx = db.transaction(() => {
    for (const edge of edges) {
      insertEdge.run(
        relativizePath(edge.sourceFile, workspaceRoot),
        relativizePath(edge.targetFile, workspaceRoot),
        edge.relation,
        JSON.stringify(edge.metadata),
        edge.repo
      );
    }
  });
  insertEdgeTx();

  // --- Early page / BE discovery (runs before flow detection) ---
  // Gives the LLM a chance to identify what pages/views exist in each repo
  // so route-extractor can use real page names instead of a hardcoded skip list.
  const discoveredPagesByRepo = new Map<string, string[]>();

  if (llm && !skipDocs) {
    console.log(`\nDiscovering pages and backend overview...`);
    for (const repo of repos) {
      const absPath = resolve(repo.path);
      const repoParsed = allParsed.filter((f) => f.repo === repo.name);
      const isFe =
        repo.name.includes("frontend") ||
        repo.name.endsWith("-fe") ||
        repo.name.endsWith("-ui") ||
        repoParsed.some((f) =>
          f.path.endsWith(".tsx") || f.path.endsWith(".jsx") || f.path.endsWith(".vue")
        );

      if (isFe) {
        const pageNames = await discoverFrontendPages(repo.name, absPath, repoParsed, llm);
        if (pageNames.length > 0) {
          discoveredPagesByRepo.set(repo.name, pageNames);
          console.log(`  [${repo.name}] ${pageNames.length} pages discovered`);
        }
      }
      // BE overview runs after all FE repos so it can receive FE pages context
    }

    // FE-first: BE overview anchored to FE pages
    const feRepoNamesForBe = repos
      .map((r) => r.name)
      .filter((n) => n.includes("frontend") || n.endsWith("-fe") || n.endsWith("-ui"));
    const fePagesContext = feRepoNamesForBe
      .flatMap((n) => discoveredPagesByRepo.get(n) ?? [])
      .slice(0, 20)
      .join(", ");

    for (const repo of repos) {
      const absPath = resolve(repo.path);
      const repoParsed = allParsed.filter((f) => f.repo === repo.name);
      const isFe =
        repo.name.includes("frontend") ||
        repo.name.endsWith("-fe") ||
        repo.name.endsWith("-ui") ||
        repoParsed.some((f) =>
          f.path.endsWith(".tsx") || f.path.endsWith(".jsx") || f.path.endsWith(".vue")
        );
      if (!isFe) {
        await discoverBeOverview(repo.name, absPath, repoParsed, llm, fePagesContext, branchContextByRepo.get(repo.name));
      }
    }
  }

  console.log(`\nDetecting flows...`);
  // Identify FE repos by name convention (contains "frontend" or "fe")
  const feRepoNames = repos
    .map((r) => r.name)
    .filter((n) => n.includes("frontend") || n.endsWith("-fe") || n.endsWith("-ui"));

  // Collect all discovered page names across FE repos for the seed extractor
  const allDiscoveredPages = feRepoNames.flatMap((n) => discoveredPagesByRepo.get(n) ?? []);
  const seedFlows = extractSeedFlows(allParsed, feRepoNames, allDiscoveredPages.length > 0 ? allDiscoveredPages : undefined, ignoreConfig);
  if (seedFlows.length > 0) {
    console.log(`  Seeded ${seedFlows.length} business flows from FE component directories`);
  }
  const flows = detectFlows(edges, allParsed, seedFlows);
  console.log(`  -> ${flows.length} flows detected:`);
  for (const flow of flows) {
    console.log(`     - ${flow.name} (${flow.files.length} files, ${flow.repos.join(", ")})`);
  }

  // --- Stack profiling (always runs, even without LLM) ---
  console.log(`\nDetecting stack profiles...`);
  const { detectStackProfile, saveRepoProfile } = await import("../indexer/stack-profiler.js");
  const skillLabelByRepo = new Map<string, string>();
  const stackProfileByRepo = new Map<string, Awaited<ReturnType<typeof detectStackProfile>>>();
  for (const repo of repos) {
    const absPath = resolve(repo.path);
    const profile = detectStackProfile(absPath);
    saveRepoProfile(repo.name, profile);
    stackProfileByRepo.set(repo.name, profile);
    const skillLabel = [profile.primaryLanguage, ...profile.frameworks].filter(Boolean).join(", ");
    skillLabelByRepo.set(repo.name, skillLabel);
    console.log(`  [${repo.name}] ${profile.primaryLanguage} / ${profile.frameworks.join(", ") || "no frameworks"}`);
  }

  // Pass 1: generate signals from stack profile + any previously-generated docs.
  // Runs even when LLM is disabled — deterministic signals are always useful.
  console.log(`\nGenerating repo signals (pass 1 — profile + existing docs)...`);
  generateAndSaveAllRepoSignals();

  // --- Project documentation (pre-indexing) ---
  const projectContextByRepo = new Map<string, string>();

  if (llm && !skipDocs) {
    console.log(`\nGenerating project documentation...`);
    if (forceDocs) console.log(`  (--force-docs: regenerating all docs)`);

    for (const repo of repos) {
      const absPath = resolve(repo.path);
      const repoParsed = allParsed.filter((f) => f.repo === repo.name);
      console.log(`  ${repo.name}: generating docs...`);

      const skillLabel = skillLabelByRepo.get(repo.name) ?? "";
      const stackProfile = stackProfileByRepo.get(repo.name);

      await generateProjectDocs(
        repo.name,
        absPath,
        repoParsed,
        llm,
        {
          skipExisting: !forceDocs,
          forceRegenerate: forceDocs,
          skillLabel,
          stackProfile,
          branchContext: branchContextByRepo.get(repo.name),
        },
      );

      const ctx = loadProjectContext(repo.name);
      if (ctx) {
        projectContextByRepo.set(repo.name, ctx);
        console.log(`  ${repo.name}: context ready (${ctx.split(/\s+/).length} words)`);
      }
    }
    console.log(`  -> ${projectContextByRepo.size} repos have project context`);

    // Generate workspace specialist once all per-repo docs are ready
    const allRepoNames = repos.map((r) => r.name);
    if (allRepoNames.length >= 2) {
      console.log("\n[workspace] Generating workspace specialist...");
      await generateWorkspaceSpecialist(allRepoNames, llm).catch((err: unknown) =>
        console.warn("[workspace] Specialist generation failed:", (err as Error).message),
      );
    }
    // Pass 2: re-generate signals now that fresh docs exist (cross-corpus IDF
    // will pick up domain terms from the newly written project_docs content).
    console.log(`\nEnriching repo signals (pass 2 — with domain terms from new docs)...`);
    generateAndSaveAllRepoSignals();
  } else if (skipDocs) {
    console.log(`\nSkipping doc generation (--skip-docs). Loading existing context...`);
    for (const repo of repos) {
      const ctx = loadProjectContext(repo.name);
      if (ctx) projectContextByRepo.set(repo.name, ctx);
    }
    console.log(`  -> ${projectContextByRepo.size} repos have existing context`);
  }

  // Phase 4 — Business docs (reads about + rules, runs after per-repo docs)
  if (llm && !skipDocs) {
    console.log(`\n[Phase 4] Generating business docs...`);
    for (const repo of repos) {
      await generateBusinessDoc(repo.name, llm, readmeSeedByRepo.get(repo.name) ?? "", { skipExisting: !forceDocs, forceRegenerate: forceDocs });
    }

    // Phase 5 — Product docs (FE only, seeded from readme + pages)
    console.log(`\n[Phase 5] Generating product docs (FE)...`);
    for (const repo of repos) {
      const absPath = resolve(repo.path);
      const repoParsed = allParsed.filter((f) => f.repo === repo.name);
      const isFe = repo.name.includes("frontend") || repo.name.endsWith("-fe") || repo.name.endsWith("-ui");
      if (isFe) {
        await generateProductDoc(repo.name, absPath, repoParsed, llm, readmeSeedByRepo.get(repo.name) ?? "", { skipExisting: !forceDocs, forceRegenerate: forceDocs });
      }
    }

    // Phase 6 — Cross-repo doc (FE→BE)
    const feRepoName = repos.find((r) => r.name.includes("frontend") || r.name.endsWith("-fe"))?.name;
    const beRepoName = repos.find((r) => !r.name.includes("frontend") && !r.name.endsWith("-fe"))?.name;
    if (feRepoName && beRepoName) {
      console.log(`\n[Phase 6] Generating cross-repo doc...`);
      await generateCrossRepoDoc(feRepoName, beRepoName, llm, { skipExisting: !forceDocs, forceRegenerate: forceDocs });
    }
  }

  console.log(`\nGenerating cards...`);
  const cards = await generateCards(
    flows,
    allParsed,
    edges,
    llm,
    projectContextByRepo.size > 0 ? projectContextByRepo : undefined,
    commitShaByRepo.size > 0 ? commitShaByRepo : undefined,
    allThermalMap.size > 0 ? allThermalMap : undefined,
  );
  console.log(`  -> ${cards.length} cards generated`);

  // Strip absolute workspace root from card content so paths are always relative
  const wsPrefix = workspaceRoot.endsWith("/") ? workspaceRoot : `${workspaceRoot}/`;
  for (const card of cards) {
    card.content = card.content.replaceAll(wsPrefix, "");
  }

  if (llm) {
    const totalChars = cards.reduce((sum, c) => sum + c.content.length, 0);
    const estimatedTokens = Math.ceil(totalChars / 4);
    const inputCost = (estimatedTokens * 1) / 1_000_000;
    const outputCost = (estimatedTokens * 5) / 1_000_000;
    console.log(`  LLM cost estimate: ~$${(inputCost + outputCost).toFixed(4)} (${estimatedTokens} tokens)`);
  }

  db.prepare("DELETE FROM cards WHERE card_type IN ('auto_generated', 'flow', 'model', 'cross_service', 'hub')").run();
  db.prepare("DELETE FROM card_embeddings").run();
  try { db.prepare("DELETE FROM card_title_embeddings").run(); } catch { /* pre-v14 DB */ }

  const insertCard = db.prepare(
    `INSERT INTO cards (id, flow, title, content, card_type, source_files, source_repos, tags, valid_branches, commit_sha, content_hash, identifiers)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertCardTx = db.transaction(() => {
    for (const card of cards) {
      insertCard.run(
        card.id,
        card.flow,
        card.title,
        card.content,
        card.cardType,
        JSON.stringify(card.sourceFiles.map((f) => relativizePath(f, workspaceRoot))),
        JSON.stringify(card.sourceRepos),
        JSON.stringify(card.tags),
        card.validBranches ? JSON.stringify(card.validBranches) : null,
        card.commitSha,
        card.contentHash,
        card.identifiers ?? ""
      );
    }
  });
  insertCardTx();
  // Rebuild FTS5 inverted index so keyword search reflects the new cards.
  // Required because cards_fts is an external-content table — INSERT OR REPLACE
  // on the base `cards` table does not automatically update the FTS shadow tables.
  db.exec("INSERT INTO cards_fts(cards_fts) VALUES('rebuild')");

  console.log(`\nGenerating embeddings...`);
  const embedder = getEmbedder();
  const insertEmbedding = db.prepare(
    `INSERT INTO card_embeddings (card_id, embedding) VALUES (?, ?)`
  );
  const insertTitleEmbedding = db.prepare(
    `INSERT INTO card_title_embeddings (card_id, embedding) VALUES (?, ?)`
  );
  const insertEmbTx = db.transaction(() => {
    for (const { id, embedding, titleEmbedding } of embeddingsToInsert) {
      insertEmbedding.run(id, Buffer.from(embedding.buffer));
      try {
        insertTitleEmbedding.run(id, Buffer.from(titleEmbedding.buffer));
      } catch { /* pre-v14 DB */ }
    }
  });

  const embeddingsToInsert: Array<{ id: string; embedding: Float32Array; titleEmbedding: Float32Array }> = [];
  for (const card of cards) {
    const text = `${card.title}\n${card.content}`;
    const [embedding, titleEmbedding] = await Promise.all([
      embedder.embed(text, "document"),
      embedder.embed(card.title, "document"),
    ]);
    embeddingsToInsert.push({ id: card.id, embedding, titleEmbedding });
    process.stdout.write(".");
  }
  console.log("");
  insertEmbTx();

  console.log(`\nComputing specificity scores...`);
  const specStats = computeSpecificity();
  console.log(`  -> ${specStats.total} cards scored (global dist range: ${specStats.globalRange[0].toFixed(4)} - ${specStats.globalRange[1].toFixed(4)})`);

  const fileInsert = db.prepare(
    `INSERT OR REPLACE INTO file_index (path, repo, branch, file_role, parsed_data, heat_score)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const fileInsertTx = db.transaction(() => {
    for (const pf of allParsed) {
      const relPath = relativizePath(pf.path, workspaceRoot);
      // pf.path is absolute; allThermalMap is keyed by absolute path
      const heat = allThermalMap.get(pf.path) ?? 0;
      const branch = gitSignalsByRepo.get(pf.repo)?.branch ?? "main";
      fileInsert.run(relPath, pf.repo, branch, pf.fileRole, JSON.stringify({
        classes: pf.classes,
        associations: pf.associations,
        functions: pf.functions.map((f) => f.name),
      }), heat);
    }
  });
  fileInsertTx();

  // Phase 7 — Write /ai-codeprism/ filesystem files (idempotent, hash-skip)
  if (!skipDocs) {
    console.log(`\nWriting /ai-codeprism/ docs to filesystem...`);
    const docsToWrite: DocToWrite[] = [];
    const allDocTypes = db
      .prepare(`SELECT repo, doc_type, content FROM project_docs WHERE stale = 0`)
      .all() as { repo: string; doc_type: string; content: string }[];

    for (const row of allDocTypes) {
      const repoConfig = repos.find((r) => r.name === row.repo);
      if (!repoConfig && row.repo !== "_workspace") continue;
      docsToWrite.push({
        repoAbsPath: repoConfig ? resolve(repoConfig.path) : workspaceRoot,
        docType: row.doc_type as import("../indexer/doc-prompts.js").DocType,
        content: row.content,
      });
    }

    const writeResult = await writeDocsToFilesystem(docsToWrite, workspaceRoot);
    console.log(`  -> ${writeResult.written} written, ${writeResult.skipped} skipped (hash match), ${writeResult.errors.length} errors`);
    if (writeResult.errors.length > 0) {
      for (const e of writeResult.errors) console.warn(`  [write] ${e}`);
    }
  }

  const flowCards = cards.filter((c) => c.cardType === "flow").length;
  const modelCards = cards.filter((c) => c.cardType === "model").length;
  const crossCards = cards.filter((c) => c.cardType === "cross_service").length;
  const hubCards = cards.filter((c) => c.cardType === "hub").length;

  console.log(`\n=== Indexing complete ===`);
  console.log(`  Flows: ${flows.length} (${flows.filter((f) => !f.isHub).length} domain + ${flows.filter((f) => f.isHub === true).length} hub)`);
  console.log(`  Cards: ${cards.length} total`);
  console.log(`    - Flow cards: ${flowCards}`);
  console.log(`    - Model cards: ${modelCards}`);
  console.log(`    - Cross-service cards: ${crossCards}`);
  console.log(`    - Hub cards: ${hubCards}`);
  console.log(`  Edges: ${edges.length}`);
  console.log(`  Files indexed: ${allParsed.length}`);
  console.log(`\nServer ready at http://localhost:${process.env["CODEPRISM_PORT"] ?? 4000}`);

  closeDb();
}

// Legacy direct-invocation support: `tsx src/cli/index-repos.ts [workspace-root] [flags]`
// Prefer `codeprism index` (codeprism.ts) for new usage — this block remains for
// backward-compatibility with existing scripts.
//
// Guard: only run when this file is the process entry point, not when imported
// as a module by `codeprism index`. Without the guard, importing index-repos.js
// triggers a second concurrent indexRepos() call that crashes when the first
// run calls closeDb() before the second run finishes.
if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const argv = process.argv.slice(2);
  const legacySkipDocs = argv.includes("--skip-docs");
  const legacyForceDocs = argv.includes("--force-docs");
  const legacyFetchRemote = argv.includes("--fetch-remote");
  const repoFlagIdx = argv.indexOf("--repo");
  const legacyRepoFilter: string | null = repoFlagIdx !== -1 ? (argv[repoFlagIdx + 1] ?? null) : null;
  const positional = argv.filter((a) => !a.startsWith("--") && a !== argv[repoFlagIdx + 1]);

  const workspaceRoot = positional[0] ?? process.env["CODEPRISM_WORKSPACE"] ?? userWorkspaceRootFrom(import.meta.url);

  const { loadWorkspaceConfig } = await import("../config/workspace-config.js");
  const config = loadWorkspaceConfig(workspaceRoot);
  const allRepos: RepoConfig[] = config.repos.map((r) => ({ name: r.name, path: r.path }));

  const repos = legacyRepoFilter
    ? allRepos.filter((r) => r.name === legacyRepoFilter)
    : allRepos;

  if (legacyRepoFilter && repos.length === 0) {
    console.error(`[index-repos] Unknown repo "${legacyRepoFilter}". Known: ${allRepos.map((r) => r.name).join(", ")}`);
    process.exit(1);
  }

  indexRepos(repos, workspaceRoot, {
    skipDocs: legacySkipDocs,
    forceDocs: legacyForceDocs,
    fetchRemote: legacyFetchRemote,
  }).catch((err) => {
    console.error("Indexing failed:", err);
    process.exit(1);
  });
} // end legacy direct-invocation guard
