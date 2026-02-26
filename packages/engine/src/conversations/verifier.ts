/**
 * Code-first verification of extracted insights.
 *
 * For each insight, the LLM generates a verification query pattern (what to look
 * for in the code), then we check that pattern deterministically against
 * file_index.parsed_data. This produces a code_consistency_score (0–1) without
 * re-parsing any files.
 *
 * Outcomes:
 *   score >= 0.8  → auto-promote (trust = 0.95, verification_basis = 'code_confirmed')
 *   0.4–0.8      → human gate (conv_insight card, codeprism_promote_insight MCP tool)
 *   < 0.4        → aspirational (trust = 0.2, aspirational = true, no promotion)
 */

import type { LLMProvider } from "../llm/provider.js";
import { getDb } from "../db/connection.js";
import type { ExtractedInsight } from "./extractor.js";

export interface VerificationResult {
  insight: ExtractedInsight;
  code_consistency_score: number;
  verification_basis: "code_confirmed" | "ambiguous" | "aspirational";
  auto_promote: boolean;
}

const QUERY_GENERATION_PROMPT = `You are analyzing a coding rule to determine how to verify it against parsed code data.

The rule is: "{statement}"
Category: {category}

The file_index table has a parsed_data JSON column with this structure per file:
{
  "classes": [{"name": "ClassName", "start_line": 1, "end_line": 50}],
  "functions": ["method_name_1", "method_name_2"],
  "associations": [{"type": "belongs_to", "target": "Model"}]
}

Generate a JSON verification spec on a single line:
{
  "query_type": "function_count" | "class_count" | "association_check" | "name_pattern" | "unverifiable",
  "target_dir": "path prefix to filter files (e.g. 'app/models', 'app/controllers')",
  "pattern": "string pattern to search for in parsed_data",
  "expected_comparison": "less_than" | "greater_than" | "contains" | "not_contains",
  "threshold": 0.05,
  "explanation": "what this check verifies"
}

If the rule cannot be verified from static parsed data (e.g. business rules, process rules), set query_type to "unverifiable".
Output ONLY the JSON object.`;

/**
 * Verifies an extracted insight against the file_index.parsed_data in the DB.
 */
export async function verifyInsight(
  insight: ExtractedInsight,
  llm: LLMProvider,
  repoName?: string,
): Promise<VerificationResult> {
  const unverifiable: VerificationResult = {
    insight,
    code_consistency_score: 0.5, // ambiguous by default
    verification_basis: "ambiguous",
    auto_promote: false,
  };

  // Generate the verification query spec using LLM
  const queryPrompt = QUERY_GENERATION_PROMPT
    .replace("{statement}", insight.statement)
    .replace("{category}", insight.category);

  let specRaw: string;
  try {
    specRaw = await llm.generate(queryPrompt, { maxTokens: 200 });
  } catch {
    return unverifiable;
  }

  const specLine = specRaw.split("\n").find((l) => l.trim().startsWith("{"));
  if (!specLine) return unverifiable;

  let spec: VerificationSpec;
  try {
    spec = JSON.parse(specLine) as VerificationSpec;
  } catch {
    return unverifiable;
  }

  if (spec.query_type === "unverifiable") {
    return { ...unverifiable, code_consistency_score: 0.5, verification_basis: "ambiguous" };
  }

  // Run the deterministic check against file_index.parsed_data
  const score = runVerificationQuery(spec, repoName);

  const verification_basis =
    score >= 0.8 ? "code_confirmed" :
    score >= 0.4 ? "ambiguous" :
    "aspirational";

  return {
    insight,
    code_consistency_score: score,
    verification_basis,
    auto_promote: score >= 0.8,
  };
}

// ---------------------------------------------------------------------------
// Deterministic query against file_index.parsed_data (no LLM)
// ---------------------------------------------------------------------------

interface VerificationSpec {
  query_type: "function_count" | "class_count" | "association_check" | "name_pattern" | "unverifiable";
  target_dir?: string;
  pattern?: string;
  expected_comparison?: "less_than" | "greater_than" | "contains" | "not_contains";
  threshold?: number;
}

function runVerificationQuery(spec: VerificationSpec, repoName?: string): number {
  const db = getDb();

  // Build WHERE clauses with parameterized bindings to prevent SQL injection.
  // LIKE wildcards (% and _) inside the target_dir value are escaped with backslash.
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (repoName) {
    conditions.push("repo = ?");
    params.push(repoName);
  }
  if (spec.target_dir) {
    const escaped = spec.target_dir.replace(/[\\%_]/g, "\\$&");
    conditions.push("path LIKE ? ESCAPE '\\'");
    params.push(`${escaped}%`);
  }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT parsed_data FROM file_index${where}`)
    .all(...params) as { parsed_data: string }[];

  if (rows.length === 0) return 0.5; // no data = ambiguous

  const parsedFiles = rows
    .map((r) => { try { return JSON.parse(r.parsed_data) as ParsedData; } catch { return null; } })
    .filter((d): d is ParsedData => d !== null);

  if (parsedFiles.length === 0) return 0.5;

  switch (spec.query_type) {
    case "function_count": {
      // Check if functions match a name pattern
      if (!spec.pattern) return 0.5;
      const regex = new RegExp(spec.pattern, "i");
      const total = parsedFiles.reduce((n, d) => n + d.functions.length, 0);
      const matching = parsedFiles.reduce(
        (n, d) => n + d.functions.filter((fn) => regex.test(fn)).length,
        0,
      );
      const ratio = total > 0 ? matching / total : 0;
      return scoreRatio(ratio, spec.expected_comparison ?? "greater_than", spec.threshold ?? 0.05);
    }

    case "class_count": {
      const total = parsedFiles.reduce((n, d) => n + d.classes.length, 0);
      if (!spec.pattern) return total > 0 ? 0.8 : 0.2;
      const regex = new RegExp(spec.pattern, "i");
      const matching = parsedFiles.reduce(
        (n, d) => n + d.classes.filter((c) => regex.test(c.name)).length,
        0,
      );
      const ratio = total > 0 ? matching / total : 0;
      return scoreRatio(ratio, spec.expected_comparison ?? "greater_than", spec.threshold ?? 0.1);
    }

    case "association_check": {
      if (!spec.pattern) return 0.5;
      const regex = new RegExp(spec.pattern, "i");
      const filesWithAssoc = parsedFiles.filter(
        (d) => d.associations.some((a) => regex.test(a.type) || regex.test(a.target)),
      );
      return filesWithAssoc.length > 0 ? 0.85 : 0.2;
    }

    case "name_pattern": {
      if (!spec.pattern) return 0.5;
      const regex = new RegExp(spec.pattern, "i");
      const matching = parsedFiles.filter(
        (d) => d.classes.some((c) => regex.test(c.name)) || d.functions.some((fn) => regex.test(fn)),
      );
      const ratio = matching.length / parsedFiles.length;
      return scoreRatio(ratio, spec.expected_comparison ?? "greater_than", spec.threshold ?? 0.2);
    }

    default:
      return 0.5;
  }
}

function scoreRatio(
  ratio: number,
  comparison: string,
  threshold: number,
): number {
  switch (comparison) {
    case "less_than":
      return ratio < threshold ? 0.9 : ratio < threshold * 3 ? 0.5 : 0.2;
    case "greater_than":
      return ratio > threshold ? 0.9 : ratio > threshold / 3 ? 0.5 : 0.2;
    case "contains":
      return ratio > 0 ? 0.85 : 0.1;
    case "not_contains":
      return ratio === 0 ? 0.9 : ratio < threshold ? 0.5 : 0.2;
    default:
      return 0.5;
  }
}

interface ParsedData {
  classes: { name: string }[];
  functions: string[];
  associations: { type: string; target: string }[];
}
