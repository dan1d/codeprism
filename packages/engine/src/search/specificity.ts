import { getDb } from "../db/connection.js";
import { invalidateRepoCentroidsCache } from "./query-classifier.js";

const DIM = 384;

function cosine(a: Float32Array | Float64Array, b: Float32Array | Float64Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

function normalizeRange(values: Map<string, number>): Map<string, number> {
  const allVals = [...values.values()];
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const range = max - min;
  const out = new Map<string, number>();
  for (const [k, v] of values) {
    out.set(k, range > 0 ? (v - min) / range : 0.5);
  }
  return out;
}

/**
 * Computes a blended specificity score for every card:
 *  - Global specificity: cosine distance from the full-corpus centroid (0.4 weight)
 *  - Per-repo specificity: cosine distance from each card's own repo centroid (0.6 weight)
 *
 * Cards that are generic within their own repo (like hub models) get penalized
 * even if they look "unique" from the global perspective.
 *
 * Also invalidates the query-classifier centroid cache since embeddings changed.
 */
export function computeSpecificity(): { total: number; globalRange: [number, number] } {
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT ce.card_id, ce.embedding, c.source_repos
       FROM card_embeddings ce
       JOIN cards c ON c.id = ce.card_id`,
    )
    .all() as { card_id: string; embedding: Buffer; source_repos: string }[];

  if (rows.length === 0) return { total: 0, globalRange: [0, 0] };

  const embeddings = new Map<string, Float32Array>();
  const cardRepos = new Map<string, string[]>();
  const globalCentroid = new Float64Array(DIM);

  for (const row of rows) {
    const buf = row.embedding;
    const vec = new Float32Array(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    );
    embeddings.set(row.card_id, vec);

    let repos: string[] = [];
    try { repos = JSON.parse(row.source_repos); } catch { /* skip */ }
    cardRepos.set(row.card_id, repos);

    for (let i = 0; i < DIM; i++) globalCentroid[i]! += vec[i]!;
  }

  for (let i = 0; i < DIM; i++) globalCentroid[i]! /= rows.length;

  // Per-repo centroids
  const repoCentroidSums = new Map<string, { sum: Float64Array; count: number }>();
  for (const [cardId, vec] of embeddings) {
    const repos = cardRepos.get(cardId) ?? [];
    for (const repo of repos) {
      let entry = repoCentroidSums.get(repo);
      if (!entry) {
        entry = { sum: new Float64Array(DIM), count: 0 };
        repoCentroidSums.set(repo, entry);
      }
      for (let i = 0; i < DIM; i++) entry.sum[i]! += vec[i]!;
      entry.count++;
    }
  }

  const repoCentroids = new Map<string, Float64Array>();
  for (const [repo, { sum, count }] of repoCentroidSums) {
    if (count === 0) continue;
    const centroid = new Float64Array(DIM);
    for (let i = 0; i < DIM; i++) centroid[i] = sum[i]! / count;
    repoCentroids.set(repo, centroid);
  }

  // Global distances (1 - cosine similarity)
  const globalDists = new Map<string, number>();
  for (const [cardId, vec] of embeddings) {
    const sim = cosine(vec, globalCentroid);
    globalDists.set(cardId, 1 - sim);
  }

  // Per-repo distances -- average over all repos a card belongs to
  const repoDists = new Map<string, number>();
  for (const [cardId, vec] of embeddings) {
    const repos = cardRepos.get(cardId) ?? [];
    if (repos.length === 0) {
      repoDists.set(cardId, 0.5);
      continue;
    }
    let totalDist = 0;
    let count = 0;
    for (const repo of repos) {
      const centroid = repoCentroids.get(repo);
      if (!centroid) continue;
      totalDist += 1 - cosine(vec, centroid);
      count++;
    }
    repoDists.set(cardId, count > 0 ? totalDist / count : 0.5);
  }

  // Normalize each to [0, 1]
  const normGlobal = normalizeRange(globalDists);
  const normRepo = normalizeRange(repoDists);

  const globalVals = [...globalDists.values()];
  const minG = Math.min(...globalVals);
  const maxG = Math.max(...globalVals);

  const update = db.prepare(
    "UPDATE cards SET specificity_score = ? WHERE id = ?",
  );

  const batch = db.transaction(() => {
    for (const [cardId] of embeddings) {
      const g = normGlobal.get(cardId) ?? 0.5;
      const r = normRepo.get(cardId) ?? 0.5;
      const blended = 0.4 * g + 0.6 * r;
      update.run(blended, cardId);
    }
  });

  batch();

  // Invalidate the query-classifier cache since embeddings may have changed
  invalidateRepoCentroidsCache();

  return { total: rows.length, globalRange: [minG, maxG] };
}
