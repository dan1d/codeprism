import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db.js";

let testDb: TestDb;

vi.mock("../../db/connection.js", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("../../llm/provider.js", () => ({
  createLLMProvider: () => null,
}));

const { insertTeamRule, listRules, updateRule, deleteRule, listRuleChecks, importRules } =
  await import("../../services/rules.js");

describe("rules service", () => {
  beforeEach(() => { testDb = createTestDb(); });
  afterEach(() => { testDb.close(); });

  describe("insertTeamRule", () => {
    it("creates a rule with all fields", () => {
      const rule = insertTeamRule({
        name: "No one-line methods",
        description: "Methods must use do/end blocks.",
        severity: "warning",
        scope: "rails",
        created_by: "dev",
      }) as { id: string; name: string; severity: string; scope: string; created_by: string; enabled: number };

      expect(rule.name).toBe("No one-line methods");
      expect(rule.severity).toBe("warning");
      expect(rule.scope).toBe("rails");
      expect(rule.created_by).toBe("dev");
      expect(rule.enabled).toBe(1);
    });

    it("defaults severity to warning for unknown values", () => {
      const rule = insertTeamRule({ name: "Test", description: "desc", severity: "critical" }) as { severity: string };
      expect(rule.severity).toBe("warning");
    });

    it("accepts all valid severities", () => {
      for (const sev of ["error", "warning", "info"]) {
        const rule = insertTeamRule({ name: `Rule ${sev}`, description: "desc", severity: sev }) as { severity: string };
        expect(rule.severity).toBe(sev);
      }
    });

    it("generates unique IDs", () => {
      const r1 = insertTeamRule({ name: "A", description: "a", severity: "info" }) as { id: string };
      const r2 = insertTeamRule({ name: "B", description: "b", severity: "info" }) as { id: string };
      expect(r1.id).not.toBe(r2.id);
    });
  });

  describe("listRules", () => {
    it("returns empty array for fresh DB", () => {
      expect(listRules()).toEqual([]);
    });

    it("orders by severity then name", () => {
      insertTeamRule({ name: "Info rule", description: "info", severity: "info" });
      insertTeamRule({ name: "Error rule", description: "blocks", severity: "error" });
      insertTeamRule({ name: "Warning rule", description: "warn", severity: "warning" });

      const rules = listRules() as Array<{ severity: string }>;
      expect(rules[0]!.severity).toBe("error");
      expect(rules[1]!.severity).toBe("warning");
      expect(rules[2]!.severity).toBe("info");
    });
  });

  describe("updateRule", () => {
    it("updates name and description", () => {
      const created = insertTeamRule({ name: "Old", description: "old", severity: "info" }) as { id: string };
      const updated = updateRule(created.id, { name: "New", description: "new" }) as { name: string; description: string } | null;
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe("New");
      expect(updated!.description).toBe("new");
    });

    it("returns null for non-existent rule", () => {
      expect(updateRule("nope", { name: "X" })).toBeNull();
    });

    it("returns undefined when no updatable fields provided", () => {
      const created = insertTeamRule({ name: "Test", description: "d", severity: "info" }) as { id: string };
      expect(updateRule(created.id, { foo: "bar" })).toBeUndefined();
    });

    it("normalizes enabled boolean to integer", () => {
      const created = insertTeamRule({ name: "T", description: "d", severity: "info" }) as { id: string };
      const updated = updateRule(created.id, { enabled: false }) as { enabled: number };
      expect(updated.enabled).toBe(0);
    });
  });

  describe("deleteRule", () => {
    it("deletes existing rule and returns true", () => {
      const created = insertTeamRule({ name: "Delete me", description: "d", severity: "info" }) as { id: string };
      expect(deleteRule(created.id)).toBe(true);
      expect(listRules()).toHaveLength(0);
    });

    it("returns false for non-existent rule", () => {
      expect(deleteRule("nope")).toBe(false);
    });
  });

  describe("listRuleChecks", () => {
    it("returns empty array for fresh DB", () => {
      expect(listRuleChecks()).toEqual([]);
    });

    it("returns checks ordered by checked_at desc", () => {
      testDb.prepare("INSERT INTO rule_checks (id, repo, branch, checked_at) VALUES (?, ?, ?, ?)").run("old", "r", "main", "2025-01-01");
      testDb.prepare("INSERT INTO rule_checks (id, repo, branch, checked_at) VALUES (?, ?, ?, ?)").run("new", "r", "main", "2025-06-01");

      const checks = listRuleChecks() as Array<{ id: string }>;
      expect(checks[0]!.id).toBe("new");
    });

    it("filters by repo", () => {
      testDb.prepare("INSERT INTO rule_checks (id, repo, branch) VALUES (?, ?, ?)").run("c1", "repoA", "main");
      testDb.prepare("INSERT INTO rule_checks (id, repo, branch) VALUES (?, ?, ?)").run("c2", "repoB", "main");

      const checks = listRuleChecks("repoA") as Array<{ id: string }>;
      expect(checks).toHaveLength(1);
      expect(checks[0]!.id).toBe("c1");
    });
  });

  describe("importRules", () => {
    it("inserts new rules and skips duplicates", () => {
      insertTeamRule({ name: "Existing", description: "already exists", severity: "info" });

      const result = importRules([
        { name: "Existing", description: "duplicate" },
        { name: "New Rule", description: "brand new", severity: "error" },
      ]);

      expect(result.inserted).toEqual(["New Rule"]);
      expect(result.skipped).toEqual(["Existing"]);
      expect(result.errors).toHaveLength(0);
    });

    it("reports errors for rules missing name or description", () => {
      const result = importRules([
        { name: "", description: "no name" },
        { name: "No desc", description: "" },
      ]);

      expect(result.errors).toHaveLength(2);
      expect(result.inserted).toHaveLength(0);
    });
  });
});
