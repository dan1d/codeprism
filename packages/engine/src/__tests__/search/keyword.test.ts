/**
 * Tests for keyword.ts — FTS5 query sanitization and keyword search.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sanitizeFts5Query } from "../../search/keyword.js";
import { createTestDb, insertTestCard, type TestDb } from "../helpers/db.js";

let testDb: TestDb;

vi.mock("../../db/connection.js", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

const { keywordSearch } = await import("../../search/keyword.js");

// ---------------------------------------------------------------------------
// keywordSearch — requires real FTS5 in the test DB
// ---------------------------------------------------------------------------

function seedFts(db: TestDb) {
  db.exec("INSERT INTO cards_fts(cards_fts) VALUES('rebuild')");
}

describe("keywordSearch", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  it("returns empty array when query is empty", () => {
    expect(keywordSearch("")).toEqual([]);
  });

  it("returns empty array when query only has single-char tokens", () => {
    expect(keywordSearch("a b c")).toEqual([]);
  });

  it("finds a card by title keyword", () => {
    const id = insertTestCard(testDb, {
      flow: "auth",
      title: "Patient Authorization flow",
      content: "Handles patient pre-authorization",
      card_type: "flow",
    });
    seedFts(testDb);

    const results = keywordSearch("Authorization");
    expect(results.some((r) => r.cardId === id)).toBe(true);
  });

  it("finds a card by content keyword", () => {
    const id = insertTestCard(testDb, {
      flow: "billing",
      title: "Billing flow",
      content: "Generates invoices and handles payment processing",
      card_type: "flow",
    });
    seedFts(testDb);

    const results = keywordSearch("invoices payment");
    expect(results.some((r) => r.cardId === id)).toBe(true);
  });

  it("returns results with negative BM25 rank (lower = better match)", () => {
    insertTestCard(testDb, {
      flow: "test",
      title: "Patient Remote Check",
      content: "Manages remote patient check-ups and pre-authorization",
      card_type: "flow",
    });
    seedFts(testDb);

    const results = keywordSearch("patient remote");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.rank).toBeLessThan(0);
  });

  it("returns empty array when no cards match", () => {
    insertTestCard(testDb, { title: "Billing", content: "Payment processing" });
    seedFts(testDb);

    const results = keywordSearch("completelyrandom12345");
    expect(results).toEqual([]);
  });

  it("respects the limit parameter", () => {
    for (let i = 0; i < 5; i++) {
      insertTestCard(testDb, {
        id: `card-kw-${i}`,
        title: `Patient flow ${i}`,
        content: "Authorization handling for patients",
        flow: "patient",
      });
    }
    seedFts(testDb);

    const results = keywordSearch("patient authorization", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });
});

describe("sanitizeFts5Query", () => {
  it("produces unquoted tokens joined by OR (enables Porter stemming)", () => {
    const result = sanitizeFts5Query("patient authorization");
    // Tokens must NOT be quoted — quoted tokens bypass the Porter stemmer
    expect(result).toBe("patient OR authorization");
    expect(result).not.toContain('"');
  });

  it("strips HTTP URLs", () => {
    const result = sanitizeFts5Query(
      "see https://linear.app/gobiobridge/issue/ENG-755 for details",
    );
    expect(result).not.toContain("linear.app");
    expect(result).not.toContain("https");
    expect(result).toContain("see");
  });

  it("strips HTTPS URLs leaving no tokens", () => {
    const result = sanitizeFts5Query("https://example.com/path/to/page");
    // URL stripped entirely, no tokens remain
    expect(result).toBe("");
  });

  it("strips special characters, keeps underscores", () => {
    const result = sanitizeFts5Query("pre_authorization (modal) 'form'");
    expect(result).not.toContain("(");
    expect(result).not.toContain(")");
    expect(result).not.toContain("'");
    expect(result).toContain("pre_authorization");
  });

  it("filters out single-character tokens", () => {
    const result = sanitizeFts5Query("a b patient c");
    expect(result).toBe("patient");
  });

  it("returns empty string for empty input", () => {
    expect(sanitizeFts5Query("")).toBe("");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(sanitizeFts5Query("   ")).toBe("");
  });

  it("returns empty string when only single-char tokens remain", () => {
    expect(sanitizeFts5Query("a b c")).toBe("");
  });

  it("removes FTS5 boolean operators (AND, OR, NOT, NEAR) to prevent injection", () => {
    const result = sanitizeFts5Query("patient AND authorization OR billing NOT hub");
    // AND, OR, NOT must be stripped — they would break FTS5 if unquoted
    expect(result).not.toContain("AND");
    expect(result).not.toContain("OR OR"); // no double OR
    expect(result).not.toContain("NOT");
    expect(result).toContain("patient");
    expect(result).toContain("authorization");
    expect(result).toContain("billing");
    expect(result).toContain("hub");
  });

  it("limits to 30 tokens", () => {
    const words = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ");
    const result = sanitizeFts5Query(words);
    const tokens = result.split(" OR ");
    expect(tokens.length).toBe(30);
  });

  it("handles PascalCase identifiers without crashing", () => {
    const result = sanitizeFts5Query("PatientAuthorization RemoteCheck");
    expect(result).toContain("PatientAuthorization");
    expect(result).toContain("RemoteCheck");
  });

  it("handles ticket descriptions with mixed content", () => {
    const raw =
      "Ability to Add Multiple Remote Authorizations in DEMO https://linear.app/ticket/ENG-756";
    const result = sanitizeFts5Query(raw);
    expect(result).not.toContain("linear.app");
    expect(result).toContain("Ability");
    expect(result).toContain("Remote");
    // OR (the operator) should be stripped; "Authorizations", "Multiple" etc. should remain
    expect(result.split(" OR ").every((t) => t.trim().length > 1)).toBe(true);
  });

  it("strips dot notation (object.property becomes two tokens)", () => {
    const result = sanitizeFts5Query("schema.rb routes.rb");
    expect(result).toContain("schema");
    expect(result).toContain("rb");
  });
});
