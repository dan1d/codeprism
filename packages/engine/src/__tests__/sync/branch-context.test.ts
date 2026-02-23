/**
 * extractBranchContext — unit tests.
 *
 * Covers every real-world branch pattern the team uses, including
 * the explicit "no ticket ID" case where branch words become the context hint.
 */

import { describe, it, expect } from "vitest";
import { extractBranchContext, type BranchContext } from "../../cli/sync.js";

function ctx(branch: string, prevHead?: string): BranchContext {
  return extractBranchContext(branch, prevHead);
}

describe("extractBranchContext — ticket ID extraction", () => {
  it("extracts Jira-style ticket ID", () => {
    const c = ctx("feature/ENG-123-billing-filter");
    expect(c.ticketId).toBe("ENG-123");
  });

  it("extracts ticket ID from anywhere in the branch", () => {
    expect(ctx("fix/BB-456-cpt-codes").ticketId).toBe("BB-456");
    expect(ctx("BB-789-auth-refactor").ticketId).toBe("BB-789");
  });

  it("normalises ticket ID to uppercase", () => {
    expect(ctx("feature/eng-123-foo").ticketId).toBe("ENG-123");
  });

  it("returns null when no ticket ID is present", () => {
    expect(ctx("add-some-weird-thing").ticketId).toBeNull();
    expect(ctx("main").ticketId).toBeNull();
    expect(ctx("epic/orlando_demo").ticketId).toBeNull();
    expect(ctx("demo/Q1").ticketId).toBeNull();
  });
});

describe("extractBranchContext — context hint (no-ticket-ID case)", () => {
  it("humanises bare branch name without ticket", () => {
    expect(ctx("add-some-weird-thing").contextHint).toBe("add some weird thing");
  });

  it("strips feature/ prefix before humanising", () => {
    expect(ctx("feature/billing-filter").contextHint).toBe("billing filter");
  });

  it("strips ticket ID from hint text", () => {
    // ticket ID goes into ticketId field; hint is the human part only
    expect(ctx("feature/ENG-123-billing-filter").contextHint).toBe("billing filter");
  });

  it("handles underscore separators", () => {
    expect(ctx("fix/null_pointer_error").contextHint).toBe("null pointer error");
  });

  it("handles mixed separators", () => {
    expect(ctx("chore/upgrade-rails_7").contextHint).toBe("upgrade rails 7");
  });

  it("produces contextHint for epic branch", () => {
    expect(ctx("epic/orlando_demo").contextHint).toBe("orlando demo");
  });

  it("produces contextHint for bare word branch (no prefix, no ticket)", () => {
    // e.g. git checkout -b add-some-weird-thing
    const c = ctx("add-some-weird-thing");
    expect(c.contextHint).toBe("add some weird thing");
    expect(c.ticketId).toBeNull();
  });
});

describe("extractBranchContext — epic parent detection", () => {
  it("detects epic parent when prevHead is a branch name", () => {
    const c = ctx("add-some-weird-thing", "epic/orlando_demo");
    expect(c.epicBranch).toBe("orlando demo");
  });

  it("does not detect epic when prevHead is a plain sha", () => {
    const c = ctx("add-some-weird-thing", "a1b2c3d");
    expect(c.epicBranch).toBeNull();
  });

  it("does not detect epic when prevHead is a feature branch", () => {
    const c = ctx("add-weird", "feature/ENG-123-billing");
    expect(c.epicBranch).toBeNull();
  });

  it("uses the branch itself as epic when it starts with epic/", () => {
    const c = ctx("epic/orlando_demo");
    expect(c.epicBranch).toBe("orlando demo");
  });

  it("humanises multi-word epic names with underscores", () => {
    const c = ctx("add-thing", "epic/billing_v2_redesign");
    expect(c.epicBranch).toBe("billing v2 redesign");
  });

  it("is case-insensitive for epic/ prefix", () => {
    const c = ctx("my-feature", "Epic/Big-Project");
    expect(c.epicBranch).toBe("Big Project");
  });
});

describe("extractBranchContext — real-world biobridge patterns", () => {
  it("git checkout -b add-some-weird-thing (from epic/orlando_demo)", () => {
    const c = ctx("add-some-weird-thing", "epic/orlando_demo");
    expect(c.ticketId).toBeNull();
    expect(c.contextHint).toBe("add some weird thing");
    expect(c.epicBranch).toBe("orlando demo");
    expect(c.syncLevel).toBe("lightweight");
  });

  it("feature/ENG-234-billing-filter on its own", () => {
    const c = ctx("feature/ENG-234-billing-filter");
    expect(c.ticketId).toBe("ENG-234");
    expect(c.contextHint).toBe("billing filter");
    expect(c.epicBranch).toBeNull();
    expect(c.syncLevel).toBe("lightweight");
  });

  it("main branch has no ticket and no epic", () => {
    const c = ctx("main");
    expect(c.ticketId).toBeNull();
    expect(c.contextHint).toBe("main");
    expect(c.epicBranch).toBeNull();
    expect(c.syncLevel).toBe("full");
  });

  it("demo/orlando is skipped", () => {
    const c = ctx("demo/orlando");
    expect(c.syncLevel).toBe("skip");
    // context hint is still computed (for display), but sync is skipped
    expect(c.contextHint).toBe("orlando");
  });

  it("epic/v2-redesign is full and its own epic", () => {
    const c = ctx("epic/v2-redesign");
    expect(c.syncLevel).toBe("full");
    expect(c.epicBranch).toBe("v2 redesign");
  });
});
