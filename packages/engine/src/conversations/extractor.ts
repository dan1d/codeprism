/**
 * Two-pass LLM extraction of team knowledge from conversation transcripts.
 *
 * Pass 1 (Gate check): "Does this conversation contain explicit corrections
 *   or stated preferences?" — cheap, avoids expensive extraction for irrelevant chats.
 *
 * Pass 2 (Structured extraction): Extracts category + statement + evidence_quote
 *   + confidence + scope per insight.
 *
 * Critical guard: evidence_quote must appear as a substring in the raw transcript.
 * If it doesn't, the insight is discarded (hallucination protection).
 */

import type { LLMProvider } from "../llm/provider.js";
import type { Transcript } from "./parser.js";

export type InsightCategory =
  | "coding_rule"
  | "anti_pattern"
  | "architecture_decision"
  | "domain_knowledge"
  | "team_preference"
  | "gotcha";

export interface ExtractedInsight {
  category: InsightCategory;
  statement: string;
  evidence_quote: string;
  confidence: number;
  scope: "repo" | "workspace" | "global";
}

const GATE_PROMPT = `You are reviewing an AI coding assistant conversation transcript.

Determine if this conversation contains any of the following:
- Explicit corrections ("don't do X", "use Y instead of Z")
- Stated team preferences or coding standards
- Architecture decisions that were made
- Domain knowledge about the business (billing rules, patient flows, etc.)
- Warnings about gotchas or known issues

Reply with exactly one word: YES or NO.`;

const EXTRACT_PROMPT = `You are extracting reusable team knowledge from an AI coding assistant conversation.

Extract 1–5 insights. For each insight, output a JSON object on its own line:
{
  "category": "coding_rule" | "anti_pattern" | "architecture_decision" | "domain_knowledge" | "team_preference" | "gotcha",
  "statement": "concise rule statement (max 120 chars)",
  "evidence_quote": "verbatim quote from the transcript that proves this rule (max 200 chars)",
  "confidence": 0.1–1.0,
  "scope": "repo" | "workspace" | "global"
}

Rules:
- evidence_quote MUST be an exact substring of the transcript — do not paraphrase.
- Only extract explicit corrections or preferences, not implied patterns.
- Do not invent rules that aren't clearly stated.
- Skip personal information, meeting notes, or off-topic chat.

Output ONLY the JSON objects, one per line. No prose, no markdown.`;

/**
 * Extracts insights from a conversation transcript using a two-pass LLM approach.
 * Returns an empty array if the gate check fails or no valid insights are found.
 */
export async function extractInsights(
  transcript: Transcript,
  llm: LLMProvider,
): Promise<ExtractedInsight[]> {
  const conversationText = buildConversationText(transcript);
  if (!conversationText.trim()) return [];

  // Pass 1 — Gate check (cheap)
  let gateResponse: string;
  try {
    gateResponse = await llm.generate(
      `${GATE_PROMPT}\n\n---\n\n${conversationText.slice(0, 3000)}`,
      { maxTokens: 10 },
    );
  } catch {
    return [];
  }

  if (!gateResponse.trim().toUpperCase().startsWith("YES")) {
    return [];
  }

  // Pass 2 — Structured extraction
  let extractResponse: string;
  try {
    extractResponse = await llm.generate(
      `${EXTRACT_PROMPT}\n\n---\n\n${conversationText.slice(0, 6000)}`,
      { maxTokens: 800 },
    );
  } catch {
    return [];
  }

  const insights: ExtractedInsight[] = [];

  for (const line of extractResponse.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;

    let parsed: ExtractedInsight;
    try {
      parsed = JSON.parse(trimmed) as ExtractedInsight;
    } catch {
      continue;
    }

    if (!isValidInsight(parsed)) continue;

    // Hallucination guard: evidence_quote must appear in the raw transcript
    if (!transcript.rawText.includes(parsed.evidence_quote)) {
      continue;
    }

    insights.push(parsed);
  }

  return insights;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildConversationText(transcript: Transcript): string {
  return transcript.messages
    .filter((m) => m.role !== "tool") // tool output is rarely relevant for knowledge extraction
    .map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 800)}`)
    .join("\n\n");
}

function isValidInsight(obj: unknown): obj is ExtractedInsight {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o["category"] === "string" &&
    typeof o["statement"] === "string" &&
    typeof o["evidence_quote"] === "string" &&
    typeof o["confidence"] === "number" &&
    o["confidence"] >= 0 &&
    o["confidence"] <= 1 &&
    typeof o["scope"] === "string" &&
    o["statement"].length > 0 &&
    o["evidence_quote"].length > 0
  );
}
