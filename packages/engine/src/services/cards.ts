import { randomUUID } from "node:crypto";
import { getDb } from "../db/connection.js";
import type { Card } from "../db/schema.js";
import { hybridSearch } from "../search/hybrid.js";
import { patchMemoryDoc } from "../indexer/doc-generator.js";
import { safeParseJsonArray } from "./utils.js";

export function listCards(flow?: string): Card[] {
  const db = getDb();
  if (flow) {
    return db
      .prepare("SELECT * FROM cards WHERE flow = ? ORDER BY updated_at DESC")
      .all(flow) as Card[];
  }
  return db
    .prepare("SELECT * FROM cards ORDER BY updated_at DESC")
    .all() as Card[];
}

export function getCard(id: string): Card | null {
  const db = getDb();
  return (db.prepare("SELECT * FROM cards WHERE id = ?").get(id) as Card | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Save / verify cards
// ---------------------------------------------------------------------------

export function saveInsight(
  flow: string,
  title: string,
  content: string,
  files?: string[],
): { id: string } {
  const db = getDb();
  const id = randomUUID();
  const sourceFiles = JSON.stringify(files ?? []);

  db.prepare(
    `INSERT INTO cards (id, flow, title, content, card_type, source_files, created_by)
     VALUES (?, ?, ?, ?, 'dev_insight', ?, 'mcp_client')`,
  ).run(id, flow, title, content, sourceFiles);

  const insightCount = (
    db.prepare(
      `SELECT COUNT(*) as n FROM cards WHERE card_type = 'dev_insight' AND stale = 0`,
    ).get() as { n: number }
  ).n;
  if (insightCount % 10 === 0) {
    patchMemoryDoc().catch((err: unknown) =>
      console.warn("[memory] Patch failed:", (err as Error).message),
    );
  }

  return { id };
}

export function verifyCard(cardId: string): boolean {
  const db = getDb();
  const result = db.prepare(
    `UPDATE cards SET verified_at = datetime('now'), verification_count = verification_count + 1 WHERE id = ?`,
  ).run(cardId);
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Promote insight
// ---------------------------------------------------------------------------

export interface PromoteResult {
  promoted: boolean;
  statement?: string;
  docType?: string;
}

export function promoteInsight(
  insightId: string,
  approve: boolean,
  targetDoc?: "rules" | "code_style",
): PromoteResult {
  const db = getDb();

  const insight = db
    .prepare(`SELECT * FROM extracted_insights WHERE id = ?`)
    .get(insightId) as {
      id: string; statement: string; category: string; evidence_quote: string; trust_score: number;
    } | undefined;

  if (!insight) return { promoted: false };

  if (!approve) {
    db.prepare(`UPDATE extracted_insights SET aspirational = 1, trust_score = 0.2 WHERE id = ?`).run(insightId);
    return { promoted: false };
  }

  const docType = targetDoc ?? (
    insight.category === "coding_rule" || insight.category === "anti_pattern"
      ? "code_style" : "rules"
  );

  db.prepare(
    `UPDATE extracted_insights SET trust_score = 0.95, verification_basis = 'human_confirmed', aspirational = 0 WHERE id = ?`,
  ).run(insightId);

  if (insight.category) {
    db.prepare(
      `UPDATE cards SET tags = json_insert(tags, '$[#]', 'promoted'), expires_at = NULL WHERE source_conversation_id = (SELECT transcript_id FROM extracted_insights WHERE id = ?)`,
    ).run(insightId);
  }

  return { promoted: true, statement: insight.statement, docType };
}

// ---------------------------------------------------------------------------
// List flows — unified implementation used by both dashboard and MCP
// ---------------------------------------------------------------------------

export interface FlowSummary {
  flow: string;
  cardCount: number;
  fileCount: number;
  staleCount: number;
  repos: string[];
  avgHeat: number;
  isPageFlow: boolean;
}

export function listFlows(): FlowSummary[] {
  const db = getDb();

  const flows = db
    .prepare(
      `SELECT
        c.flow,
        COUNT(DISTINCT c.id)                          AS cardCount,
        COUNT(DISTINCT jf.value)                      AS fileCount,
        GROUP_CONCAT(DISTINCT jr.value)               AS repos,
        SUM(CASE WHEN c.stale = 1 THEN 1 ELSE 0 END) AS staleCount,
        COALESCE(AVG(fi.heat_score), 0)               AS avgHeat
      FROM cards c
        LEFT JOIN json_each(c.source_files) jf
        LEFT JOIN json_each(c.source_repos) jr
        LEFT JOIN file_index fi ON fi.path = jf.value
      WHERE c.card_type NOT IN ('conv_insight')
      GROUP BY c.flow
      ORDER BY avgHeat DESC, cardCount DESC`,
    )
    .all() as Array<{
      flow: string; cardCount: number; fileCount: number;
      repos: string | null; staleCount: number; avgHeat: number;
    }>;

  const result = flows.map((f) => ({
    flow: f.flow,
    cardCount: f.cardCount,
    fileCount: f.fileCount,
    staleCount: f.staleCount ?? 0,
    repos: f.repos ? [...new Set(f.repos.split(","))].filter(Boolean) : [],
    avgHeat: f.avgHeat,
    isPageFlow: f.flow.includes(" ") && !f.flow.includes("\u2194"),
  }));

  result.sort((a, b) => {
    if (a.isPageFlow && !b.isPageFlow) return -1;
    if (!a.isPageFlow && b.isPageFlow) return 1;
    return b.cardCount - a.cardCount;
  });

  return result;
}

// ---------------------------------------------------------------------------
// Search cards (dashboard)
// ---------------------------------------------------------------------------

export async function searchCards(query: string, limit = 10): Promise<Array<{
  id: string;
  title: string;
  card_type: string;
  flow: string;
  score: number;
  source: string;
  content: string;
  source_files: string[];
  tags: string[];
}>> {
  const n = Math.min(limit, 50);
  const results = await hybridSearch(query, { limit: n });

  return results.map((r) => ({
    id: r.card.id,
    title: r.card.title,
    card_type: r.card.card_type,
    flow: r.card.flow,
    score: r.score,
    source: r.source,
    content: r.card.content,
    source_files: safeParseJsonArray(r.card.source_files),
    tags: safeParseJsonArray(r.card.tags),
  }));
}
