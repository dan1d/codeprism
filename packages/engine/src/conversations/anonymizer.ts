/**
 * Anonymizes conversation transcripts before LLM extraction.
 *
 * Strips PII (emails, tokens, phone numbers, @mentions, IP addresses) while
 * preserving information useful for code knowledge extraction:
 *   - File paths (/path/to/file.rb)
 *   - Class and method names (CamelCase, snake_case)
 *   - Role labels (user, assistant)
 *   - Technical terminology
 */

import type { Transcript, TranscriptMessage } from "./parser.js";

const PII_REPLACEMENTS: Array<[RegExp, string | ((m: string) => string)]> = [
  // Email addresses
  [/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, "[EMAIL]"],
  // Bearer tokens and API keys (long alphanumeric strings)
  [/\b(Bearer\s+)[A-Za-z0-9\-._~+/]+=*\b/g, "$1[TOKEN]"],
  [/\b(sk-|xai-|key-)[A-Za-z0-9]{16,}\b/g, "[API_KEY]"],
  // Phone numbers (US format variants)
  [/\b(\+1[-.\s]?)?(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})\b/g, "[PHONE]"],
  // @mentions (Slack/GitHub style) — but NOT package imports (@angular/core) or JSDoc tags
  [/(?<!\w)@(?!(param|returns?|throws?|type|example|deprecated|since|see|link|module|class|interface|typedef|property|member|method|static|readonly|override|public|private|protected|async|yields?|description|summary|license|author|file|constructor|extends|implements)\b)[a-z][a-z0-9_]{2,}\b(?!\/)/gi, "[MENTION]"],
  // IPv4 addresses
  [/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "[IP]"],
  // Personal names in common greeting patterns
  [/\b(Hi|Hello|Hey),?\s+[A-Z][a-z]+\b/g, (m: string) => m.split(/,?\s+/)[0] ?? m],
  // GitHub/GitLab personal access tokens
  [/\bghp_[A-Za-z0-9]{36,}\b/g, "[GH_TOKEN]"],
  [/\bglpat-[A-Za-z0-9_-]{20,}\b/g, "[GL_TOKEN]"],
];

/**
 * Anonymizes the text content of a single message while preserving code
 * identifiers and file paths that are needed for knowledge extraction.
 */
export function anonymizeText(text: string): string {
  let result = text;
  for (const [pattern, replacement] of PII_REPLACEMENTS) {
    result = result.replace(pattern, replacement as string);
  }
  return result;
}

/**
 * Returns an anonymized copy of the transcript.
 * The original `rawText` is kept untouched for evidence_quote validation.
 */
export function anonymizeTranscript(transcript: Transcript): Transcript {
  const anonymizedMessages: TranscriptMessage[] = transcript.messages.map((msg) => ({
    ...msg,
    content: anonymizeText(msg.content),
  }));

  return {
    ...transcript,
    messages: anonymizedMessages,
    // rawText is preserved without anonymization for evidence_quote substring matching
  };
}
