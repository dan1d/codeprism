import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { getDb, closeDb } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";
import { registry } from "../indexer/tree-sitter.js";
import { buildGraph } from "../indexer/graph-builder.js";
import { detectFlows } from "../indexer/flow-detector.js";
import { extractSeedFlows } from "../indexer/route-extractor.js";
import { generateCards } from "../indexer/card-generator.js";
import { generateProjectDocs, loadProjectContext, generateWorkspaceSpecialist, discoverFrontendPages, discoverBeOverview, setWorkspaceRoot as setDocWorkspaceRoot } from "../indexer/doc-generator.js";
import { getEmbedder } from "../embeddings/local-embedder.js";
import { createLLMProvider } from "../llm/provider.js";
import { computeSpecificity } from "../search/specificity.js";
import { generateAndSaveAllRepoSignals } from "../search/repo-signals.js";
import { loadRepoConfig } from "../indexer/repo-config.js";
import type { ParsedFile } from "../indexer/types.js";

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

const skipDocs = process.argv.includes("--skip-docs");
const forceDocs = process.argv.includes("--force-docs");

// --repo <name>  filter indexing to a single repository by name
const repoFlagIdx = process.argv.indexOf("--repo");
const repoFilter: string | null = repoFlagIdx !== -1 ? (process.argv[repoFlagIdx + 1] ?? null) : null;

// Positional workspace root = first non-flag argument after the script path
const positionalArgs = process.argv.slice(2).filter((a) => !a.startsWith("--"));

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

async function indexRepos(repos: RepoConfig[], workspaceRoot: string): Promise<void> {
  const db = getDb();
  runMigrations(db);

  // Persist workspace root so other modules (invalidator, API) can resolve absolute paths
  db.prepare(
    `INSERT OR REPLACE INTO search_config (key, value) VALUES ('workspace_root', ?)`
  ).run(workspaceRoot);

  // Tell doc-generator about the workspace root so it can store relative paths too
  setDocWorkspaceRoot(workspaceRoot);

  const llm = createLLMProvider();
  if (llm) {
    const provider = process.env["SRCMAP_LLM_PROVIDER"] ?? "anthropic";
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
    console.log(`     Tip: set SRCMAP_LLM_PROVIDER=deepseek and SRCMAP_LLM_API_KEY for richer cards`);
  }

  console.log(`\n=== srcmap indexer ===\n`);
  console.log(`Repos to index: ${repos.map((r) => r.name).join(", ")}\n`);

  const allParsed: ParsedFile[] = [];
  const commitShaByRepo = new Map<string, string>();

  // Detect frameworks once across all repos before parsing
  const allRootPaths = repos.map((r) => resolve(r.path));
  const detectedFrameworks = await registry.detectFrameworks(allRootPaths);
  if (detectedFrameworks.length > 0) {
    console.log(`Detected frameworks: ${detectedFrameworks.join(", ")}`);
  }

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
    const parsed = await registry.parseDirectory(absPath, repo.name, repoConfig);

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
      } else {
        await discoverBeOverview(repo.name, absPath, repoParsed, llm);
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
  const seedFlows = extractSeedFlows(allParsed, feRepoNames, allDiscoveredPages.length > 0 ? allDiscoveredPages : undefined);
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
  for (const repo of repos) {
    const absPath = resolve(repo.path);
    const profile = detectStackProfile(absPath);
    saveRepoProfile(repo.name, profile);
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

      await generateProjectDocs(
        repo.name,
        absPath,
        repoParsed,
        llm,
        { skipExisting: !forceDocs, forceRegenerate: forceDocs },
        skillLabel,
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

  console.log(`\nGenerating cards...`);
  const cards = await generateCards(
    flows,
    allParsed,
    edges,
    llm,
    projectContextByRepo.size > 0 ? projectContextByRepo : undefined,
    commitShaByRepo.size > 0 ? commitShaByRepo : undefined,
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
    `INSERT OR REPLACE INTO file_index (path, repo, branch, file_role, parsed_data)
     VALUES (?, ?, 'main', ?, ?)`
  );
  const fileInsertTx = db.transaction(() => {
    for (const pf of allParsed) {
      fileInsert.run(relativizePath(pf.path, workspaceRoot), pf.repo, pf.fileRole, JSON.stringify({
        classes: pf.classes,
        associations: pf.associations,
        functions: pf.functions.map((f) => f.name),
      }));
    }
  });
  fileInsertTx();

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
  console.log(`\nServer ready at http://localhost:${process.env["SRCMAP_PORT"] ?? 4000}`);

  closeDb();
}

// Script lives at srcmap/packages/engine/src/cli/index-repos.ts
// Resolving ../../../../.. always gives the biobridge workspace root,
// regardless of the cwd that pnpm sets when running the script.
const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = positionalArgs[0] ?? resolve(scriptDir, "../../../../..");

const allRepos: RepoConfig[] = [
  { name: "biobridge-backend", path: resolve(workspaceRoot, "biobridge-backend") },
  { name: "biobridge-frontend", path: resolve(workspaceRoot, "biobridge-frontend") },
  { name: "bp-monitor-api", path: resolve(workspaceRoot, "bp-monitor-api") },
  { name: "bp-monitor-frontend", path: resolve(workspaceRoot, "bp-monitor-frontend") },
];

// Apply --repo filter if supplied
const repos = repoFilter
  ? allRepos.filter((r) => r.name === repoFilter)
  : allRepos;

if (repoFilter && repos.length === 0) {
  console.error(`[index-repos] Unknown repo "${repoFilter}". Known: ${allRepos.map((r) => r.name).join(", ")}`);
  process.exit(1);
}

indexRepos(repos, workspaceRoot).catch((err) => {
  console.error("Indexing failed:", err);
  process.exit(1);
});
