import { resolve } from "node:path";
import { getDb, closeDb } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";
import { parseDirectory, type ParsedFile } from "../indexer/tree-sitter.js";
import { buildGraph } from "../indexer/graph-builder.js";
import { detectFlows } from "../indexer/flow-detector.js";
import { generateCards } from "../indexer/card-generator.js";
import { getEmbedder } from "../embeddings/local-embedder.js";
import { createLLMProvider } from "../llm/provider.js";

interface RepoConfig {
  name: string;
  path: string;
}

async function indexRepos(repos: RepoConfig[]): Promise<void> {
  const db = getDb();
  runMigrations(db);

  const llm = createLLMProvider();
  if (llm) {
    console.log(`LLM: ${llm.model} (provider: ${process.env["SRCMAP_LLM_PROVIDER"] ?? "anthropic"})`);
  } else {
    console.log(`LLM: disabled (set SRCMAP_LLM_API_KEY to enable rich cards)`);
  }

  console.log(`\n=== srcmap indexer ===\n`);
  console.log(`Repos to index: ${repos.map((r) => r.name).join(", ")}\n`);

  const allParsed: ParsedFile[] = [];

  for (const repo of repos) {
    const absPath = resolve(repo.path);
    console.log(`Parsing ${repo.name} at ${absPath}...`);
    const parsed = await parseDirectory(absPath, repo.name);
    console.log(`  -> ${parsed.length} files parsed`);
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
        edge.sourceFile,
        edge.targetFile,
        edge.relation,
        JSON.stringify(edge.metadata),
        edge.repo
      );
    }
  });
  insertEdgeTx();

  console.log(`\nDetecting flows...`);
  const flows = detectFlows(edges, allParsed);
  console.log(`  -> ${flows.length} flows detected:`);
  for (const flow of flows) {
    console.log(`     - ${flow.name} (${flow.files.length} files, ${flow.repos.join(", ")})`);
  }

  console.log(`\nGenerating cards...`);
  const cards = await generateCards(flows, allParsed, edges, llm);
  console.log(`  -> ${cards.length} cards generated`);

  if (llm) {
    const totalChars = cards.reduce((sum, c) => sum + c.content.length, 0);
    const estimatedTokens = Math.ceil(totalChars / 4);
    const inputCost = (estimatedTokens * 1) / 1_000_000;
    const outputCost = (estimatedTokens * 5) / 1_000_000;
    console.log(`  LLM cost estimate: ~$${(inputCost + outputCost).toFixed(4)} (${estimatedTokens} tokens)`);
  }

  db.prepare("DELETE FROM cards WHERE card_type = 'auto_generated'").run();
  db.prepare("DELETE FROM card_embeddings").run();

  const insertCard = db.prepare(
    `INSERT INTO cards (id, flow, title, content, card_type, source_files, source_repos, valid_branches, commit_sha)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertCardTx = db.transaction(() => {
    for (const card of cards) {
      insertCard.run(
        card.id,
        card.flow,
        card.title,
        card.content,
        card.cardType,
        JSON.stringify(card.sourceFiles),
        JSON.stringify(card.sourceRepos),
        card.validBranches ? JSON.stringify(card.validBranches) : null,
        card.commitSha
      );
    }
  });
  insertCardTx();

  console.log(`\nGenerating embeddings...`);
  const embedder = getEmbedder();
  const insertEmbedding = db.prepare(
    `INSERT INTO card_embeddings (card_id, embedding) VALUES (?, ?)`
  );
  const insertEmbTx = db.transaction(() => {
    for (const { id, embedding } of embeddingsToInsert) {
      insertEmbedding.run(id, Buffer.from(embedding.buffer));
    }
  });

  const embeddingsToInsert: Array<{ id: string; embedding: Float32Array }> = [];
  for (const card of cards) {
    const text = `${card.title}\n${card.content}`;
    const embedding = await embedder.embed(text);
    embeddingsToInsert.push({ id: card.id, embedding });
    process.stdout.write(".");
  }
  console.log("");
  insertEmbTx();

  const fileInsert = db.prepare(
    `INSERT OR REPLACE INTO file_index (path, repo, branch, parsed_data)
     VALUES (?, ?, 'main', ?)`
  );
  const fileInsertTx = db.transaction(() => {
    for (const pf of allParsed) {
      fileInsert.run(pf.path, pf.repo, JSON.stringify({
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

const workspaceRoot = process.argv[2] ?? resolve(process.cwd(), "..");

const repos: RepoConfig[] = [
  { name: "biobridge-backend", path: resolve(workspaceRoot, "biobridge-backend") },
  { name: "biobridge-frontend", path: resolve(workspaceRoot, "biobridge-frontend") },
  { name: "bp-monitor-api", path: resolve(workspaceRoot, "bp-monitor-api") },
  { name: "bp-monitor-frontend", path: resolve(workspaceRoot, "bp-monitor-frontend") },
];

indexRepos(repos).catch((err) => {
  console.error("Indexing failed:", err);
  process.exit(1);
});
