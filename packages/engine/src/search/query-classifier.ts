import { getDb } from "../db/connection.js";

const DIM = 384;

export interface RepoClassification {
  /** Repo with highest similarity to the query embedding, or null if no centroids loaded */
  topRepo: string | null;
  /** Similarity score per repo */
  scores: Map<string, number>;
  /**
   * Confidence = similarity(top-1) - similarity(top-2).
   * High confidence (>0.05) means the query clearly belongs to one repo.
   */
  confidence: number;
}

let repoCentroidsCache: Map<string, Float32Array> | null = null;

/**
 * Loads per-repo embedding centroids from the DB (averaged over all card
 * embeddings that belong to each repo). Cached in memory; call
 * `invalidateRepoCentroidsCache()` after re-indexing.
 */
export function getRepoCentroids(): Map<string, Float32Array> {
  if (repoCentroidsCache) return repoCentroidsCache;

  const db = getDb();

  const rows = db
    .prepare(
      `SELECT c.source_repos, ce.embedding
       FROM cards c
       JOIN card_embeddings ce ON ce.card_id = c.id
       WHERE c.stale = 0`,
    )
    .all() as { source_repos: string; embedding: Buffer }[];

  const repoVecs = new Map<string, { sum: Float64Array; count: number }>();

  for (const row of rows) {
    let repos: string[];
    try {
      repos = JSON.parse(row.source_repos);
    } catch {
      continue;
    }

    const buf = row.embedding;
    const vec = new Float32Array(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    );

    for (const repo of repos) {
      let entry = repoVecs.get(repo);
      if (!entry) {
        entry = { sum: new Float64Array(DIM), count: 0 };
        repoVecs.set(repo, entry);
      }
      for (let i = 0; i < DIM; i++) {
        entry.sum[i]! += vec[i]!;
      }
      entry.count++;
    }
  }

  const centroids = new Map<string, Float32Array>();
  for (const [repo, { sum, count }] of repoVecs) {
    if (count === 0) continue;
    const centroid = new Float32Array(DIM);
    let norm = 0;
    for (let i = 0; i < DIM; i++) {
      centroid[i] = sum[i]! / count;
      norm += centroid[i]! * centroid[i]!;
    }
    const mag = Math.sqrt(norm);
    if (mag > 0) {
      for (let i = 0; i < DIM; i++) centroid[i]! /= mag;
    }
    centroids.set(repo, centroid);
  }

  repoCentroidsCache = centroids;
  return centroids;
}

export function invalidateRepoCentroidsCache(): void {
  repoCentroidsCache = null;
}

/**
 * Classifies a query embedding against per-repo centroids.
 * Use the result to apply repo-affinity boosts in scoring.
 */
export function classifyQueryEmbedding(
  queryEmbedding: Float32Array,
): RepoClassification {
  const centroids = getRepoCentroids();

  if (centroids.size === 0) {
    return { topRepo: null, scores: new Map(), confidence: 0 };
  }

  const scores = new Map<string, number>();
  for (const [repo, centroid] of centroids) {
    scores.set(repo, cosine(queryEmbedding, centroid));
  }

  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const top1 = sorted[0];
  const top2 = sorted[1];
  const confidence = top1 && top2 ? top1[1] - top2[1] : top1 ? 1 : 0;

  return {
    topRepo: top1?.[0] ?? null,
    scores,
    confidence,
  };
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}
