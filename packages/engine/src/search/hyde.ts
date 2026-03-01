/**
 * HyDE — Hypothetical Document Embeddings for code search.
 *
 * Instead of embedding the raw query ("how does auth work?"), we ask the LLM
 * to write a short hypothetical card that would answer the question, then
 * embed THAT. The resulting vector is much closer to real card vectors because
 * it uses the same vocabulary (class names, file roles, technical patterns).
 *
 * BM25 always uses the original query. HyDE only affects the semantic leg.
 *
 * References: Gao et al. 2022, "Precise Zero-Shot Dense Retrieval without
 * Relevance Labels" — arXiv:2212.10496
 */

import { createLLMProvider } from "../llm/provider.js";
import { getEmbedder } from "../embeddings/local-embedder.js";

/** Max time to wait for the LLM hypothetical before falling back. */
const HYDE_TIMEOUT_MS = 4000;

/**
 * Heuristic: skip HyDE for short or identifier-style queries.
 * BM25 handles exact token matches better than a hypothetical document would.
 *
 * Examples that skip HyDE:
 *   "AuthController"           → CamelCase identifier
 *   "pre_authorization"        → snake_case identifier
 *   "where is X"               → < 4 words, direct embedding works fine
 *
 * Examples that use HyDE:
 *   "how does payment processing work?"
 *   "what handles device pairing across repos?"
 *   "explain the onboarding flow for new users"
 */
function shouldSkipHyDE(query: string): boolean {
  const tokens = query.trim().split(/\s+/);
  if (tokens.length < 4) return true;
  // Any CamelCase or snake_case token → treat as an identifier lookup
  return tokens.some(
    (t) => /^[A-Z][a-z]+[A-Z]/.test(t) || /^[a-z]{2,}_[a-z]/.test(t),
  );
}

/**
 * Generates a hypothetical card for the query and returns its embedding.
 * Returns null if HyDE should be skipped, LLM is unavailable, or times out.
 */
export async function hydeEmbed(query: string): Promise<Float32Array | null> {
  if (process.env["CODEPRISM_HYDE_ENABLED"] === "false") return null;
  if (shouldSkipHyDE(query)) return null;

  const llm = createLLMProvider();
  if (!llm) return null;

  const prompt =
    `Write a concise technical description (2–4 sentences) of the code feature ` +
    `or concept that directly answers: "${query}"\n\n` +
    `Include specific technical details: relevant class names, controller or ` +
    `service names, API routes, file roles, or business logic patterns. ` +
    `Write as if describing a card in a codebase knowledge base. ` +
    `Be concrete and specific — not generic.`;

  try {
    const hypothetical = await Promise.race([
      llm.generate(prompt, { maxTokens: 150, temperature: 0 }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("HyDE timeout")), HYDE_TIMEOUT_MS),
      ),
    ]);

    if (!hypothetical || hypothetical.trim().length < 20) return null;

    return await getEmbedder().embed(hypothetical, "document");
  } catch {
    // LLM unavailable, quota exceeded, or timed out — fall back gracefully
    return null;
  }
}
