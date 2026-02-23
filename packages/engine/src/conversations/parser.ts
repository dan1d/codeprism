/**
 * Transcript parsers for Cursor JSONL, Claude Code JSONL, and plain Markdown formats.
 *
 * Each parser normalizes the raw format into a uniform `Transcript` structure
 * that the anonymizer and extractor can consume.
 */

import { readFile } from "node:fs/promises";

export interface TranscriptMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp?: string;
}

export interface Transcript {
  id: string;
  filePath: string;
  sourceType: "cursor" | "claude_code" | "markdown";
  messages: TranscriptMessage[];
  /** Raw full text for evidence_quote validation */
  rawText: string;
}

// ---------------------------------------------------------------------------
// Cursor JSONL — each line is a JSON object with role + content
// ---------------------------------------------------------------------------

export function parseCursorJsonl(rawText: string, filePath: string, id: string): Transcript {
  const messages: TranscriptMessage[] = [];

  for (const line of rawText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;

      // Cursor agent transcript format: { type, message: { role, content } }
      if (obj["type"] === "say" && obj["message"] && typeof obj["message"] === "object") {
        const msg = obj["message"] as Record<string, unknown>;
        const role = (msg["role"] as string | undefined) ?? "assistant";
        const content = extractContent(msg["content"]);
        if (content) {
          messages.push({
            role: normalizeRole(role),
            content,
            timestamp: msg["ts"] as string | undefined,
          });
        }
        continue;
      }

      // Simpler format: { role, content }
      if (obj["role"] && obj["content"]) {
        const content = extractContent(obj["content"]);
        if (content) {
          messages.push({
            role: normalizeRole(obj["role"] as string),
            content,
            timestamp: obj["timestamp"] as string | undefined,
          });
        }
      }
    } catch {
      // Non-JSON line — skip
    }
  }

  return { id, filePath, sourceType: "cursor", messages, rawText };
}

// ---------------------------------------------------------------------------
// Claude Code JSONL — similar structure but slightly different field names
// ---------------------------------------------------------------------------

export function parseClaudeCodeJsonl(rawText: string, filePath: string, id: string): Transcript {
  const messages: TranscriptMessage[] = [];

  for (const line of rawText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      // Claude Code format: { type: "message", role, content: [...] | string }
      if ((obj["type"] === "message" || obj["role"]) && obj["content"]) {
        const content = extractContent(obj["content"]);
        if (content) {
          messages.push({
            role: normalizeRole(obj["role"] as string | undefined ?? "assistant"),
            content,
          });
        }
      }
    } catch {
      // Non-JSON line — skip
    }
  }

  return { id, filePath, sourceType: "claude_code", messages, rawText };
}

// ---------------------------------------------------------------------------
// Markdown — treat H2 or quoted lines as conversation turns
// ---------------------------------------------------------------------------

export function parseMarkdown(rawText: string, filePath: string, id: string): Transcript {
  const messages: TranscriptMessage[] = [];
  let currentRole: "user" | "assistant" = "assistant";
  let currentLines: string[] = [];

  function flush() {
    const content = currentLines.join("\n").trim();
    if (content) messages.push({ role: currentRole, content });
    currentLines = [];
  }

  for (const line of rawText.split("\n")) {
    const userMatch = line.match(/^#+\s*(user|human):/i) ?? line.match(/^>\s*(user|human):/i);
    const assistantMatch = line.match(/^#+\s*(assistant|ai|claude|cursor):/i) ?? line.match(/^>\s*(assistant|ai):/i);

    if (userMatch) {
      flush();
      currentRole = "user";
      currentLines.push(line.replace(/^[#>]+\s*\w+:\s*/i, ""));
    } else if (assistantMatch) {
      flush();
      currentRole = "assistant";
      currentLines.push(line.replace(/^[#>]+\s*\w+:\s*/i, ""));
    } else {
      currentLines.push(line);
    }
  }
  flush();

  return { id, filePath, sourceType: "markdown", messages, rawText };
}

// ---------------------------------------------------------------------------
// Auto-detect format and parse
// ---------------------------------------------------------------------------

export async function parseTranscriptFile(filePath: string, id: string): Promise<Transcript | null> {
  let rawText: string;
  try {
    rawText = await readFile(filePath, "utf-8");
  } catch {
    return null;
  }

  if (filePath.endsWith(".jsonl")) {
    // Distinguish Cursor vs Claude Code by looking at the first non-empty line
    const firstLine = rawText.split("\n").find((l) => l.trim());
    if (firstLine) {
      try {
        const obj = JSON.parse(firstLine) as Record<string, unknown>;
        if (obj["type"] === "say" || (typeof obj["message"] === "object" && obj["message"] !== null)) {
          return parseCursorJsonl(rawText, filePath, id);
        }
      } catch {
        // not valid JSON
      }
    }
    return parseClaudeCodeJsonl(rawText, filePath, id);
  }

  if (filePath.endsWith(".md") || filePath.endsWith(".txt")) {
    return parseMarkdown(rawText, filePath, id);
  }

  // Try JSONL as fallback
  return parseCursorJsonl(rawText, filePath, id);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function extractContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c): c is { type: string; text?: string } => typeof c === "object" && c !== null)
      .map((c) => (c.type === "text" ? (c.text ?? "") : ""))
      .join(" ")
      .trim();
  }
  return "";
}

function normalizeRole(role: string): "user" | "assistant" | "tool" {
  const lower = role.toLowerCase();
  if (lower === "user" || lower === "human") return "user";
  if (lower === "tool" || lower === "function") return "tool";
  return "assistant";
}
