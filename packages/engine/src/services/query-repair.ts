import { createLLMProvider, type LLMConfig as ProviderConfig } from "../llm/provider.js";
import { z } from "zod";

export type QueryRepairHints = Array<{ title: string; flow: string; identifiers: string }>;

export type QueryRepairProbe = {
  query: string;
  fts_terms?: string;
  like_tokens?: string[];
  confidence?: number;
};

export type QueryRepairResponse = {
  diagnosis?: Array<{ cause: string; evidence?: string[] }>;
  probes: QueryRepairProbe[];
};

const QueryRepairSchema = z.object({
  diagnosis: z.array(z.object({
    cause: z.string(),
    evidence: z.array(z.string()).optional(),
  })).optional(),
  probes: z.array(z.object({
    query: z.string(),
    fts_terms: z.string().optional(),
    like_tokens: z.array(z.string()).optional(),
    confidence: z.number().min(0).max(1).optional(),
  })).max(3),
});

export async function llmQueryRepair(params: {
  goalLabel: string;
  query: string;
  ftsQuery: string;
  likeTokensTried: string[];
  hints: QueryRepairHints;
  provider: ProviderConfig["provider"];
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  maxTokens?: number;
}): Promise<QueryRepairResponse | null> {
  const llm = createLLMProvider({
    provider: params.provider,
    apiKey: params.apiKey,
    model: params.model,
  });
  if (!llm) return null;

  const systemPrompt = [
    "You are a codebase search query-repair assistant for a SQLite FTS5 index.",
    "",
    "You do NOT have access to the repository. You only see:",
    "- the user query",
    "- the current FTS query (sanitized) and LIKE tokens already tried",
    "- a small list of indexed hints (card titles, flows, identifier strings)",
    "",
    "Your job: propose improved search probes likely to match the index.",
    "Rules:",
    "- Prefer exact tokens found in the provided hints.",
    "- Do not invent project-specific names.",
    "- Output ONLY valid JSON matching the schema. No markdown. No extra text.",
  ].join("\n");

  const userPrompt = [
    `Goal: fix retrieval misses for ${params.goalLabel}.`,
    "",
    "User query:",
    params.query,
    "",
    "Current FTS query (sanitized):",
    params.ftsQuery || "(empty)",
    "",
    "LIKE tokens already tried (JSON):",
    JSON.stringify(params.likeTokensTried.slice(0, 8)),
    "",
    "Indexed hints (JSON array):",
    JSON.stringify(params.hints.slice(0, 8)),
    "",
    "Return JSON with:",
    "- diagnosis: up to 2 likely mismatch reasons grounded in the hints/query",
    "- probes: up to 3 probe objects, each with:",
    '  - query: rewritten query (<= 120 chars)',
    '  - fts_terms: keywords (no operators) optional',
    '  - like_tokens: 2–6 tokens (must appear in query or hints) optional',
    "  - confidence: 0..1 optional",
  ].join("\n");

  const timeoutMs = Math.min(1500, Math.max(200, params.timeoutMs ?? 1200));
  const maxTokens = Math.min(500, Math.max(50, params.maxTokens ?? 250));
  const timeout = new Promise<string>((_resolve, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs));

  const raw = await Promise.race([
    llm.generate(userPrompt, { systemPrompt, maxTokens, temperature: 0.1 }),
    timeout,
  ]).catch(() => null);

  if (!raw) return null;

  try {
    const parsed = QueryRepairSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

