/**
 * classifyBranch — unit tests for sync-level branch classification.
 *
 * Tests the pure function that decides whether a git sync event should:
 *   "skip"        — demo/experimental branches, never touch the KB
 *   "lightweight" — feature branches, mark affected cards stale only
 *   "full"        — main/staging/epic branches, full cross-repo propagation
 */

import { describe, it, expect } from "vitest";
import { classifyBranch, type SyncLevel } from "../../cli/sync.js";

function expectLevel(branch: string, expected: SyncLevel) {
  expect(classifyBranch(branch), `branch "${branch}"`).toBe(expected);
}

describe("classifyBranch — demo branches (skip)", () => {
  it("skips demo/ prefix", () => expectLevel("demo/orlando", "skip"));
  it("skips demo/anything", () => expectLevel("demo/Q1-2025", "skip"));
  it("skips bare 'demo'", () => expectLevel("demo", "skip"));
  it("skips -demo suffix", () => expectLevel("feature/payment-demo", "skip"));
  it("skips _demo suffix", () => expectLevel("release/v2_demo", "skip"));
  it("skips /demo/ in the middle", () => expectLevel("client/demo/onboarding", "skip"));
  it("is case-insensitive for demo", () => expectLevel("Demo/Orlando", "skip"));
});

describe("classifyBranch — main integration branches (full)", () => {
  it("main", () => expectLevel("main", "full"));
  it("master", () => expectLevel("master", "full"));
  it("develop", () => expectLevel("develop", "full"));
  it("development", () => expectLevel("development", "full"));
  it("staging", () => expectLevel("staging", "full"));
  it("stage", () => expectLevel("stage", "full"));
  it("production", () => expectLevel("production", "full"));
  it("prod", () => expectLevel("prod", "full"));
  it("release", () => expectLevel("release", "full"));
  it("release/ prefix", () => expectLevel("release/v2.1.0", "full"));
  it("hotfix/ prefix", () => expectLevel("hotfix/critical-auth-bug", "full"));
  it("epic/ prefix (cross-repo)", () => expectLevel("epic/orlando_demo_phase2", "full"));
  it("epic/ is full even though name contains demo", () => expectLevel("epic/demo-redesign", "full"));
});

describe("classifyBranch — feature branches (lightweight)", () => {
  it("feature/", () => expectLevel("feature/ENG-123-billing-filter", "lightweight"));
  it("fix/", () => expectLevel("fix/auth-token-expiry", "lightweight"));
  it("bugfix/", () => expectLevel("bugfix/null-pointer", "lightweight"));
  it("chore/", () => expectLevel("chore/upgrade-rails", "lightweight"));
  it("refactor/", () => expectLevel("refactor/extract-service", "lightweight"));
  it("hotfix/ under maintenance (not release/)", () => {
    // hotfix/ → full (production-bound), not lightweight
    expectLevel("hotfix/stripe-webhook", "full");
  });
});

describe("classifyBranch — unknown branches (lightweight default)", () => {
  it("short arbitrary name defaults to lightweight", () => expectLevel("orlando", "lightweight"));
  it("numeric branch", () => expectLevel("1234", "lightweight"));
  it("custom team branch pattern", () => expectLevel("BB-456-cpt-codes", "lightweight"));
  it("empty string", () => expectLevel("", "lightweight"));
});

describe("classifyBranch — real-world biobridge branches", () => {
  // These branch names come from the team's actual git history
  it("demo/orlando → skip (never updates KB)", () => expectLevel("demo/orlando", "skip"));
  it("main → full invalidation + cross-repo", () => expectLevel("main", "full"));
  it("feature/billing-filter-ENG-234 → lightweight", () => expectLevel("feature/billing-filter-ENG-234", "lightweight"));
  it("epic/v2-redesign → full (cross-repo epic)", () => expectLevel("epic/v2-redesign", "full"));
  it("staging → full", () => expectLevel("staging", "full"));
  it("release/v1.8.0 → full", () => expectLevel("release/v1.8.0", "full"));
});
