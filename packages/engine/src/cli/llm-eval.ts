/**
 * `pnpm llm-eval` — LLM-as-Judge retrieval evaluation.
 *
 * Unlike the synthetic Hit@K eval, this uses an LLM (DeepSeek by default) to
 * judge whether each returned card is actually relevant to the query. This
 * removes the artificial "only one card is correct" constraint and gives
 * meaningful quality signal even when multiple cards could answer a query.
 *
 * Metrics reported:
 *   Judged-P@1      Top-1 result rated ≥ 2 ("relevant") by LLM
 *   Judged-P@5      At least one of top-5 rated ≥ 2
 *   Avg-Rel@1       Mean LLM relevance score for top-1 (0–3 scale)
 *   Judged-NDCG@5   NDCG using LLM scores as graded relevance
 *
 * Flags:
 *   --k <n>          Top-K results to judge per query (default 5)
 *   --n <count>      Number of queries to sample (default: all)
 *   --concurrency    Parallel LLM judge calls (default 8)
 *   --snapshot <f>   Save results as JSON for future comparison
 *   --compare <f>    Compare current run against a saved snapshot
 */

import { getDb, closeDb } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";
import { hybridSearch } from "../search/hybrid.js";
import { rerankResults as crossEncoderRerank } from "../search/reranker.js";
import { createLLMProvider } from "../llm/provider.js";
import type { Card } from "../db/schema.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const kIndex = args.indexOf("--k");
const K = kIndex !== -1 ? (parseInt(args[kIndex + 1] ?? "5") || 5) : 5;
const nIndex = args.indexOf("--n");
const N_SAMPLE = nIndex !== -1 ? (parseInt(args[nIndex + 1] ?? "0") || 0) : 0;
const concIndex = args.indexOf("--concurrency");
const CONCURRENCY = concIndex !== -1 ? (parseInt(args[concIndex + 1] ?? "8") || 8) : 8;
const snapIndex = args.indexOf("--snapshot");
const SNAPSHOT_FILE = snapIndex !== -1 ? args[snapIndex + 1] ?? null : null;
const cmpIndex = args.indexOf("--compare");
const COMPARE_FILE = cmpIndex !== -1 ? args[cmpIndex + 1] ?? null : null;
const USE_RERANK = args.includes("--rerank");

// ── Types ─────────────────────────────────────────────────────────────────────
interface JudgedResult {
  card: Card;
  retrievalScore: number;
  relevance: number; // 0–3 from LLM judge
}

interface JudgedQuery {
  query: string;
  source: string;
  results: JudgedResult[];
}

interface LLMEvalSnapshot {
  timestamp: string;
  k: number;
  n_judged: number;
  n_cards: number;
  judged_p1: number;
  judged_p5: number;
  avg_rel1: number;
  judged_ndcg5: number;
  by_type: Record<string, { p1: number; p5: number; avg_rel: number; total: number }>;
  by_source: Record<string, { p5: number; avg_rel: number; total: number }>;
}

// ── NDCG calculation ──────────────────────────────────────────────────────────
function ndcg(relevances: number[], k: number): number {
  const topK = relevances.slice(0, k);
  const dcg = topK.reduce((sum, rel, i) => sum + (Math.pow(2, rel) - 1) / Math.log2(i + 2), 0);
  // Ideal: sort descending
  const ideal = [...topK].sort((a, b) => b - a);
  const idcg = ideal.reduce((sum, rel, i) => sum + (Math.pow(2, rel) - 1) / Math.log2(i + 2), 0);
  return idcg > 0 ? dcg / idcg : 0;
}

// ── LLM judge ────────────────────────────────────────────────────────────────
/**
 * Asks the LLM to rate each card's relevance to the query (0–3 scale).
 * Runs in a single LLM call per query — cheap (~500 input tokens).
 */
async function judgeRelevance(
  query: string,
  cards: Card[],
  llm: NonNullable<ReturnType<typeof createLLMProvider>>,
): Promise<number[]> {
  if (cards.length === 0) return [];

  const descriptions = cards.map((c, i) => {
    const preview = c.content.slice(0, 300).replace(/\n+/g, " ");
    // Include key class/hook names so the judge can evaluate "where is X defined?" queries.
    // This mirrors what formatCards() shows developers in production.
    const classNames = (c.identifiers ?? "")
      .split(/\s+/)
      .filter((t) => /^[A-Z][a-zA-Z0-9]{1,}/.test(t) || /^use[A-Z]/.test(t))
      .slice(0, 10)
      .join(", ");
    const idLine = classNames ? `\n  [identifiers: ${classNames}]` : "";
    return `[${i + 1}] **${c.title}** (${c.card_type})${idLine}\n${preview}`;
  }).join("\n\n");

  const prompt =
    `You are evaluating search results for a multi-repo codebase knowledge base.\n` +
    `Rate each result's relevance to the developer query on a scale of 0–3:\n` +
    `  0 = Irrelevant (wrong topic)\n` +
    `  1 = Marginally relevant (touches the topic but doesn't answer the query)\n` +
    `  2 = Relevant (addresses the query topic meaningfully)\n` +
    `  3 = Highly relevant (directly and specifically answers the query)\n\n` +
    `Query: "${query}"\n\n` +
    `Results:\n${descriptions}\n\n` +
    `Reply with ONLY a JSON array of ${cards.length} integers, e.g. [2,0,3,1,2]. No explanation.`;

  try {
    const response = await llm.generate(prompt, { maxTokens: 40, temperature: 0 });
    const match = response.match(/\[[\d,\s]+\]/);
    if (!match) return cards.map(() => 0);
    const scores = JSON.parse(match[0]) as number[];
    // Clamp to 0–3
    return scores.map((s) => Math.max(0, Math.min(3, Math.round(s))));
  } catch {
    return cards.map(() => 0);
  }
}

// ── Concurrency limiter ───────────────────────────────────────────────────────
async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
  onProgress: (done: number, total: number) => void,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;
  let done = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      results[index] = await tasks[index]!();
      done++;
      onProgress(done, tasks.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
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

  const cards = db
    .prepare("SELECT * FROM cards WHERE stale = 0 ORDER BY card_type, title")
    .all() as Card[];

  if (cards.length === 0) {
    console.log("No cards found. Run `pnpm index` first.");
    closeDb();
    return;
  }
  console.log(`Loaded ${cards.length} cards from DB.`);

  // Load eval cases from DB (generated by pnpm eval)
  let evalCases: { query: string; expected_card_id: string; source: string }[] = [];
  try {
    evalCases = db.prepare("SELECT * FROM eval_cases").all() as typeof evalCases;
  } catch {
    console.log("No eval_cases found. Run `pnpm eval --reset` first to generate them.");
    closeDb();
    return;
  }

  if (evalCases.length === 0) {
    console.log("eval_cases is empty. Run `pnpm eval --reset` first.");
    closeDb();
    return;
  }

  // Sample if requested
  let sample = evalCases;
  if (N_SAMPLE > 0 && N_SAMPLE < evalCases.length) {
    // Stratified: keep proportional distribution across sources
    const bySource = new Map<string, typeof evalCases>();
    for (const ec of evalCases) {
      let bucket = bySource.get(ec.source);
      if (!bucket) { bucket = []; bySource.set(ec.source, bucket); }
      bucket.push(ec);
    }
    sample = [];
    for (const [, bucket] of bySource) {
      const take = Math.round(N_SAMPLE * bucket.length / evalCases.length);
      // Shuffle bucket and take N
      const shuffled = [...bucket].sort(() => Math.random() - 0.5);
      sample.push(...shuffled.slice(0, Math.max(1, take)));
    }
    sample = sample.slice(0, N_SAMPLE);
    console.log(`Sampled ${sample.length} queries (from ${evalCases.length} total).`);
  } else {
    console.log(`Using all ${sample.length} eval queries.`);
  }

  console.log(`\nLLM judge: ${llm.model}`);
  console.log(`Judging top-K=${K}, concurrency=${CONCURRENCY}, rerank=${USE_RERANK}\n`);

  // Build judge tasks
  const cardTypeMap = new Map(cards.map((c) => [c.id, c.card_type]));
  const judged: JudgedQuery[] = new Array(sample.length);

  const tasks = sample.map((ec, idx) => async () => {
    // Fetch more candidates when reranking, then trim to K after rerank
    const fetchLimit = USE_RERANK ? Math.max(K * 3, 15) : K;
    const rawResults = await hybridSearch(ec.query, { limit: fetchLimit, skipUsageUpdate: true });
    const searchResults = USE_RERANK
      ? (await crossEncoderRerank(ec.query, rawResults, K))
      : rawResults.slice(0, K);
    const topCards = searchResults.map((r) => r.card);
    const relevances = await judgeRelevance(ec.query, topCards, llm);

    judged[idx] = {
      query: ec.query,
      source: ec.source,
      results: searchResults.map((r, i) => ({
        card: r.card,
        retrievalScore: r.score,
        relevance: relevances[i] ?? 0,
      })),
    };
  });

  let lastPrint = "";
  await runWithConcurrency(tasks, CONCURRENCY, (done, total) => {
    const line = `\r  ${done}/${total} queries judged...`;
    if (line !== lastPrint) {
      process.stdout.write(line);
      lastPrint = line;
    }
  });
  process.stdout.write("\n");

  // ── Compute metrics ──────────────────────────────────────────────────────
  let p1Count = 0, p5Count = 0, rel1Sum = 0, ndcgSum = 0;
  const byType: Record<string, { p1: number; p5: number; rel1: number; ndcg: number; total: number }> = {};
  const bySource: Record<string, { p5: number; rel1: number; total: number }> = {};

  for (const j of judged) {
    const rels = j.results.map((r) => r.relevance);
    const rel1 = rels[0] ?? 0;
    const maxRel5 = rels.length > 0 ? Math.max(...rels) : 0;
    const ndcgScore = ndcg(rels, K);

    if (rel1 >= 2) p1Count++;
    if (maxRel5 >= 2) p5Count++;
    rel1Sum += rel1;
    ndcgSum += ndcgScore;

    // Find the expected card's type from the original eval case
    const ec = sample[judged.indexOf(j)];
    const cardType = cardTypeMap.get(ec?.expected_card_id ?? "") ?? "unknown";

    if (!byType[cardType]) byType[cardType] = { p1: 0, p5: 0, rel1: 0, ndcg: 0, total: 0 };
    const t = byType[cardType]!;
    t.total++;
    t.rel1 += rel1;
    t.ndcg += ndcgScore;
    if (rel1 >= 2) t.p1++;
    if (maxRel5 >= 2) t.p5++;

    if (!bySource[j.source]) bySource[j.source] = { p5: 0, rel1: 0, total: 0 };
    const s = bySource[j.source]!;
    s.total++;
    s.rel1 += rel1;
    if (maxRel5 >= 2) s.p5++;
  }

  const n = judged.length;
  const pct = (x: number) => n > 0 ? ((x / n) * 100).toFixed(1) + "%" : "N/A";
  const fmt = (x: number) => n > 0 ? (x / n).toFixed(3) : "N/A";

  console.log("\n=== LLM-as-Judge Results ===");
  console.log(`Cards:           ${cards.length}`);
  console.log(`Queries judged:  ${n}`);
  console.log(`Judged-P@1:      ${pct(p1Count)}   (top-1 rated ≥ 2 by LLM)`);
  console.log(`Judged-P@${K}:      ${pct(p5Count)}   (any top-${K} rated ≥ 2 by LLM)`);
  console.log(`Avg-Rel@1:       ${fmt(rel1Sum)}   (mean relevance score 0–3 for top-1)`);
  console.log(`Judged-NDCG@${K}:  ${fmt(ndcgSum)}`);

  if (Object.keys(byType).length > 0) {
    console.log("\nBy expected card type:");
    for (const [type, s] of Object.entries(byType).sort((a, b) => b[1].total - a[1].total)) {
      const tp1 = s.total > 0 ? ((s.p1 / s.total) * 100).toFixed(1) : "0.0";
      const tp5 = s.total > 0 ? ((s.p5 / s.total) * 100).toFixed(1) : "0.0";
      const trel = s.total > 0 ? (s.rel1 / s.total).toFixed(2) : "0.00";
      console.log(
        `  [${type.padEnd(15)}]  P@1=${tp1.padStart(5)}%  P@${K}=${tp5.padStart(5)}%  Avg-Rel=${trel}  (n=${s.total})`,
      );
    }
  }

  if (Object.keys(bySource).length > 0) {
    console.log("\nBy query source:");
    for (const [src, s] of Object.entries(bySource).sort((a, b) => b[1].total - a[1].total)) {
      const tp5 = s.total > 0 ? ((s.p5 / s.total) * 100).toFixed(1) : "0.0";
      const trel = s.total > 0 ? (s.rel1 / s.total).toFixed(2) : "0.00";
      console.log(`  [${src.padEnd(22)}]  P@${K}=${tp5.padStart(5)}%  Avg-Rel=${trel}  (${s.total})`);
    }
  }

  // Show sample of failing queries (top-1 rated 0 or 1)
  const failures = judged.filter((j) => (j.results[0]?.relevance ?? 0) < 2).slice(0, 5);
  if (failures.length > 0) {
    console.log("\nSample low-P@1 queries (top-1 rated < 2):");
    for (const f of failures) {
      const top = f.results[0];
      console.log(`  Q: "${f.query.slice(0, 60)}"`);
      if (top) console.log(`     → "${top.card.title}" [${top.card.card_type}] rel=${top.relevance}`);
    }
  }

  console.log("\n============================\n");

  // ── Snapshot ────────────────────────────────────────────────────────────
  const snapshot: LLMEvalSnapshot = {
    timestamp: new Date().toISOString(),
    k: K,
    n_judged: n,
    n_cards: cards.length,
    judged_p1: n > 0 ? p1Count / n : 0,
    judged_p5: n > 0 ? p5Count / n : 0,
    avg_rel1: n > 0 ? rel1Sum / n : 0,
    judged_ndcg5: n > 0 ? ndcgSum / n : 0,
    by_type: Object.fromEntries(
      Object.entries(byType).map(([type, s]) => [
        type,
        {
          p1: s.total > 0 ? s.p1 / s.total : 0,
          p5: s.total > 0 ? s.p5 / s.total : 0,
          avg_rel: s.total > 0 ? s.rel1 / s.total : 0,
          total: s.total,
        },
      ]),
    ),
    by_source: Object.fromEntries(
      Object.entries(bySource).map(([src, s]) => [
        src,
        {
          p5: s.total > 0 ? s.p5 / s.total : 0,
          avg_rel: s.total > 0 ? s.rel1 / s.total : 0,
          total: s.total,
        },
      ]),
    ),
  };

  if (SNAPSHOT_FILE) {
    writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2));
    console.log(`Snapshot saved → ${SNAPSHOT_FILE}\n`);
  }

  // ── Compare ─────────────────────────────────────────────────────────────
  if (COMPARE_FILE) {
    if (!existsSync(COMPARE_FILE)) {
      console.log(`Compare file not found: ${COMPARE_FILE}`);
    } else {
      const baseline = JSON.parse(readFileSync(COMPARE_FILE, "utf-8")) as LLMEvalSnapshot;
      const delta = (curr: number, prev: number) => {
        const d = (curr - prev) * 100;
        return (d >= 0 ? "+" : "") + d.toFixed(1) + "%";
      };
      const arrow = (curr: number, prev: number) =>
        curr > prev + 0.005 ? "↑" : curr < prev - 0.005 ? "↓" : "→";

      console.log(`=== Comparison vs baseline (${baseline.timestamp}) ===`);
      console.log(`             Baseline    Current     Delta`);
      const row = (label: string, curr: number, prev: number) => {
        const b = (prev * 100).toFixed(1).padStart(6) + "%";
        const c = (curr * 100).toFixed(1).padStart(6) + "%";
        const d = delta(curr, prev).padStart(8);
        console.log(`  ${label.padEnd(14)} ${b}      ${c}      ${d}  ${arrow(curr, prev)}`);
      };
      row("Judged-P@1", snapshot.judged_p1, baseline.judged_p1);
      row(`Judged-P@${K}`, snapshot.judged_p5, baseline.judged_p5);
      row("Judged-NDCG@5", snapshot.judged_ndcg5, baseline.judged_ndcg5);
      console.log("==========================================\n");
    }
  }

  closeDb();
}

main().catch((err: unknown) => {
  console.error("LLM eval failed:", err);
  process.exit(1);
});
