/**
 * Team Rules — DB-level unit tests.
 *
 * Tests the core logic of creating, querying, patching, deleting, and
 * importing team rules. Uses a real in-memory SQLite DB (no mocks).
 * Does NOT test the Fastify HTTP layer — that belongs in integration tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb, type TestDb } from "../helpers/db.js";

// ---------------------------------------------------------------------------
// Helpers — mirror the logic in dashboard-api.ts insertTeamRule
// ---------------------------------------------------------------------------

interface RuleInput {
  name: string;
  description: string;
  severity?: string;
  scope?: string | null;
  created_by?: string | null;
}

interface RuleRow {
  id: string;
  name: string;
  description: string;
  severity: string;
  scope: string | null;
  enabled: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function insertRule(db: TestDb, input: RuleInput): RuleRow {
  const validSeverities = ["error", "warning", "info"];
  const severity = validSeverities.includes(input.severity ?? "") ? input.severity! : "warning";
  const id = `rule_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  db.prepare(`
    INSERT INTO team_rules (id, name, description, severity, scope, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, input.name.trim(), input.description.trim(), severity, input.scope ?? null, input.created_by ?? null);
  return db.prepare("SELECT * FROM team_rules WHERE id = ?").get(id) as RuleRow;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("team_rules — CRUD", () => {
  let db: TestDb;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  describe("insert", () => {
    it("creates a rule with all fields", () => {
      const rule = insertRule(db, {
        name: "No one-line methods",
        description: "Methods must use do/end blocks.",
        severity: "warning",
        scope: "rails",
        created_by: "leo",
      });

      expect(rule.name).toBe("No one-line methods");
      expect(rule.description).toBe("Methods must use do/end blocks.");
      expect(rule.severity).toBe("warning");
      expect(rule.scope).toBe("rails");
      expect(rule.created_by).toBe("leo");
      expect(rule.enabled).toBe(1);
    });

    it("defaults severity to 'warning' for unknown values", () => {
      const rule = insertRule(db, { name: "Test", description: "Test desc", severity: "critical" });
      expect(rule.severity).toBe("warning");
    });

    it("accepts all valid severities", () => {
      for (const sev of ["error", "warning", "info"] as const) {
        const rule = insertRule(db, { name: `Rule ${sev}`, description: "desc", severity: sev });
        expect(rule.severity).toBe(sev);
      }
    });

    it("allows null scope (applies to all repos)", () => {
      const rule = insertRule(db, { name: "Global rule", description: "Global desc", scope: null });
      expect(rule.scope).toBeNull();
    });

    it("generates a unique ID per rule", () => {
      const r1 = insertRule(db, { name: "Rule A", description: "A" });
      const r2 = insertRule(db, { name: "Rule B", description: "B" });
      expect(r1.id).not.toBe(r2.id);
    });
  });

  describe("query", () => {
    beforeEach(() => {
      insertRule(db, { name: "Error rule", description: "blocks", severity: "error" });
      insertRule(db, { name: "Warning rule", description: "advisory", severity: "warning" });
      insertRule(db, { name: "Info rule", description: "info", severity: "info" });
    });

    it("lists all rules", () => {
      const rules = db.prepare("SELECT * FROM team_rules").all() as RuleRow[];
      expect(rules).toHaveLength(3);
    });

    it("filters enabled rules only", () => {
      const all = db.prepare("SELECT * FROM team_rules").all() as RuleRow[];
      // Disable one
      db.prepare("UPDATE team_rules SET enabled = 0 WHERE name = 'Info rule'").run();

      const enabled = db.prepare("SELECT * FROM team_rules WHERE enabled = 1").all() as RuleRow[];
      expect(enabled).toHaveLength(2);
      expect(enabled.every((r) => r.enabled === 1)).toBe(true);
    });

    it("orders by severity (error first, then warning, then info)", () => {
      const rules = db.prepare(`
        SELECT * FROM team_rules
        ORDER BY CASE severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END
      `).all() as RuleRow[];

      expect(rules[0]!.severity).toBe("error");
      expect(rules[1]!.severity).toBe("warning");
      expect(rules[2]!.severity).toBe("info");
    });
  });

  describe("patch / toggle", () => {
    it("updates enabled to 0", () => {
      const rule = insertRule(db, { name: "Patchable", description: "desc" });
      db.prepare("UPDATE team_rules SET enabled = 0 WHERE id = ?").run(rule.id);
      const updated = db.prepare("SELECT enabled FROM team_rules WHERE id = ?").get(rule.id) as { enabled: number };
      expect(updated.enabled).toBe(0);
    });

    it("updates description", () => {
      const rule = insertRule(db, { name: "Old", description: "old desc" });
      db.prepare("UPDATE team_rules SET description = ? WHERE id = ?").run("new desc", rule.id);
      const updated = db.prepare("SELECT description FROM team_rules WHERE id = ?").get(rule.id) as { description: string };
      expect(updated.description).toBe("new desc");
    });

    it("normalizes enabled boolean to integer (truthy → 1, falsy → 0)", () => {
      const rule = insertRule(db, { name: "Bool test", description: "desc" });
      // Simulate what the PATCH handler does
      const val = true ? 1 : 0;
      db.prepare("UPDATE team_rules SET enabled = ? WHERE id = ?").run(val, rule.id);
      const row = db.prepare("SELECT enabled FROM team_rules WHERE id = ?").get(rule.id) as { enabled: number };
      expect(row.enabled).toBe(1);
    });
  });

  describe("delete", () => {
    it("removes the rule", () => {
      const rule = insertRule(db, { name: "To delete", description: "bye" });
      db.prepare("DELETE FROM team_rules WHERE id = ?").run(rule.id);
      const gone = db.prepare("SELECT * FROM team_rules WHERE id = ?").get(rule.id);
      expect(gone).toBeUndefined();
    });

    it("returns 0 changes for non-existent id", () => {
      const info = db.prepare("DELETE FROM team_rules WHERE id = ?").run("does-not-exist");
      expect(info.changes).toBe(0);
    });
  });
});

describe("team_rules — bulk import logic", () => {
  let db: TestDb;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it("inserts multiple rules and skips duplicates by name (case-insensitive)", () => {
    // Pre-insert one
    insertRule(db, { name: "Existing Rule", description: "exists" });

    const candidates = [
      { name: "Existing Rule", description: "duplicate — should skip" },
      { name: "New Rule A", description: "brand new" },
      { name: "New Rule B", description: "also new", severity: "error" },
    ];

    const existing = (db.prepare("SELECT LOWER(name) as n FROM team_rules").all() as { n: string }[]).map((r) => r.n);
    const inserted: string[] = [];
    const skipped: string[] = [];

    for (const candidate of candidates) {
      if (existing.includes(candidate.name.toLowerCase())) {
        skipped.push(candidate.name);
        continue;
      }
      insertRule(db, candidate);
      inserted.push(candidate.name);
      existing.push(candidate.name.toLowerCase());
    }

    expect(inserted).toEqual(["New Rule A", "New Rule B"]);
    expect(skipped).toEqual(["Existing Rule"]);

    const total = (db.prepare("SELECT COUNT(*) as n FROM team_rules").get() as { n: number }).n;
    expect(total).toBe(3); // 1 pre-existing + 2 new
  });

  it("ignores rules missing name or description", () => {
    const before = (db.prepare("SELECT COUNT(*) as n FROM team_rules").get() as { n: number }).n;

    const malformed = [
      { name: "", description: "no name" },
      { name: "No description", description: "" },
    ];

    const errors: string[] = [];
    for (const r of malformed) {
      if (!r.name.trim() || !r.description.trim()) {
        errors.push(`missing name or description`);
        continue;
      }
      insertRule(db, r);
    }

    expect(errors).toHaveLength(2);
    const after = (db.prepare("SELECT COUNT(*) as n FROM team_rules").get() as { n: number }).n;
    expect(after).toBe(before);
  });
});

describe("rule_checks — storage", () => {
  let db: TestDb;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it("stores a check result with violations JSON", () => {
    const violations = [
      {
        rule_id: "rule_abc",
        rule_name: "No one-line methods",
        severity: "warning",
        file: "app/models/user.rb",
        line: 42,
        snippet: "def full_name = \"#{first} #{last}\"",
        explanation: "Method body on same line as def",
      },
    ];

    db.prepare(`
      INSERT INTO rule_checks (id, repo, branch, base_branch, violations, checked_rules, files_checked, passed, triggered_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("chk-1", "biobridge-backend", "feature/test", "main", JSON.stringify(violations), 5, 12, 0, "ui");

    const row = db.prepare("SELECT * FROM rule_checks WHERE id = ?").get("chk-1") as {
      repo: string; branch: string; passed: number; violations: string; triggered_by: string;
    };

    expect(row.repo).toBe("biobridge-backend");
    expect(row.branch).toBe("feature/test");
    expect(row.passed).toBe(0);
    expect(row.triggered_by).toBe("ui");

    const parsed = JSON.parse(row.violations) as typeof violations;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.rule_name).toBe("No one-line methods");
    expect(parsed[0]!.file).toBe("app/models/user.rb");
  });

  it("retrieves checks ordered by checked_at desc", () => {
    db.prepare("INSERT INTO rule_checks (id, repo, branch, checked_at) VALUES (?, ?, ?, ?)")
      .run("chk-old", "repo", "main", "2025-01-01T00:00:00");
    db.prepare("INSERT INTO rule_checks (id, repo, branch, checked_at) VALUES (?, ?, ?, ?)")
      .run("chk-new", "repo", "main", "2025-06-01T00:00:00");

    const rows = db.prepare("SELECT id FROM rule_checks ORDER BY checked_at DESC").all() as { id: string }[];
    expect(rows[0]!.id).toBe("chk-new");
    expect(rows[1]!.id).toBe("chk-old");
  });
});
