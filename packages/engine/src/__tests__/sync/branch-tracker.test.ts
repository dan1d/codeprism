/**
 * Tests for sync/branch-tracker.ts — branch lifecycle recording and role detection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db.js";

let testDb: TestDb;

vi.mock("../../db/connection.js", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

const { recordBranchEvent, detectBranchRoles } = await import(
  "../../sync/branch-tracker.js"
);

function record(
  branch: string,
  eventType: string,
  repo = "test-repo",
  fromBranch?: string,
) {
  recordBranchEvent({ repo, branch, eventType, fromBranch });
}

describe("recordBranchEvent", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  it("inserts a branch event row", () => {
    record("main", "push");

    const row = testDb
      .prepare("SELECT * FROM branch_events WHERE branch = 'main'")
      .get() as { repo: string; event_type: string } | undefined;

    expect(row).toBeDefined();
    expect(row!.repo).toBe("test-repo");
    expect(row!.event_type).toBe("push");
  });

  it("records fromBranch and commitSha correctly", () => {
    recordBranchEvent({
      repo: "repo-a",
      branch: "main",
      eventType: "merge",
      fromBranch: "feature/auth",
      commitSha: "abc123",
      devId: "dev-1",
    });

    const row = testDb
      .prepare("SELECT from_branch, commit_sha, dev_id FROM branch_events WHERE branch = 'main'")
      .get() as { from_branch: string; commit_sha: string; dev_id: string };

    expect(row.from_branch).toBe("feature/auth");
    expect(row.commit_sha).toBe("abc123");
    expect(row.dev_id).toBe("dev-1");
  });

  it("allows null fromBranch and commitSha", () => {
    record("staging", "push");

    const row = testDb
      .prepare("SELECT from_branch, commit_sha FROM branch_events WHERE branch = 'staging'")
      .get() as { from_branch: null; commit_sha: null };

    expect(row.from_branch).toBeNull();
    expect(row.commit_sha).toBeNull();
  });
});

describe("detectBranchRoles", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  it("returns empty array when no events recorded", () => {
    const roles = detectBranchRoles("test-repo");
    expect(roles).toEqual([]);
  });

  it("classifies 'main' branch as role=main", () => {
    record("main", "push");
    record("main", "merge");

    const roles = detectBranchRoles("test-repo");
    const mainRole = roles.find((r) => r.branch === "main");

    expect(mainRole).toBeDefined();
    expect(mainRole!.role).toBe("main");
    expect(mainRole!.confidence).toBeGreaterThan(0.9);
  });

  it("classifies 'master' as role=main", () => {
    record("master", "push");

    const roles = detectBranchRoles("test-repo");
    expect(roles.find((r) => r.branch === "master")?.role).toBe("main");
  });

  it("classifies 'staging' as role=staging", () => {
    record("staging", "push");

    const roles = detectBranchRoles("test-repo");
    expect(roles.find((r) => r.branch === "staging")?.role).toBe("staging");
  });

  it("classifies 'develop' as role=development", () => {
    record("develop", "push");

    const roles = detectBranchRoles("test-repo");
    expect(roles.find((r) => r.branch === "develop")?.role).toBe("development");
  });

  it("classifies demo/* branches as role=demo", () => {
    record("demo/orlando", "push");

    const roles = detectBranchRoles("test-repo");
    expect(roles.find((r) => r.branch === "demo/orlando")?.role).toBe("demo");
  });

  it("classifies feature/* branches as role=feature", () => {
    record("feature/batch-auth", "push");

    const roles = detectBranchRoles("test-repo");
    expect(roles.find((r) => r.branch === "feature/batch-auth")?.role).toBe("feature");
  });

  it("classifies fix/* branches as role=feature", () => {
    record("fix/null-pointer", "push");

    const roles = detectBranchRoles("test-repo");
    expect(roles.find((r) => r.branch === "fix/null-pointer")?.role).toBe("feature");
  });

  it("computes mergesPerWeek correctly", () => {
    // Insert 7 merge events for 'main' (1 per day over a week)
    for (let i = 0; i < 7; i++) {
      record("main", "merge");
    }

    const roles = detectBranchRoles("test-repo");
    const mainRole = roles.find((r) => r.branch === "main");
    expect(mainRole?.mergesPerWeek).toBeGreaterThan(0);
  });

  it("only considers events within the last 30 days", () => {
    // Insert an event with a very old timestamp manually
    testDb
      .prepare(
        `INSERT INTO branch_events (repo, branch, event_type, timestamp)
         VALUES (?, ?, ?, datetime('now', '-60 days'))`,
      )
      .run("test-repo", "ghost-branch", "push");

    const roles = detectBranchRoles("test-repo");
    expect(roles.find((r) => r.branch === "ghost-branch")).toBeUndefined();
  });

  it("falls back: unclassified branch with most merges older than 7 days → role=main (low confidence)", () => {
    // Insert events for a custom-named branch 8+ days ago
    testDb
      .prepare(
        `INSERT INTO branch_events (repo, branch, event_type, timestamp)
         VALUES (?, ?, ?, datetime('now', '-8 days'))`,
      )
      .run("test-repo", "release-2.0", "push");

    testDb
      .prepare(
        `INSERT INTO branch_events (repo, branch, event_type, timestamp)
         VALUES (?, ?, ?, datetime('now', '-8 days'))`,
      )
      .run("test-repo", "release-2.0", "merge");

    const roles = detectBranchRoles("test-repo");
    const releaseRole = roles.find((r) => r.branch === "release-2.0");

    expect(releaseRole).toBeDefined();
    expect(releaseRole!.role).toBe("main");
    expect(releaseRole!.confidence).toBe(0.6);
  });

  it("falls back: unclassified branch newer than 7 days → role=unknown (low confidence)", () => {
    // Insert a very recent event for an unclassified branch
    testDb
      .prepare(
        `INSERT INTO branch_events (repo, branch, event_type, timestamp)
         VALUES (?, ?, ?, datetime('now', '-1 days'))`,
      )
      .run("test-repo", "release-3.0", "push");

    testDb
      .prepare(
        `INSERT INTO branch_events (repo, branch, event_type, timestamp)
         VALUES (?, ?, ?, datetime('now', '-1 days'))`,
      )
      .run("test-repo", "release-3.0", "merge");

    const roles = detectBranchRoles("test-repo");
    const releaseRole = roles.find((r) => r.branch === "release-3.0");

    expect(releaseRole).toBeDefined();
    expect(releaseRole!.role).toBe("unknown");
    expect(releaseRole!.confidence).toBe(0.3);
  });

  it("does not return roles from other repos", () => {
    record("main", "push", "other-repo");

    const roles = detectBranchRoles("test-repo");
    expect(roles).toHaveLength(0);
  });
});
