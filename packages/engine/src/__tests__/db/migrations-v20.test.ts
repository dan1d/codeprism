/**
 * Schema — team_rules + rule_checks tables.
 *
 * Verifies that the initial migration creates the correct schema for the
 * Team Rules feature, including indexes, column constraints, and default values.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { runMigrations } from "../../db/migrations.js";

function createRawDb(): Database.Database {
  const db = new Database(":memory:");
  try { sqliteVec.load(db); } catch { /* ok */ }
  return db;
}

function cols(db: Database.Database, table: string): string[] {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((r: unknown) => (r as { name: string }).name);
}

function indexes(db: Database.Database): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[]).map((r) => r.name);
}

describe("schema — team_rules + rule_checks", () => {
  let db: Database.Database;

  beforeEach(() => { db = createRawDb(); });
  afterEach(() => { db.close(); });

  it("runs without error on a fresh DB", () => {
    expect(() => runMigrations(db)).not.toThrow();
  });

  it("creates team_rules table with all required columns", () => {
    runMigrations(db);
    const c = cols(db, "team_rules");
    expect(c).toContain("id");
    expect(c).toContain("name");
    expect(c).toContain("description");
    expect(c).toContain("severity");
    expect(c).toContain("scope");
    expect(c).toContain("enabled");
    expect(c).toContain("created_by");
    expect(c).toContain("created_at");
    expect(c).toContain("updated_at");
  });

  it("creates rule_checks table with all required columns", () => {
    runMigrations(db);
    const c = cols(db, "rule_checks");
    expect(c).toContain("id");
    expect(c).toContain("repo");
    expect(c).toContain("branch");
    expect(c).toContain("base_branch");
    expect(c).toContain("commit_sha");
    expect(c).toContain("violations");
    expect(c).toContain("checked_rules");
    expect(c).toContain("files_checked");
    expect(c).toContain("passed");
    expect(c).toContain("triggered_by");
    expect(c).toContain("checked_at");
  });

  it("creates the expected indexes", () => {
    runMigrations(db);
    const idx = indexes(db);
    expect(idx).toContain("idx_team_rules_enabled");
    expect(idx).toContain("idx_rule_checks_repo_checked_at");
  });

  it("defaults severity to 'warning'", () => {
    runMigrations(db);
    db.prepare("INSERT INTO team_rules (id, name, description) VALUES (?, ?, ?)")
      .run("r1", "My Rule", "Do something");
    const row = db.prepare("SELECT severity FROM team_rules WHERE id = 'r1'").get() as { severity: string };
    expect(row.severity).toBe("warning");
  });

  it("defaults enabled to 1", () => {
    runMigrations(db);
    db.prepare("INSERT INTO team_rules (id, name, description) VALUES (?, ?, ?)")
      .run("r2", "My Rule 2", "Do something");
    const row = db.prepare("SELECT enabled FROM team_rules WHERE id = 'r2'").get() as { enabled: number };
    expect(row.enabled).toBe(1);
  });

  it("defaults rule_checks.passed to 1 and violations to '[]'", () => {
    runMigrations(db);
    db.prepare("INSERT INTO rule_checks (id, repo, branch) VALUES (?, ?, ?)")
      .run("chk1", "my-repo", "main");
    const row = db.prepare("SELECT passed, violations FROM rule_checks WHERE id = 'chk1'").get() as { passed: number; violations: string };
    expect(row.passed).toBe(1);
    expect(row.violations).toBe("[]");
  });

  it("is idempotent — running migrations twice doesn't error", () => {
    runMigrations(db);
    expect(() => runMigrations(db)).not.toThrow();
  });

  it("records version 1 in schema_version", () => {
    runMigrations(db);
    const versions = db.prepare("SELECT version FROM schema_version ORDER BY version").all().map((r: unknown) => (r as { version: number }).version);
    expect(versions).toContain(1);
  });
});
