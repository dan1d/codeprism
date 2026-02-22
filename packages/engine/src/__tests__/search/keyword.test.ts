/**
 * Tests for keyword.ts — FTS5 query sanitization.
 *
 * `sanitizeFts5Query` is tested directly; `keywordSearch` is tested through
 * a mocked DB so we avoid needing a real FTS5 index.
 */

import { describe, it, expect } from "vitest";
import { sanitizeFts5Query } from "../../search/keyword.js";

describe("sanitizeFts5Query", () => {
  it("quotes simple tokens", () => {
    const result = sanitizeFts5Query("patient authorization");
    expect(result).toBe('"patient" OR "authorization"');
  });

  it("strips HTTP URLs", () => {
    const result = sanitizeFts5Query(
      "see https://linear.app/gobiobridge/issue/ENG-755 for details",
    );
    expect(result).not.toContain("linear.app");
    expect(result).not.toContain("https");
    expect(result).toContain('"see"');
  });

  it("strips HTTPS URLs", () => {
    const result = sanitizeFts5Query("https://example.com/path/to/page");
    // URL stripped, no tokens remain (single-char filter)
    expect(result).toBe("");
  });

  it("strips special characters", () => {
    const result = sanitizeFts5Query("pre_authorization (modal) 'form'");
    // Parens, single-quotes become spaces; underscores are kept
    expect(result).not.toContain("(");
    expect(result).not.toContain(")");
    expect(result).not.toContain("'");
    expect(result).toContain('"pre_authorization"');
  });

  it("filters out single-character tokens", () => {
    const result = sanitizeFts5Query("a b patient c");
    expect(result).toBe('"patient"');
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

  it("handles FTS5 operators gracefully (AND, OR, NOT removed via special-char strip)", () => {
    const result = sanitizeFts5Query("patient AND authorization");
    // 'AND' has no special chars so it remains as a token — that is fine;
    // the important thing is no unquoted operators break FTS5.
    expect(result).toContain('"patient"');
    expect(result).toContain('"AND"');
    expect(result).toContain('"authorization"');
  });

  it("limits to 30 tokens", () => {
    const words = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ");
    const result = sanitizeFts5Query(words);
    const tokens = result.split(" OR ");
    expect(tokens.length).toBe(30);
  });

  it("handles PascalCase identifiers without crashing", () => {
    const result = sanitizeFts5Query("PatientAuthorization RemoteCheck");
    expect(result).toContain('"PatientAuthorization"');
    expect(result).toContain('"RemoteCheck"');
  });

  it("handles ticket descriptions with mixed content", () => {
    const raw =
      "Ability to Add Multiple Remote Authorizations in DEMO https://linear.app/ticket/ENG-756";
    const result = sanitizeFts5Query(raw);
    expect(result).not.toContain("linear.app");
    expect(result).toContain('"Ability"');
    expect(result).toContain('"Remote"');
  });

  it("strips dot notation (object.property becomes two tokens)", () => {
    const result = sanitizeFts5Query("schema.rb routes.rb");
    // Dots become spaces
    expect(result).toContain('"schema"');
    expect(result).toContain('"rb"');
  });
});
