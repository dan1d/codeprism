/**
 * rulesForDiff — unit tests for rule scope filtering.
 *
 * `rulesForDiff` is the pure function that decides which team rules apply to a
 * given git diff based on the rule's `scope` field and the file extensions
 * present in the diff. It is extracted here as a black-box test without
 * touching the DB or LLM.
 */

import { describe, it, expect } from "vitest";
import type { TeamRule } from "../../db/schema.js";

// ---------------------------------------------------------------------------
// Mirror the SCOPE_EXTENSIONS map and rulesForDiff from cli/check.ts.
// We test the logic directly without importing the CLI module (which has
// top-level side effects via execSync).
// ---------------------------------------------------------------------------

const SCOPE_EXTENSIONS: Record<string, string[]> = {
  rails:   [".rb", ".erb", ".rake"],
  react:   [".tsx", ".jsx", ".ts", ".js"],
  vue:     [".vue", ".ts", ".js"],
  go:      [".go"],
  python:  [".py"],
  django:  [".py"],
  nextjs:  [".tsx", ".ts", ".jsx", ".js"],
  angular: [".ts", ".html"],
  laravel: [".php"],
  spring:  [".java", ".kt"],
};

function rulesForDiff(rules: TeamRule[], diffFiles: string[]): TeamRule[] {
  return rules.filter((rule) => {
    if (!rule.scope) return true;
    const exts = SCOPE_EXTENSIONS[rule.scope.toLowerCase()] ?? [];
    if (exts.length === 0) return true;
    return diffFiles.some((f) => exts.some((ext) => f.endsWith(ext)));
  });
}

function makeRule(overrides: Partial<TeamRule> & { id: string; name: string }): TeamRule {
  return {
    description: "A test rule",
    severity: "warning",
    scope: null,
    enabled: 1,
    created_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("rulesForDiff — scope filtering", () => {
  describe("null scope (global rules)", () => {
    it("always includes a rule with null scope", () => {
      const rules = [makeRule({ id: "r1", name: "Global rule", scope: null })];
      const files = ["app/models/user.go", "some.py"];
      expect(rulesForDiff(rules, files)).toHaveLength(1);
    });

    it("includes null-scope rule even with empty diff files", () => {
      const rules = [makeRule({ id: "r1", name: "Global rule", scope: null })];
      expect(rulesForDiff(rules, [])).toHaveLength(1);
    });
  });

  describe("rails scope", () => {
    const railsRule = makeRule({ id: "r1", name: "No one-liners", scope: "rails" });

    it("matches .rb files", () => {
      expect(rulesForDiff([railsRule], ["app/models/user.rb"])).toHaveLength(1);
    });

    it("matches .erb files", () => {
      expect(rulesForDiff([railsRule], ["app/views/index.html.erb"])).toHaveLength(1);
    });

    it("matches .rake files", () => {
      expect(rulesForDiff([railsRule], ["lib/tasks/setup.rake"])).toHaveLength(1);
    });

    it("does NOT match .go files for a rails-scoped rule", () => {
      expect(rulesForDiff([railsRule], ["internal/service/handler.go"])).toHaveLength(0);
    });

    it("does NOT match .tsx files for a rails-scoped rule", () => {
      expect(rulesForDiff([railsRule], ["src/components/App.tsx"])).toHaveLength(0);
    });

    it("case-insensitive scope match (Rails → rails)", () => {
      const upperRule = makeRule({ id: "r2", name: "Upper scope", scope: "Rails" });
      expect(rulesForDiff([upperRule], ["app/models/user.rb"])).toHaveLength(1);
    });
  });

  describe("react scope", () => {
    const reactRule = makeRule({ id: "r2", name: "No prop drilling", scope: "react" });

    it("matches .tsx", () => expect(rulesForDiff([reactRule], ["src/App.tsx"])).toHaveLength(1));
    it("matches .jsx", () => expect(rulesForDiff([reactRule], ["src/App.jsx"])).toHaveLength(1));
    it("matches .ts", () => expect(rulesForDiff([reactRule], ["src/utils.ts"])).toHaveLength(1));
    it("matches .js", () => expect(rulesForDiff([reactRule], ["src/index.js"])).toHaveLength(1));
    it("does NOT match .rb", () => expect(rulesForDiff([reactRule], ["app/models/user.rb"])).toHaveLength(0));
    it("does NOT match .go", () => expect(rulesForDiff([reactRule], ["cmd/main.go"])).toHaveLength(0));
  });

  describe("go scope", () => {
    const goRule = makeRule({ id: "r3", name: "No naked returns", scope: "go" });
    it("matches .go", () => expect(rulesForDiff([goRule], ["cmd/main.go"])).toHaveLength(1));
    it("does NOT match .ts", () => expect(rulesForDiff([goRule], ["src/index.ts"])).toHaveLength(0));
  });

  describe("unknown scope (fallback to include)", () => {
    it("includes a rule with an unrecognized scope to avoid silent drops", () => {
      const unknownRule = makeRule({ id: "r4", name: "Mystery scope", scope: "cobol" });
      expect(rulesForDiff([unknownRule], ["program.cbl"])).toHaveLength(1);
    });
  });

  describe("mixed rule set", () => {
    const railsRule = makeRule({ id: "r1", name: "Rails rule", scope: "rails" });
    const reactRule = makeRule({ id: "r2", name: "React rule", scope: "react" });
    const globalRule = makeRule({ id: "r3", name: "Global rule", scope: null });

    it("returns only matching-scope rules for a pure Ruby diff", () => {
      const result = rulesForDiff([railsRule, reactRule, globalRule], ["app/models/order.rb"]);
      expect(result.map((r) => r.id)).toEqual(expect.arrayContaining(["r1", "r3"]));
      expect(result.find((r) => r.id === "r2")).toBeUndefined();
    });

    it("returns only matching-scope rules for a pure TS diff", () => {
      const result = rulesForDiff([railsRule, reactRule, globalRule], ["src/pages/Orders.tsx"]);
      expect(result.map((r) => r.id)).toEqual(expect.arrayContaining(["r2", "r3"]));
      expect(result.find((r) => r.id === "r1")).toBeUndefined();
    });

    it("returns all rules for a mixed diff (rb + tsx)", () => {
      const result = rulesForDiff([railsRule, reactRule, globalRule], [
        "app/models/order.rb",
        "src/pages/Orders.tsx",
      ]);
      expect(result).toHaveLength(3);
    });

    it("returns only the global rule for an empty diff", () => {
      const result = rulesForDiff([railsRule, reactRule, globalRule], []);
      expect(result.map((r) => r.id)).toEqual(["r3"]);
    });
  });
});
