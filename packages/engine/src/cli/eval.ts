/**
 * `pnpm eval` — RAG quality evaluation CLI.
 *
 * Metrics reported:
 *   Hit@1, Hit@5, Hit@K   does the correct card appear in top-K?
 *   MRR                   mean reciprocal rank
 *   NDCG@K                normalized discounted cumulative gain
 *
 * Flags:
 *   --k <n>               Top-K cutoff (default 10)
 *   --snapshot <file>     Save results as JSON for future comparison
 *   --compare <file>      Compare current run against a saved snapshot
 *   --reset               Clear cached eval_cases and regenerate fresh
 */

import { nanoid } from "nanoid";
import { basename, extname } from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { getDb, closeDb } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";
import { hybridSearch } from "../search/hybrid.js";
import type { Card } from "../db/schema.js";

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const kIndex = args.indexOf("--k");
const K = kIndex !== -1 ? (parseInt(args[kIndex + 1] ?? "10") || 10) : 10;
const snapIndex = args.indexOf("--snapshot");
const SNAPSHOT_FILE = snapIndex !== -1 ? args[snapIndex + 1] ?? null : null;
const cmpIndex = args.indexOf("--compare");
const COMPARE_FILE = cmpIndex !== -1 ? args[cmpIndex + 1] ?? null : null;
const RESET = args.includes("--reset");

// ── Types ─────────────────────────────────────────────────────────────────────
interface EvalCase {
  id: string;
  query: string;
  expected_card_id: string;
  source: string;
}

interface EvalSnapshot {
  timestamp: string;
  k: number;
  n_cases: number;
  n_cards: number;
  hit_at_1: number;
  hit_at_5: number;
  hit_at_k: number;
  mrr: number;
  ndcg_at_k: number;
  by_type: Record<string, { hit_at_1: number; hit_at_5: number; hit_at_k: number; total: number }>;
  by_source: Record<string, { hits: number; total: number }>;
}

// ── Synthetic query generation ────────────────────────────────────────────────
/**
 * Two tiers of synthetic queries per card:
 *
 * "easy"   – contains the exact card name/flow. BM25 almost always wins.
 *             Useful as a sanity check floor but not a real quality signal.
 *
 * "medium" – derived from source file basenames and identifiers, NOT the
 *             card title. Forces semantic retrieval. More realistic than easy
 *             and much harder to game.
 */
function buildSyntheticCases(
  cards: Card[],
): { query: string; expected_card_id: string; source: string }[] {
  const cases: { query: string; expected_card_id: string; source: string }[] = [];

  for (const card of cards) {
    const name = card.flow || card.title;

    // Easy tier — name is in the query, BM25 trivially matches
    cases.push({ query: `How does ${name} work?`, expected_card_id: card.id, source: "synthetic_easy" });
    cases.push({ query: `explain the ${name} feature`, expected_card_id: card.id, source: "synthetic_easy" });

    // Medium tier — file basename (no path, no extension, underscores → spaces)
    const files: string[] = (() => { try { return JSON.parse(card.source_files as string); } catch { return []; } })();
    for (const filePath of files.slice(0, 2)) {
      const base = basename(filePath, extname(filePath)).replace(/[_-]/g, " ").toLowerCase();
      // skip if basename is basically the same word as the card name
      if (base && !name.toLowerCase().includes(base) && base.length > 3) {
        cases.push({ query: `what does ${base} do?`, expected_card_id: card.id, source: "synthetic_medium" });
        break;
      }
    }

    // Medium tier — first identifier (class name, route, etc.)
    const ids = (card.identifiers ?? "").split(" ").filter(Boolean);
    if (ids.length > 0) {
      cases.push({ query: `how is ${ids[0]} used?`, expected_card_id: card.id, source: "synthetic_medium" });
    }
    if (ids.length > 1) {
      cases.push({ query: `where is ${ids[1]} defined?`, expected_card_id: card.id, source: "synthetic_medium" });
    }
  }

  return cases;
}

// ── Main ──────────────────────────────────────────────────────────────────────
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

  if (RESET) {
    db.prepare("DELETE FROM eval_cases").run();
    console.log("Cleared eval_cases — will regenerate.");
  }

  // ── Load or seed eval cases ─────────────────────────────────────────────────
  let evalCases: EvalCase[] = [];
  try {
    evalCases = db.prepare("SELECT * FROM eval_cases").all() as EvalCase[];
  } catch { /* table may not exist on a very old DB */ }

  // Auto-detect stale eval cases: cards were reindexed and got new nanoid IDs.
  // If more than half the expected_card_ids no longer exist, the cases are stale.
  if (evalCases.length > 0) {
    const currentCardIds = new Set(cards.map((c) => c.id));
    const staleCount = evalCases.filter((ec) => !currentCardIds.has(ec.expected_card_id)).length;
    if (staleCount > evalCases.length * 0.5) {
      console.log(
        `Detected ${staleCount}/${evalCases.length} stale eval cases` +
        ` (cards were reindexed with new IDs). Regenerating...`,
      );
      db.prepare("DELETE FROM eval_cases").run();
      evalCases = [];
    }
  }

  if (evalCases.length === 0) {
    let realCasesAdded = 0;

    // Prefer real signal from card interactions marked 'insight_saved'
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
      db.transaction(() => {
        for (const row of interactions) {
          const id = nanoid();
          insert.run(id, row.query, row.card_id, "interaction");
          evalCases.push({ id, query: row.query, expected_card_id: row.card_id, source: "interaction" });
          realCasesAdded++;
        }
      })();
    } catch { /* card_interactions may be empty or absent */ }

    if (realCasesAdded > 0) {
      console.log(`Seeded ${realCasesAdded} eval cases from real interactions.`);
    }

    // Synthetic cases for cards not covered by real interactions
    const coveredCards = new Set(evalCases.map((e) => e.expected_card_id));
    const uncoveredCards = cards.filter((c) => !coveredCards.has(c.id));

    if (uncoveredCards.length > 0) {
      console.log(`Generating synthetic cases for ${uncoveredCards.length} uncovered cards...`);
      const synthCases = buildSyntheticCases(uncoveredCards);
      const insert = db.prepare(
        "INSERT OR IGNORE INTO eval_cases (id, query, expected_card_id, source) VALUES (?, ?, ?, ?)",
      );
      db.transaction(() => {
        for (const sc of synthCases) {
          const id = nanoid();
          insert.run(id, sc.query, sc.expected_card_id, sc.source);
          evalCases.push({ id, query: sc.query, expected_card_id: sc.expected_card_id, source: sc.source });
        }
      })();
    }

    const realCount = evalCases.filter((e) => e.source === "interaction").length;
    console.log(
      `Total eval cases: ${evalCases.length}` +
      ` (${realCount} real, ${evalCases.length - realCount} synthetic)`,
    );
  } else {
    const realCount = evalCases.filter((e) => e.source === "interaction").length;
    console.log(
      `Loaded ${evalCases.length} eval cases` +
      ` (${realCount} real, ${evalCases.length - realCount} synthetic).`,
    );
  }

  // ── Eval loop ───────────────────────────────────────────────────────────────
  const cardTypeMap = new Map<string, string>(cards.map((c) => [c.id, c.card_type]));

  let hits1 = 0, hits5 = 0, hitsK = 0;
  let rrSum = 0, ndcgSum = 0;
  const byType: Record<string, { h1: number; h5: number; hK: number; total: number }> = {};
  const bySource: Record<string, { hits: number; total: number }> = {};
  let done = 0;

  process.stdout.write(`\nEvaluating ${evalCases.length} queries at K=${K}...\n`);

  for (const ec of evalCases) {
    const results = await hybridSearch(ec.query, { limit: K });
    const rank = results.findIndex((r) => r.card.id === ec.expected_card_id);

    if (rank === 0)                 hits1++;
    if (rank !== -1 && rank < 5)   hits5++;
    if (rank !== -1) {
      hitsK++;
      rrSum   += 1 / (rank + 1);
      ndcgSum += 1 / Math.log2(rank + 2);
    }

    const cardType = cardTypeMap.get(ec.expected_card_id) ?? "unknown";
    if (!byType[cardType]) byType[cardType] = { h1: 0, h5: 0, hK: 0, total: 0 };
    const t = byType[cardType]!;
    t.total++;
    if (rank === 0)               t.h1++;
    if (rank !== -1 && rank < 5)  t.h5++;
    if (rank !== -1)              t.hK++;

    if (!bySource[ec.source]) bySource[ec.source] = { hits: 0, total: 0 };
    bySource[ec.source]!.total++;
    if (rank !== -1) bySource[ec.source]!.hits++;

    done++;
    if (done % 20 === 0 || done === evalCases.length) {
      process.stdout.write(`\r  ${done}/${evalCases.length}...`);
    }
  }
  process.stdout.write("\n");

  // ── Print results ───────────────────────────────────────────────────────────
  const n = evalCases.length;
  const pct  = (x: number) => n > 0 ? ((x / n) * 100).toFixed(1) + "%" : "N/A";
  const fmtR = (x: number) => n > 0 ? (x / n).toFixed(3) : "N/A";

  console.log("\n=== Eval Results ===");
  console.log(`Cards:          ${cards.length}`);
  console.log(`Queries:        ${n}`);
  console.log(`Hit@1:          ${pct(hits1)}`);
  console.log(`Hit@5:          ${pct(hits5)}`);
  console.log(`Hit@${K}:         ${pct(hitsK)}`);
  console.log(`MRR:            ${fmtR(rrSum)}`);
  console.log(`NDCG@${K}:        ${fmtR(ndcgSum)}`);

  if (Object.keys(byType).length > 0) {
    console.log("\nBy card type:");
    for (const [type, s] of Object.entries(byType).sort((a, b) => b[1].total - a[1].total)) {
      const th1 = s.total > 0 ? ((s.h1 / s.total) * 100).toFixed(1) : "0.0";
      const th5 = s.total > 0 ? ((s.h5 / s.total) * 100).toFixed(1) : "0.0";
      const thK = s.total > 0 ? ((s.hK / s.total) * 100).toFixed(1) : "0.0";
      console.log(
        `  [${type.padEnd(15)}]  Hit@1=${th1.padStart(5)}%  Hit@5=${th5.padStart(5)}%  Hit@${K}=${thK.padStart(5)}%  (n=${s.total})`,
      );
    }
  }

  if (Object.keys(bySource).length > 0) {
    console.log("\nBy query source:");
    for (const [src, s] of Object.entries(bySource).sort((a, b) => b[1].total - a[1].total)) {
      const p = s.total > 0 ? ((s.hits / s.total) * 100).toFixed(1) : "0.0";
      console.log(`  [${src.padEnd(22)}]  Hit@${K}=${p.padStart(5)}%  (${s.hits}/${s.total})`);
    }
  }

  console.log("\n====================\n");

  // ── Snapshot ────────────────────────────────────────────────────────────────
  const snapshot: EvalSnapshot = {
    timestamp: new Date().toISOString(),
    k: K,
    n_cases: n,
    n_cards: cards.length,
    hit_at_1: n > 0 ? hits1 / n : 0,
    hit_at_5: n > 0 ? hits5 / n : 0,
    hit_at_k: n > 0 ? hitsK / n : 0,
    mrr: n > 0 ? rrSum / n : 0,
    ndcg_at_k: n > 0 ? ndcgSum / n : 0,
    by_type: Object.fromEntries(
      Object.entries(byType).map(([type, s]) => [
        type,
        {
          hit_at_1: s.total > 0 ? s.h1 / s.total : 0,
          hit_at_5: s.total > 0 ? s.h5 / s.total : 0,
          hit_at_k: s.total > 0 ? s.hK / s.total : 0,
          total: s.total,
        },
      ]),
    ),
    by_source: bySource,
  };

  if (SNAPSHOT_FILE) {
    writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2));
    console.log(`Snapshot saved → ${SNAPSHOT_FILE}\n`);
  }

  // ── Compare ─────────────────────────────────────────────────────────────────
  if (COMPARE_FILE) {
    if (!existsSync(COMPARE_FILE)) {
      console.log(`Compare file not found: ${COMPARE_FILE}`);
    } else {
      const baseline = JSON.parse(readFileSync(COMPARE_FILE, "utf-8")) as EvalSnapshot;

      const delta = (curr: number, prev: number): string => {
        const d = (curr - prev) * 100;
        return (d >= 0 ? "+" : "") + d.toFixed(1) + "%";
      };
      const arrow = (curr: number, prev: number) =>
        curr > prev + 0.001 ? "↑" : curr < prev - 0.001 ? "↓" : "→";

      console.log(`=== Comparison vs baseline (${baseline.timestamp}) ===`);
      console.log(`             Baseline    Current     Delta`);
      const row = (label: string, curr: number, prev: number) => {
        const b = (prev * 100).toFixed(1).padStart(6) + "%";
        const c = (curr * 100).toFixed(1).padStart(6) + "%";
        const d = delta(curr, prev).padStart(8);
        console.log(`  ${label.padEnd(12)} ${b}      ${c}      ${d}  ${arrow(curr, prev)}`);
      };
      row("Hit@1",      snapshot.hit_at_1,   baseline.hit_at_1);
      row("Hit@5",      snapshot.hit_at_5,   baseline.hit_at_5);
      row(`Hit@${K}`,   snapshot.hit_at_k,   baseline.hit_at_k);
      row("MRR",        snapshot.mrr,         baseline.mrr);
      row(`NDCG@${K}`,  snapshot.ndcg_at_k,  baseline.ndcg_at_k);
      console.log("==============================================\n");
    }
  }

  closeDb();
}

main().catch((err: unknown) => {
  console.error("Eval failed:", err);
  process.exit(1);
});
