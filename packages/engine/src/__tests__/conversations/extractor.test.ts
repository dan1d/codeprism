import { describe, it, expect } from "vitest";
import type { Transcript } from "../../conversations/parser.js";

// Test the evidence_quote validation logic in isolation
// (without calling real LLM — this is the critical hallucination guard)

function validateEvidenceQuote(quote: string, rawText: string): boolean {
  return rawText.includes(quote);
}

const sampleTranscript: Transcript = {
  id: "test-1",
  filePath: "/test.jsonl",
  sourceType: "cursor",
  messages: [
    { role: "user", content: "Don't use rescue Exception in Ruby — catch StandardError instead" },
    { role: "assistant", content: "You're right, rescue Exception is an anti-pattern in Ruby." },
  ],
  rawText: `user: Don't use rescue Exception in Ruby — catch StandardError instead\nassistant: You're right, rescue Exception is an anti-pattern in Ruby.`,
};

describe("evidence_quote validation", () => {
  it("accepts quotes that appear verbatim in the raw transcript", () => {
    const quote = "rescue Exception is an anti-pattern in Ruby";
    expect(validateEvidenceQuote(quote, sampleTranscript.rawText)).toBe(true);
  });

  it("rejects quotes that do not appear in the raw transcript (hallucination guard)", () => {
    const hallucinated = "never use begin rescue in any language";
    expect(validateEvidenceQuote(hallucinated, sampleTranscript.rawText)).toBe(false);
  });

  it("rejects paraphrased quotes even if semantically similar", () => {
    const paraphrase = "rescue Exception must be avoided";
    expect(validateEvidenceQuote(paraphrase, sampleTranscript.rawText)).toBe(false);
  });
});

describe("conversations/parser integration", () => {
  it("parseCursorJsonl handles simple role/content format", async () => {
    const { parseCursorJsonl } = await import("../../conversations/parser.js");
    const jsonlLine = JSON.stringify({ role: "user", content: "Use service objects" });
    const transcript = parseCursorJsonl(jsonlLine, "/test.jsonl", "t1");
    expect(transcript.messages).toHaveLength(1);
    expect(transcript.messages[0]!.role).toBe("user");
    expect(transcript.messages[0]!.content).toBe("Use service objects");
  });

  it("parseCursorJsonl skips malformed JSON lines", async () => {
    const { parseCursorJsonl } = await import("../../conversations/parser.js");
    const malformed = 'not json\n{"role":"user","content":"valid"}\nalso not json';
    const transcript = parseCursorJsonl(malformed, "/test.jsonl", "t2");
    expect(transcript.messages).toHaveLength(1);
  });

  it("parseMarkdown extracts user/assistant turns", async () => {
    const { parseMarkdown } = await import("../../conversations/parser.js");
    const md = `# User: Don't use rescue Exception\n\n# Assistant: Correct, use StandardError`;
    const transcript = parseMarkdown(md, "/test.md", "t3");
    expect(transcript.messages.length).toBeGreaterThanOrEqual(1);
  });
});
