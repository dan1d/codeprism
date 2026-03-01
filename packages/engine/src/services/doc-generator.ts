import { nanoid } from "nanoid";
import { getDb } from "../db/connection.js";
import type { Card, GeneratedDoc } from "../db/schema.js";
import { getInstanceInfo, getLLMFromDb } from "./instance.js";

/* ------------------------------------------------------------------ */
/*  Generation state (in-memory, same pattern as reindexState)         */
/* ------------------------------------------------------------------ */

export interface DocsGenerationState {
  status: "idle" | "running" | "done" | "error";
  generated: number;
  total: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export const docsGenerationState: DocsGenerationState = {
  status: "idle",
  generated: 0,
  total: 0,
  error: null,
  startedAt: null,
  finishedAt: null,
};

/* ------------------------------------------------------------------ */
/*  Options                                                             */
/* ------------------------------------------------------------------ */

export interface GenerateDocsOptions {
  flowFilter?: string;
  audience?: "user" | "dev" | "both";
  force?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Business context inference                                          */
/* ------------------------------------------------------------------ */

/**
 * Builds a business context block by reading existing project_docs (about/readme)
 * and repo_profiles from the DB. This makes prompts domain-aware without
 * hardcoding any product-specific terminology — an e-commerce app gets
 * "customers/orders", a healthcare app gets "patients/authorizations", etc.
 */
function buildBusinessContext(): string {
  const db = getDb();
  const { companyName } = getInstanceInfo();

  // Collect about/readme docs — these are already LLM-generated product descriptions
  const aboutDocs = db
    .prepare(
      `SELECT repo, doc_type, content FROM project_docs
       WHERE doc_type IN ('about', 'readme') AND stale = 0
       ORDER BY updated_at DESC LIMIT 6`,
    )
    .all() as Array<{ repo: string; doc_type: string; content: string }>;

  // Collect repo tech stacks
  const profiles = db
    .prepare("SELECT repo, primary_language, frameworks FROM repo_profiles LIMIT 10")
    .all() as Array<{ repo: string; primary_language: string; frameworks: string }>;

  const lines: string[] = [];

  if (companyName) {
    lines.push(`Company / product: ${companyName}`);
  }

  if (profiles.length > 0) {
    const stackParts = profiles.map((p) => {
      const fws: string[] = [];
      try { fws.push(...(JSON.parse(p.frameworks) as string[])); } catch { /* ignore */ }
      return `${p.repo} (${p.primary_language}${fws.length ? ` · ${fws.slice(0, 3).join(", ")}` : ""})`;
    });
    lines.push(`Tech stack: ${stackParts.join(" | ")}`);
  }

  if (aboutDocs.length > 0) {
    lines.push("Product context (from existing docs):");
    for (const doc of aboutDocs) {
      // Take first 3 non-empty, non-heading lines as a brief extract
      const extract = doc.content
        .split("\n")
        .filter((l) => l.trim() && !l.startsWith("#"))
        .slice(0, 3)
        .join(" ")
        .slice(0, 300);
      if (extract) lines.push(`  [${doc.repo}/${doc.doc_type}] ${extract}`);
    }
  }

  return lines.length > 0
    ? `## Business Context\n${lines.join("\n")}\n\n`
    : "";
}

/* ------------------------------------------------------------------ */
/*  Prompt builders                                                     */
/* ------------------------------------------------------------------ */

const USER_SYSTEM_PROMPT = `You are a technical writer creating product documentation for end users.
Use the business context provided to infer the correct domain language (e.g. "patients", "customers", "users", "orders" — whatever fits the product).
Write in plain English. Use "you" to address the reader.
Never include class names, file paths, API endpoints, database terms, or code.
Keep sentences short and scannable. Aim for clarity over completeness.`;

function buildUserPrompt(flow: string, cards: Card[], businessContext: string): string {
  const cardSummaries = cards
    .slice(0, 10)
    .map((c, i) => {
      const preview = c.content
        .split("\n")
        .filter((l) => l.trim() && !l.startsWith("#"))
        .join(" ")
        .slice(0, 500);
      return `${i + 1}. ${c.title}: ${preview}`;
    })
    .join("\n\n");

  return `${businessContext}You are documenting the **"${flow}"** feature for end users of this product.

## Source knowledge (${cards.length} cards)
${cardSummaries}

## Output format
Write the documentation in markdown using exactly this structure:

# [Feature name] — User Guide

## What is this?
One clear paragraph. What does this feature do for the user? Why does it exist?

## How it works
Numbered steps. Each step is one short sentence. Use plain language. No technical terms.

## Who uses this?
One sentence describing which type of user interacts with this feature.

## Common questions
3–5 FAQ entries. Format each as:
**Q: [question]**
A: [answer]

## Things to know
2–4 bullet points of important notes, limits, or caveats the user should be aware of.

Do not include any code, class names, file paths, API routes, or database terms.
Keep total length under 500 words.`;
}

const DEV_SYSTEM_PROMPT = `You are a senior engineer writing internal developer documentation.
Use the business context to understand the domain, but focus on technical accuracy.
Be precise and terse. Use backtick formatting for all code identifiers (class names, methods, file paths, endpoints, fields).
Avoid prose padding — every sentence should carry information.`;

function buildDevPrompt(flow: string, cards: Card[], businessContext: string): string {
  const cardSummaries = cards
    .slice(0, 15)
    .map((c, i) => {
      const preview = c.content
        .split("\n")
        .filter((l) => l.trim())
        .join(" ")
        .slice(0, 600);
      let files = "";
      try {
        const parsed = JSON.parse(c.source_files) as string[];
        if (parsed.length > 0) files = `\n   Files: ${parsed.slice(0, 5).join(", ")}`;
      } catch { /* ignore */ }
      return `${i + 1}. [${c.card_type}] **${c.title}**\n   ${preview}${files}`;
    })
    .join("\n\n");

  // Collect unique source files across all cards
  const allFiles = cards.flatMap((c) => {
    try { return JSON.parse(c.source_files) as string[]; } catch { return []; }
  });
  const uniqueFiles = [...new Set(allFiles)].slice(0, 25);

  // Collect identifiers
  const identifiers = cards
    .map((c) => c.identifiers ?? "")
    .filter(Boolean)
    .join(" ")
    .slice(0, 1000);

  return `${businessContext}You are documenting the **"${flow}"** feature cluster for developers on this codebase.

## Source knowledge (${cards.length} cards)
${cardSummaries}

## Known source files (${uniqueFiles.length})
${uniqueFiles.map((f) => `- ${f}`).join("\n")}

## Identifiers
${identifiers || "(none)"}

## Output format
Write the documentation in markdown using exactly this structure:

# ${flow} — Developer Reference

## Overview
2–3 sentences: what this flow does technically and where it sits in the architecture.

## Key classes & services
Bullet list: \`ClassName\` — one-line description, with file path if known.

## API endpoints
List each endpoint: \`METHOD /path\` — what it does. Skip if none apply.

## Data model
Key fields for each relevant model. Use \`field: Type\` format. Include important validations or constraints.

## Request / response flow
Numbered steps tracing execution. Include class and method names at each step.

## Gotchas & edge cases
Bullet list of non-obvious behavior, known bugs, performance notes, or security constraints.

## Related flows
Names of related feature clusters a developer should also understand.

Be concise. Use \`backtick\` formatting for all code identifiers.`;
}

/* ------------------------------------------------------------------ */
/*  Helper: extract title from LLM output                              */
/* ------------------------------------------------------------------ */

function extractTitle(raw: string): string | null {
  const line = raw.split("\n").find((l) => l.startsWith("# "));
  return line ? line.replace(/^#\s*/, "").trim() : null;
}

function stripTitleLine(raw: string): string {
  return raw.replace(/^#[^\n]*\n?/, "").trim();
}

function collectRepos(cards: Card[]): string[] {
  const all = new Set<string>();
  for (const c of cards) {
    try {
      for (const r of JSON.parse(c.source_repos) as string[]) all.add(r);
    } catch { /* ignore */ }
  }
  return [...all];
}

/* ------------------------------------------------------------------ */
/*  Main export                                                         */
/* ------------------------------------------------------------------ */

export async function generateFlowDocs(
  opts: GenerateDocsOptions = {},
): Promise<{ generated: number; skipped: number }> {
  const llm = getLLMFromDb();
  if (!llm) throw new Error("LLM not configured. Configure it in Settings.");

  const db = getDb();

  // Load non-stale cards (exclude RAPTOR cluster summaries — too meta)
  const cards = db
    .prepare(
      `SELECT * FROM cards WHERE stale = 0 AND card_type NOT IN ('raptor_cluster')`,
    )
    .all() as Card[];

  // Group by flow
  const byFlow = new Map<string, Card[]>();
  for (const card of cards) {
    if (!byFlow.has(card.flow)) byFlow.set(card.flow, []);
    byFlow.get(card.flow)!.push(card);
  }

  // Apply optional flow filter
  const flows: [string, Card[]][] = opts.flowFilter
    ? [[opts.flowFilter, byFlow.get(opts.flowFilter) ?? []]]
    : [...byFlow.entries()];

  // Infer business context once (shared across all flows)
  const businessContext = buildBusinessContext();

  const audiences: ("user" | "dev")[] =
    opts.audience === "user" ? ["user"]
    : opts.audience === "dev" ? ["dev"]
    : ["user", "dev"];

  // Update global state
  docsGenerationState.status = "running";
  docsGenerationState.total = flows.length * audiences.length;
  docsGenerationState.generated = 0;
  docsGenerationState.error = null;
  docsGenerationState.startedAt = new Date().toISOString();
  docsGenerationState.finishedAt = null;

  const upsert = db.prepare(`
    INSERT INTO generated_docs
      (id, flow, audience, title, content, source_repos, card_count, generated_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(flow, audience) DO UPDATE SET
      title        = excluded.title,
      content      = excluded.content,
      source_repos = excluded.source_repos,
      card_count   = excluded.card_count,
      updated_at   = datetime('now')
  `);

  let generated = 0;
  let skipped = 0;

  try {
    for (const [flow, flowCards] of flows) {
      if (flowCards.length === 0) {
        skipped += audiences.length;
        docsGenerationState.generated += audiences.length;
        continue;
      }

      const sourceRepos = collectRepos(flowCards);

      for (const audience of audiences) {
        // Skip if already exists and not forcing
        if (!opts.force) {
          const existing = db
            .prepare("SELECT id FROM generated_docs WHERE flow = ? AND audience = ?")
            .get(flow, audience);
          if (existing) {
            skipped++;
            docsGenerationState.generated++;
            continue;
          }
        }

        const prompt =
          audience === "user"
            ? buildUserPrompt(flow, flowCards, businessContext)
            : buildDevPrompt(flow, flowCards, businessContext);

        const raw = await llm.generate(prompt, {
          maxTokens: audience === "user" ? 1200 : 2000,
          temperature: 0.15,
          systemPrompt: audience === "user" ? USER_SYSTEM_PROMPT : DEV_SYSTEM_PROMPT,
        });

        const title =
          extractTitle(raw) ??
          (audience === "user" ? `${flow} — User Guide` : `${flow} — Developer Reference`);
        const content = stripTitleLine(raw);

        upsert.run(
          nanoid(),
          flow,
          audience,
          title,
          content,
          JSON.stringify(sourceRepos),
          flowCards.length,
        );

        generated++;
        docsGenerationState.generated++;
        console.log(`  [${audience}] ${flow} → "${title}"`);
      }
    }

    docsGenerationState.status = "done";
  } catch (err) {
    docsGenerationState.status = "error";
    docsGenerationState.error = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    docsGenerationState.finishedAt = new Date().toISOString();
  }

  return { generated, skipped };
}
