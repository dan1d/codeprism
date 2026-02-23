/**
 * `pnpm eval` — RAG quality evaluation CLI.
 *
 * Reads cards from the DB, runs each query through hybrid search, and reports:
 *   - Flow Hit Rate  (correct card appears in top-K results)
 *   - P@K           (precision at K — same as flow hit rate for single-card queries)
 *   - MRR           (mean reciprocal rank)
 *
 * If no eval_cases exist, generates 3 synthetic queries per card using simple
 * templates, stores them in the eval_cases table, then evaluates.
 */

import { nanoid } from "nanoid";
import { getDb, closeDb } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";
import { hybridSearch } from "../search/hybrid.js";
import type { Card } from "../db/schema.js";

const K = 10;

interface EvalCase {
  id: string;
  query: string;
  expected_card_id: string;
  source: string;
}

const QUERY_TEMPLATES: Array<(name: string) => string> = [
  (name) => `How does ${name} work?`,
  (name) => `What files are involved in ${name}?`,
  (name) => `Show me the ${name} implementation`,
];

async function main(): Promise<void> {
  const db = getDb();
  runMigrations(db);

  const cards = db
    .prepare("SELECT * FROM cards WHERE stale = 0 ORDER BY card_type, title")
    .all() as Card[];

  if (cards.length === 0) {
    console.log("No cards found. Run `pnpm index` first.");
    closeDb();
    return;
  }

  console.log(`Loaded ${cards.length} cards from DB.`);

  // Load or generate eval cases
  let evalCases: EvalCase[] = [];
  try {
    evalCases = db.prepare("SELECT * FROM eval_cases").all() as EvalCase[];
  } catch {
    // eval_cases table not yet present — runMigrations should have created it,
    // but handle gracefully in case of a very old DB
  }

  if (evalCases.length === 0) {
    // Prefer real signal: queries that led to an insight being saved are strong
    // positives — the agent found the card useful enough to write a new insight.
    let realCasesAdded = 0;
    try {
      const interactions = db
        .prepare(
          `SELECT ci.query, ci.card_id
           FROM card_interactions ci
           WHERE ci.outcome = 'insight_saved'
             AND ci.card_id IN (SELECT id FROM cards WHERE stale = 0)
           GROUP BY ci.query, ci.card_id
           ORDER BY MAX(ci.timestamp) DESC
           LIMIT 500`,
        )
        .all() as { query: string; card_id: string }[];

      const insert = db.prepare(
        "INSERT OR IGNORE INTO eval_cases (id, query, expected_card_id, source) VALUES (?, ?, ?, ?)",
      );
      const insertTx = db.transaction(() => {
        for (const row of interactions) {
          const id = nanoid();
          insert.run(id, row.query, row.card_id, "interaction");
          evalCases.push({ id, query: row.query, expected_card_id: row.card_id, source: "interaction" });
          realCasesAdded++;
        }
      });
      insertTx();
    } catch { /* card_interactions may be empty or absent */ }

    if (realCasesAdded > 0) {
      console.log(`Seeded ${realCasesAdded} eval cases from real card interactions.`);
    }

    // Fall back to synthetic templates for remaining cards not covered by interactions
    const coveredCards = new Set(evalCases.map((e) => e.expected_card_id));
    const uncoveredCards = cards.filter((c) => !coveredCards.has(c.id));

    if (uncoveredCards.length > 0) {
      console.log(`Generating synthetic cases for ${uncoveredCards.length} uncovered cards...`);
      const insert = db.prepare(
        "INSERT OR IGNORE INTO eval_cases (id, query, expected_card_id, source) VALUES (?, ?, ?, ?)",
      );
      const insertTx = db.transaction(() => {
        for (const card of uncoveredCards) {
          const name = card.flow || card.title;
          for (const template of QUERY_TEMPLATES) {
            const query = template(name);
            const id = nanoid();
            insert.run(id, query, card.id, "synthetic");
            evalCases.push({ id, query, expected_card_id: card.id, source: "synthetic" });
          }
        }
      });
      insertTx();
    }

    console.log(`Total eval cases: ${evalCases.length} (${realCasesAdded} real, ${evalCases.length - realCasesAdded} synthetic)`);
  } else {
    const realCount = evalCases.filter((e) => e.source === "interaction").length;
    const synthCount = evalCases.length - realCount;
    console.log(`Loaded ${evalCases.length} eval cases (${realCount} real, ${synthCount} synthetic).`);
  }

  // Run evaluation
  let flowHits = 0;
  let reciprocalRankSum = 0;
  let ndcgSum = 0;
  let bySource: Record<string, { hits: number; total: number }> = {};
  let done = 0;

  process.stdout.write(`\nEvaluating ${evalCases.length} queries at K=${K}...\n`);

  for (const ec of evalCases) {
    const results = await hybridSearch(ec.query, { limit: K });
    const rank = results.findIndex((r) => r.card.id === ec.expected_card_id);

    if (rank !== -1) {
      flowHits++;
      reciprocalRankSum += 1 / (rank + 1);
      // NDCG@K: single relevant document — DCG = 1/log2(rank+2), IDCG = 1
      ndcgSum += 1 / Math.log2(rank + 2);
    }

    const src = ec.source;
    if (!bySource[src]) bySource[src] = { hits: 0, total: 0 };
    bySource[src].total++;
    if (rank !== -1) bySource[src].hits++;

    done++;
    if (done % 20 === 0 || done === evalCases.length) {
      process.stdout.write(`\r  ${done}/${evalCases.length}...`);
    }
  }
  process.stdout.write("\n");

  const n = evalCases.length;
  const flowHitRate = n > 0 ? ((flowHits / n) * 100).toFixed(1) : "N/A";
  const mrr = n > 0 ? (reciprocalRankSum / n).toFixed(3) : "N/A";
  const ndcg = n > 0 ? (ndcgSum / n).toFixed(3) : "N/A";

  console.log("\n=== Eval Results ===");
  console.log(`Cards evaluated:  ${cards.length}`);
  console.log(`Queries run:      ${n}`);
  console.log(`Flow Hit @${K}:    ${flowHitRate}%`);
  console.log(`MRR:              ${mrr}`);
  console.log(`NDCG@${K}:         ${ndcg}`);

  // Per-source breakdown
  for (const [src, stats] of Object.entries(bySource)) {
    const pct = ((stats.hits / stats.total) * 100).toFixed(1);
    console.log(`  [${src}] Hit@${K}: ${pct}% (${stats.hits}/${stats.total})`);
  }
  console.log("====================\n");

  closeDb();
}

main().catch((err: unknown) => {
  console.error("Eval failed:", err);
  process.exit(1);
});
