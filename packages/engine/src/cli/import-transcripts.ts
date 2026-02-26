/**
 * srcmap import-transcripts — discovers and processes AI conversation transcripts.
 *
 * Auto-discovers Cursor transcripts at ~/.cursor/projects/*\/agent-transcripts/*.jsonl
 * and Claude Code transcripts at ~/.claude/projects/**\/*.jsonl.
 *
 * For each transcript:
 *   1. Hash-dedup (skip if already imported)
 *   2. Parse + anonymize
 *   3. Gate check (does it contain explicit corrections / knowledge?)
 *   4. Extract insights (with evidence_quote validation)
 *   5. Semantic dedup (corroboration vs new card)
 *   6. Code-first verification (auto-promote, human gate, or aspirational)
 *   7. PR linking (file-overlap matching for trust boost)
 *   8. Write to DB (extracted_insights + cards)
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { glob } from "glob";
import { nanoid } from "nanoid";
import { getDb } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";
import { createLLMProvider } from "../llm/provider.js";
import { parseTranscriptFile } from "../conversations/parser.js";
import { anonymizeTranscript } from "../conversations/anonymizer.js";
import { extractInsights } from "../conversations/extractor.js";
import { verifyInsight } from "../conversations/verifier.js";
import { deduplicateInsights, type StoredInsightEmbedding } from "../conversations/dedup.js";
import { getEmbedder } from "../embeddings/local-embedder.js";

export interface ImportOptions {
  dryRun?: boolean;
  force?: boolean;
}

/**
 * Milliseconds to sleep between consecutive LLM calls.
 * Set CODEPRISM_LLM_DELAY_MS=1000 when hitting Gemini free-tier rate limits (15 RPM).
 */
const LLM_INTER_CALL_DELAY_MS = parseInt(process.env["CODEPRISM_LLM_DELAY_MS"] ?? "0", 10);

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

export async function importTranscripts(opts: ImportOptions = {}): Promise<void> {
  const { dryRun = false, force = false } = opts;

  const db = getDb();
  runMigrations(db);

  const llm = createLLMProvider();
  if (!llm) {
    console.error("[import-transcripts] No LLM configured. Set CODEPRISM_LLM_PROVIDER + CODEPRISM_LLM_API_KEY.");
    process.exit(1);
  }

  console.log(`\n=== srcmap import-transcripts${dryRun ? " (dry-run)" : ""} ===\n`);

  // ---------------------------------------------------------------------------
  // 1. Auto-discover transcript files
  // ---------------------------------------------------------------------------
  const home = homedir();
  const cursorPattern = join(home, ".cursor", "projects", "*", "agent-transcripts", "*.jsonl");
  const claudePattern = join(home, ".claude", "projects", "**", "*.jsonl");

  let transcriptPaths: string[] = [];
  try {
    const [cursorFiles, claudeFiles] = await Promise.all([
      glob(cursorPattern),
      glob(claudePattern),
    ]);
    transcriptPaths = [...cursorFiles, ...claudeFiles];
  } catch {
    // glob not available or no files
  }

  if (transcriptPaths.length === 0) {
    console.log("No transcript files found.");
    console.log(`  Searched: ${cursorPattern}`);
    console.log(`  Searched: ${claudePattern}`);
    return;
  }

  console.log(`Found ${transcriptPaths.length} transcript files\n`);

  // ---------------------------------------------------------------------------
  // 2. Load existing insight embeddings for dedup
  // ---------------------------------------------------------------------------
  const embedder = getEmbedder();
  const existingInsights: StoredInsightEmbedding[] = [];

  if (!dryRun) {
    const stored = db
      .prepare(`SELECT id, statement, trust_score FROM extracted_insights`)
      .all() as { id: string; statement: string; trust_score: number }[];

    for (const row of stored) {
      const embedding = await embedder.embed(row.statement, "document");
      existingInsights.push({
        id: row.id,
        statement: row.statement,
        embedding,
        trustScore: row.trust_score,
        corroborationCount: 0,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Process each transcript
  // ---------------------------------------------------------------------------
  let totalImported = 0;
  let totalSkipped = 0;
  let totalInsights = 0;
  let totalPromoted = 0;

  for (const filePath of transcriptPaths) {
    let rawText: string;
    try {
      rawText = await readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    const contentHash = createHash("sha256").update(rawText).digest("hex");

    // Hash-dedup
    if (!force && !dryRun) {
      const existing = db
        .prepare(`SELECT id FROM transcript_imports WHERE content_hash = ?`)
        .get(contentHash);
      if (existing) {
        totalSkipped++;
        continue;
      }
    }

    const transcriptId = nanoid();
    const transcript = await parseTranscriptFile(filePath, transcriptId);
    if (!transcript || transcript.messages.length < 2) {
      totalSkipped++;
      continue;
    }

    const anonymized = anonymizeTranscript(transcript);

    // Extract insights (two-pass LLM)
    await sleep(LLM_INTER_CALL_DELAY_MS);
    const rawInsights = await extractInsights(anonymized, llm);
    if (rawInsights.length === 0) {
      if (!dryRun) {
        db.prepare(
          `INSERT OR IGNORE INTO transcript_imports (id, file_path, content_hash, source_type)
           VALUES (?, ?, ?, ?)`
        ).run(transcriptId, filePath, contentHash, transcript.sourceType);
      }
      totalSkipped++;
      continue;
    }

    console.log(`  ${filePath.split("/").slice(-3).join("/")} → ${rawInsights.length} insights`);

    // Semantic dedup
    const deduped = await deduplicateInsights(rawInsights, existingInsights);

    for (const result of deduped) {
      const { insight, corroboratesId, trustScore } = result;

      if (dryRun) {
        console.log(`    [dry-run] ${insight.category}: ${insight.statement.slice(0, 80)}`);
        totalInsights++;
        continue;
      }

      // Verify against file_index.parsed_data
      await sleep(LLM_INTER_CALL_DELAY_MS);
      const verification = await verifyInsight(insight, llm);

      const insightId = nanoid();
      const cardId = nanoid();

      if (corroboratesId) {
        // Corroboration boost on existing record
        db.prepare(
          `UPDATE extracted_insights SET trust_score = ? WHERE id = ?`
        ).run(Math.min(trustScore, 1.0), corroboratesId);
        totalInsights++;
        continue;
      }

      // Insert new insight
      db.prepare(`
        INSERT INTO extracted_insights
          (id, transcript_id, card_id, category, statement, evidence_quote,
           confidence, scope, trust_score, code_consistency_score,
           verification_basis, aspirational)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        insightId,
        transcriptId,
        verification.auto_promote ? cardId : null,
        insight.category,
        insight.statement,
        insight.evidence_quote,
        insight.confidence,
        insight.scope,
        trustScore,
        verification.code_consistency_score,
        verification.verification_basis,
        verification.verification_basis === "aspirational" ? 1 : 0,
      );

      // Insert as card (auto-promoted or conv_insight for human review)
      const expires = new Date(Date.now() + 90 * 86_400_000).toISOString();
      const cardType = verification.auto_promote ? "auto_generated" : "conv_insight";
      const title = `[${insight.category}] ${insight.statement.slice(0, 80)}`;
      const content = [
        `**Category**: ${insight.category}`,
        `**Statement**: ${insight.statement}`,
        `**Evidence**: > ${insight.evidence_quote}`,
        `**Confidence**: ${(insight.confidence * 100).toFixed(0)}%`,
        `**Scope**: ${insight.scope}`,
        verification.auto_promote
          ? `**Verified**: code confirms this pattern (score: ${verification.code_consistency_score.toFixed(2)})`
          : `**Status**: needs human review via srcmap_promote_insight`,
      ].join("\n");

      db.prepare(`
        INSERT INTO cards
          (id, flow, title, content, card_type, source_files, source_repos,
           tags, valid_branches, commit_sha, content_hash, identifiers,
           source_conversation_id, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        cardId,
        insight.category,
        title,
        content,
        cardType,
        JSON.stringify([]),
        JSON.stringify([]),
        JSON.stringify(["conv_insight", insight.category, ...(verification.auto_promote ? ["verified"] : ["needs_review"])]),
        null,
        null,
        createHash("sha256").update(title + content).digest("hex"),
        insight.category,
        transcriptId,
        expires,
      );

      if (verification.auto_promote) totalPromoted++;
      totalInsights++;
    }

    if (!dryRun) {
      db.prepare(
        `INSERT OR IGNORE INTO transcript_imports (id, file_path, content_hash, source_type)
         VALUES (?, ?, ?, ?)`
      ).run(transcriptId, filePath, contentHash, transcript.sourceType);
    }

    totalImported++;
  }

  console.log(`\n=== Import complete ===`);
  console.log(`  Transcripts processed: ${totalImported}`);
  console.log(`  Transcripts skipped: ${totalSkipped}`);
  console.log(`  Insights extracted: ${totalInsights}`);
  console.log(`  Auto-promoted to cards: ${totalPromoted}`);
  if (totalInsights - totalPromoted > 0) {
    console.log(`  Awaiting human review (srcmap_promote_insight): ${totalInsights - totalPromoted}`);
  }
}
