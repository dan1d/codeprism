import { describe, it, expect } from "vitest";
import {
  truncateContent,
  shortenPath,
  formatCards,
  extractEntityNames,
  prioritizeCards,
  type CardSummary,
} from "../../services/search.js";

describe("search service — pure utilities", () => {
  describe("truncateContent", () => {
    it("returns content unchanged if within limit", () => {
      expect(truncateContent("line1\nline2\nline3", 5)).toBe("line1\nline2\nline3");
    });

    it("truncates long content with marker", () => {
      const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");
      const result = truncateContent(lines, 10);
      expect(result).toContain("_(truncated)_");
      expect(result.split("\n").length).toBeLessThan(50);
    });
  });

  describe("shortenPath", () => {
    it("shortens from repo root", () => {
      const result = shortenPath("/Users/dev/project/myapp/src/components/Button.tsx");
      expect(result).toContain("src/");
      expect(result).toContain("Button.tsx");
    });

    it("returns last 3 segments for generic paths", () => {
      const result = shortenPath("/a/b/c/d/e/f.ts");
      expect(result).toBe("d/e/f.ts");
    });

    it("returns short paths unchanged", () => {
      expect(shortenPath("a/b.ts")).toBe("a/b.ts");
    });
  });

  describe("formatCards", () => {
    it("formats cards with titles and content", () => {
      const cards: CardSummary[] = [
        { id: "1", flow: "auth", title: "Auth Flow", content: "Login flow", source_files: "[]", card_type: "flow", specificity_score: 0.5, usage_count: 0, identifiers: "" },
      ];
      const result = formatCards(cards);
      expect(result).toContain("Auth Flow");
      expect(result).toContain("Login flow");
      expect(result).toContain("auth");
    });

    it("shows stale warning for stale cards", () => {
      const cards: CardSummary[] = [
        { id: "1", flow: "auth", title: "Old", content: "stale", source_files: "[]", card_type: "flow", specificity_score: 0.5, usage_count: 0, identifiers: "", stale: 1 },
      ];
      const result = formatCards(cards);
      expect(result).toContain("needs verification");
    });

    it("shows verified indicator", () => {
      const cards: CardSummary[] = [
        { id: "1", flow: "auth", title: "Verified", content: "v", source_files: "[]", card_type: "flow", specificity_score: 0.5, usage_count: 0, identifiers: "", verified_at: "2025-01-01", verification_count: 3 },
      ];
      const result = formatCards(cards);
      expect(result).toContain("verified (3x)");
    });

    it("truncates when exceeding line budget", () => {
      const longContent = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
      const cards: CardSummary[] = Array.from({ length: 10 }, (_, i) => ({
        id: String(i), flow: "f", title: `Card ${i}`, content: longContent, source_files: "[]", card_type: "flow", specificity_score: 0.5, usage_count: 0, identifiers: "",
      }));
      const result = formatCards(cards, 50);
      expect(result).toContain("omitted for brevity");
    });
  });

  describe("extractEntityNames", () => {
    it("extracts snake_case identifiers", () => {
      const result = extractEntityNames("Check the user_profile table and order_items");
      expect(result).toContain("user_profile");
      expect(result).toContain("order_items");
    });

    it("extracts PascalCase identifiers", () => {
      const result = extractEntityNames("The UserProfile component renders OrderItems");
      expect(result).toContain("UserProfile");
      expect(result).toContain("OrderItems");
    });

    it("strips URLs before extraction", () => {
      const result = extractEntityNames("See https://example.com/user_profile for details about user_settings");
      expect(result).toContain("user_settings");
      expect(result.some((e) => e.includes("example.com"))).toBe(false);
    });

    it("returns at most 5 entities", () => {
      const result = extractEntityNames("user_a user_b user_c user_d user_e user_f user_g");
      expect(result.length).toBeLessThanOrEqual(5);
    });

    it("deduplicates case-insensitively", () => {
      const result = extractEntityNames("User user USER");
      const lowerSet = new Set(result.map((e) => e.toLowerCase()));
      expect(lowerSet.size).toBe(result.length);
    });
  });

  describe("prioritizeCards", () => {
    it("sorts model cards before flow, flow before hub", () => {
      const cards: CardSummary[] = [
        { id: "1", flow: "f", title: "Hub", content: "", source_files: "[]", card_type: "hub", specificity_score: 0.5, usage_count: 0, identifiers: "" },
        { id: "2", flow: "f", title: "Model", content: "", source_files: "[]", card_type: "model", specificity_score: 0.5, usage_count: 0, identifiers: "" },
        { id: "3", flow: "f", title: "Flow", content: "", source_files: "[]", card_type: "flow", specificity_score: 0.5, usage_count: 0, identifiers: "" },
      ];
      const sorted = prioritizeCards(cards);
      expect(sorted[0]!.card_type).toBe("model");
      expect(sorted[1]!.card_type).toBe("flow");
      expect(sorted[2]!.card_type).toBe("hub");
    });
  });
});
