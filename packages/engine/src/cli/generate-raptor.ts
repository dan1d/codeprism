/**
 * RAPTOR (Recursive Abstractive Processing for Tree-Organized Retrieval)
 *
 * Clusters existing cards by embedding similarity, then generates a cluster-level
 * summary card for each group using the LLM. Summary cards surface when queries
 * are vague or cross-cutting (e.g., "how does billing work overall?").
 *
 * Algorithm:
 *   1. Load 768-d embeddings for all non-stale cards
 *   2. K-means cluster them (k=8 by default)
 *   3. For each cluster, ask the LLM to write a ~300-word "cluster overview" card
 *   4. Insert with card_type='raptor_cluster', embed, rebuild FTS5
 *
 * Safe to re-run: removes existing raptor_cluster cards first.
 */

import { getDb, closeDb } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";
import { getEmbedder } from "../embeddings/local-embedder.js";
import { createLLMProvider } from "../llm/provider.js";
import type { Card } from "../db/schema.js";
import { nanoid } from "nanoid";

const K_CLUSTERS = parseInt(process.env["RAPTOR_K"] ?? "8", 10);
const MAX_ITER = 60;

// ── K-means ───────────────────────────────────────────────────────────────────

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function norm(a: Float32Array): number {
  return Math.sqrt(dot(a, a));
}

function cosine(a: Float32Array, b: Float32Array): number {
  const n = norm(a) * norm(b);
  return n === 0 ? 0 : dot(a, b) / n;
}

function meanVec(vecs: Float32Array[]): Float32Array {
  const dim = vecs[0]!.length;
  const out = new Float32Array(dim);
  for (const v of vecs) for (let i = 0; i < dim; i++) out[i]! += v[i]!;
  for (let i = 0; i < dim; i++) out[i]! /= vecs.length;
  return out;
}

function kmeans(
  vecs: Float32Array[],
  k: number,
  maxIter = MAX_ITER,
): number[] {
  const n = vecs.length;
  const dim = vecs[0]!.length;

  // Initialize centroids with k-means++ seeding
  const centroids: Float32Array[] = [];
  centroids.push(vecs[Math.floor(Math.random() * n)]!);
  for (let c = 1; c < k; c++) {
    const dists = vecs.map((v) => {
      let minD = Infinity;
      for (const centroid of centroids) minD = Math.min(minD, 1 - cosine(v, centroid));
      return minD;
    });
    const total = dists.reduce((s, d) => s + d, 0);
    let r = Math.random() * total;
    let chosen = 0;
    for (let i = 0; i < n; i++) {
      r -= dists[i]!;
      if (r <= 0) { chosen = i; break; }
    }
    centroids.push(new Float32Array(vecs[chosen]!));
  }

  const assignments = new Int32Array(n);
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;

    // Assign
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestSim = -Infinity;
      for (let c = 0; c < k; c++) {
        const sim = cosine(vecs[i]!, centroids[c]!);
        if (sim > bestSim) { bestSim = sim; best = c; }
      }
      if (assignments[i] !== best) { assignments[i] = best; changed = true; }
    }

    if (!changed) break;

    // Update centroids
    for (let c = 0; c < k; c++) {
      const members = vecs.filter((_, i) => assignments[i] === c);
      if (members.length > 0) {
        const mean = meanVec(members);
        const n2 = norm(mean);
        for (let i = 0; i < dim; i++) centroids[c]![i] = n2 > 0 ? mean[i]! / n2 : 0;
      }
    }
  }

  return Array.from(assignments);
}

// ── LLM prompt ────────────────────────────────────────────────────────────────

function buildClusterPrompt(cards: Card[]): string {
  const cardSummaries = cards
    .map((c, i) => {
      const preview = c.content.replace(/\n+/g, " ").slice(0, 300);
      return `${i + 1}. **${c.title}** (${c.card_type}): ${preview}`;
    })
    .join("\n\n");

  return `You are a senior engineer writing concise knowledge-base overview cards for a healthcare codebase.

The following ${cards.length} cards have been identified as a closely related thematic cluster:

${cardSummaries}

Write a single cohesive "Cluster Overview" card that:
1. Gives the cluster a short, descriptive title (3-6 words) on line 1, preceded by "# "
2. Explains what this cluster of features covers and why they belong together (1-2 sentences)
3. Summarizes the key functionality, data models, and workflows across all cards (150-200 words)
4. Lists which flows/models are included (bullet list)
5. Describes cross-cutting patterns or dependencies developers should know

Write in markdown. Keep it under 350 words total. Do not use placeholder text.`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const llm = createLLMProvider();
  if (!llm) {
    console.error("LLM provider required. Set CODEPRISM_LLM_PROVIDER and CODEPRISM_LLM_API_KEY.");
    process.exit(1);
  }

  const db = getDb();
  runMigrations(db);

  // Load all non-stale cards
  const cards = db
    .prepare("SELECT * FROM cards WHERE stale = 0 AND card_type NOT IN ('raptor_cluster', 'dev_insight')")
    .all() as Card[];

  console.log(`Loaded ${cards.length} cards for clustering.`);

  // Load embeddings
  const embRows = db
    .prepare("SELECT card_id, embedding FROM card_embeddings")
    .all() as { card_id: string; embedding: Buffer }[];

  const embMap = new Map<string, Float32Array>();
  for (const row of embRows) {
    embMap.set(
      row.card_id,
      new Float32Array(row.embedding.buffer.slice(row.embedding.byteOffset, row.embedding.byteOffset + row.embedding.byteLength)),
    );
  }

  // Filter to cards that have embeddings
  const cardsWithEmb = cards.filter((c) => embMap.has(c.id));
  console.log(`  ${cardsWithEmb.length} cards have embeddings.`);

  const vecs = cardsWithEmb.map((c) => embMap.get(c.id)!);
  const k = Math.min(K_CLUSTERS, Math.floor(cardsWithEmb.length / 3));
  console.log(`Running k-means with k=${k}...`);

  const assignments = kmeans(vecs, k);

  // Group cards by cluster
  const clusters = new Map<number, Card[]>();
  for (let i = 0; i < assignments.length; i++) {
    const c = assignments[i]!;
    if (!clusters.has(c)) clusters.set(c, []);
    clusters.get(c)!.push(cardsWithEmb[i]!);
  }

  console.log("\nClusters:");
  for (const [c, members] of clusters) {
    console.log(`  Cluster ${c}: ${members.map((m) => m.title).join(", ")}`);
  }

  // Remove existing raptor clusters
  db.prepare("DELETE FROM cards WHERE card_type = 'raptor_cluster'").run();
  console.log("\nGenerating cluster summary cards...");

  const embedder = getEmbedder();
  const insertCard = db.prepare(
    `INSERT INTO cards (id, flow, title, content, card_type, source_files, source_repos, tags, identifiers, stale, usage_count, specificity_score, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'raptor_cluster', '[]', ?, '[]', '', 0, 0, 0.5, datetime('now'), datetime('now'))`
  );
  const insertEmbedding = db.prepare(
    "INSERT INTO card_embeddings (card_id, embedding) VALUES (?, ?)"
  );
  const insertTitleEmb = db.prepare(
    "INSERT INTO card_title_embeddings (card_id, embedding) VALUES (?, ?)"
  );

  for (const [clusterIdx, members] of clusters) {
    console.log(`\n  Cluster ${clusterIdx} (${members.length} cards)...`);

    let raw: string;
    try {
      raw = await llm.generate(buildClusterPrompt(members), { maxTokens: 600, temperature: 0.1 });
    } catch (err) {
      console.warn(`  LLM failed for cluster ${clusterIdx}:`, err instanceof Error ? err.message : err);
      continue;
    }

    // Extract title from first line ("# Title")
    const lines = raw.split("\n");
    const titleLine = lines.find((l) => l.startsWith("# "));
    const title = titleLine ? titleLine.replace(/^#\s*/, "").trim() : `Cluster ${clusterIdx} Overview`;
    const content = raw.replace(/^#[^\n]*\n/, "").trim();

    console.log(`  → "${title}"`);

    // Gather source repos from members
    const allRepos = new Set<string>();
    for (const m of members) {
      try { for (const r of JSON.parse(m.source_repos)) allRepos.add(r); } catch { /* skip */ }
    }

    const id = nanoid();
    const [embedding, titleEmbedding] = await Promise.all([
      embedder.embed(`${title}\n${content}`, "document"),
      embedder.embed(title, "document"),
    ]);

    const tx = db.transaction(() => {
      insertCard.run(id, title, title, content, JSON.stringify([...allRepos]));
      insertEmbedding.run(id, Buffer.from(embedding.buffer));
      try { insertTitleEmb.run(id, Buffer.from(titleEmbedding.buffer)); } catch { /* pre-v14 */ }
    });
    tx();
  }

  // Rebuild FTS5
  db.exec("INSERT INTO cards_fts(cards_fts) VALUES('rebuild')");
  console.log("\nRAPTOR complete. FTS rebuilt.");

  const count = (db.prepare("SELECT COUNT(*) as n FROM cards WHERE card_type='raptor_cluster'").get() as {n:number}).n;
  console.log(`${count} raptor_cluster cards inserted.`);
  closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
