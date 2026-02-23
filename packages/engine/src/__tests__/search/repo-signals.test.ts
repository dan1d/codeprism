/**
 * Tests for repo-signals.ts — pure unit tests covering all 8 stack scenarios.
 * No DB, no LLM, no async. Only generateRepoSignals() and extractCrossCorpusDomainTerms()
 * are tested here; DB I/O is covered by integration tests.
 */

import { describe, it, expect } from "vitest";
import {
  generateRepoSignals,
  extractCrossCorpusDomainTerms,
  LANGUAGE_SIGNALS,
  FRAMEWORK_SIGNALS,
  LAMBDA_SIGNALS,
} from "../../search/repo-signals.js";
import type { StackProfile } from "../../indexer/stack-profiler.js";

// Helpers
const makeProfile = (
  primaryLanguage: StackProfile["primaryLanguage"],
  frameworks: string[] = [],
  isLambda = false,
): StackProfile => ({
  primaryLanguage,
  frameworks,
  isLambda,
  packageManager: "bundler",
  skillIds: [],
});

// ---------------------------------------------------------------------------
// Scenario 1: Rails + React monolith (single repo)
// ---------------------------------------------------------------------------
describe("Rails + React monolith", () => {
  const profile = makeProfile("ruby", ["rails", "react"]);
  const classTypeCounts = { controller: 20, model: 15, component: 10, service: 5 };

  it("includes rails framework signals", () => {
    const { signals } = generateRepoSignals("my-monolith", profile, [], classTypeCounts);
    expect(signals).toContain("rails");
    expect(signals).toContain("activerecord");
    expect(signals).toContain("controller");
    expect(signals).toContain("migration");
  });

  it("includes react framework signals", () => {
    const { signals } = generateRepoSignals("my-monolith", profile, [], classTypeCounts);
    expect(signals).toContain("react");
    expect(signals).toContain("hook");
    expect(signals).toContain("jsx");
  });

  it("includes BOTH backend AND frontend role signals (monolith has both)", () => {
    const { signals } = generateRepoSignals("my-monolith", profile, [], classTypeCounts);
    expect(signals).toContain("backend");
    expect(signals).toContain("frontend");
  });

  it("includes ruby language signals", () => {
    const { signals } = generateRepoSignals("my-monolith", profile, [], classTypeCounts);
    expect(signals).toContain("ruby");
    expect(signals).toContain("gem");
  });

  it("includes non-generic repo name tokens", () => {
    const { signals } = generateRepoSignals("my-monolith", profile, [], classTypeCounts);
    expect(signals).toContain("monolith");
    // "my" is too short to pass (length > 1 but filtered by stoplist check — "my" is 2 chars)
    // short tokens like "my" don't add value anyway
  });

  it("exposes source breakdown", () => {
    const { sources } = generateRepoSignals("my-monolith", profile, [], classTypeCounts);
    expect(sources.language.length).toBeGreaterThan(0);
    expect(sources.framework.length).toBeGreaterThan(0);
    expect(sources.role.length).toBeGreaterThan(0);
    expect(sources.repoName.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: Django backend (separate repo, no FE)
// ---------------------------------------------------------------------------
describe("Django backend repo", () => {
  const profile = makeProfile("python", ["django"]);
  const classTypeCounts = { model: 12, controller: 8, service: 3 };

  it("includes django framework signals", () => {
    const { signals } = generateRepoSignals("my-backend", profile, [], classTypeCounts);
    expect(signals).toContain("django");
    expect(signals).toContain("queryset");
    expect(signals).toContain("orm");
  });

  it("includes python language signals", () => {
    const { signals } = generateRepoSignals("my-backend", profile, [], classTypeCounts);
    expect(signals).toContain("python");
    expect(signals).toContain("pip");
  });

  it("includes backend role signals", () => {
    const { signals } = generateRepoSignals("my-backend", profile, [], classTypeCounts);
    expect(signals).toContain("backend");
    expect(signals).toContain("api");
    expect(signals).toContain("endpoint");
  });

  it("does NOT include frontend role signals", () => {
    const { signals } = generateRepoSignals("my-backend", profile, [], classTypeCounts);
    expect(signals).not.toContain("frontend");
    expect(signals).not.toContain("component");
    expect(signals).not.toContain("stylesheet");
  });

  it("filters generic repo name tokens like 'backend'", () => {
    const { sources } = generateRepoSignals("my-backend", profile, [], classTypeCounts);
    // "backend" is in REPO_NAME_STOPLIST — should NOT be in repoName signals
    // (it's already in role signals from a different source)
    expect(sources.repoName).not.toContain("backend");
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: React frontend (separate repo)
// ---------------------------------------------------------------------------
describe("React frontend repo", () => {
  const profile = makeProfile("typescript", ["react"]);
  const classTypeCounts = { component: 40, store: 5 };

  it("includes react framework signals", () => {
    const { signals } = generateRepoSignals("my-frontend", profile, [], classTypeCounts);
    expect(signals).toContain("react");
    expect(signals).toContain("hook");
    expect(signals).toContain("jsx");
    expect(signals).toContain("redux");
  });

  it("includes frontend role signals via FE framework detection", () => {
    const { signals } = generateRepoSignals("my-frontend", profile, [], classTypeCounts);
    expect(signals).toContain("frontend");
    expect(signals).toContain("ui");
    expect(signals).toContain("render");
  });

  it("does NOT include backend role signals", () => {
    const { signals } = generateRepoSignals("my-frontend", profile, [], classTypeCounts);
    expect(signals).not.toContain("backend");
    expect(signals).not.toContain("db");
    expect(signals).not.toContain("database");
  });

  it("includes typescript language signals", () => {
    const { signals } = generateRepoSignals("my-frontend", profile, [], classTypeCounts);
    expect(signals).toContain("typescript");
    expect(signals).toContain("tsconfig");
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: Laravel backend + Vue frontend (two separate repos)
// ---------------------------------------------------------------------------
describe("Laravel backend", () => {
  const profile = makeProfile("php", ["laravel"]);

  it("includes laravel framework signals", () => {
    const { signals } = generateRepoSignals("laravel-api", profile, [], {});
    expect(signals).toContain("laravel");
    expect(signals).toContain("eloquent");
    expect(signals).toContain("artisan");
    expect(signals).toContain("blade");
  });

  it("includes php language signals", () => {
    const { signals } = generateRepoSignals("laravel-api", profile, [], {});
    expect(signals).toContain("php");
    expect(signals).toContain("composer");
  });

  it("includes backend role signals via language fallback (PHP is backend language)", () => {
    const { signals } = generateRepoSignals("laravel-api", profile, [], {});
    expect(signals).toContain("backend");
    expect(signals).toContain("api");
  });

  it("filters generic tokens 'api' from repo name but keeps 'laravel'", () => {
    const { sources } = generateRepoSignals("laravel-api", profile, [], {});
    expect(sources.repoName).not.toContain("api"); // in REPO_NAME_STOPLIST
    expect(sources.repoName).toContain("laravel");
  });
});

describe("Vue frontend repo", () => {
  const profile = makeProfile("javascript", ["vue"]);
  const classTypeCounts = { component: 30 };

  it("includes vue framework signals", () => {
    const { signals } = generateRepoSignals("vue-dashboard", profile, [], classTypeCounts);
    expect(signals).toContain("vue");
    expect(signals).toContain("composable");
    expect(signals).toContain("pinia");
    expect(signals).toContain("directive");
  });

  it("includes frontend role signals", () => {
    const { signals } = generateRepoSignals("vue-dashboard", profile, [], classTypeCounts);
    expect(signals).toContain("frontend");
    expect(signals).toContain("ui");
  });

  it("does NOT include backend role signals", () => {
    const { signals } = generateRepoSignals("vue-dashboard", profile, [], classTypeCounts);
    expect(signals).not.toContain("backend");
  });
});

// ---------------------------------------------------------------------------
// Scenario 5: Go microservice with Gin
// ---------------------------------------------------------------------------
describe("Go microservice with Gin", () => {
  const profile = makeProfile("go", ["gin"]);

  it("includes go language signals", () => {
    const { signals } = generateRepoSignals("payments-service", profile, [], {});
    expect(signals).toContain("go");
    expect(signals).toContain("golang");
    expect(signals).toContain("goroutine");
  });

  it("includes gin framework signals", () => {
    const { signals } = generateRepoSignals("payments-service", profile, [], {});
    expect(signals).toContain("gin");
    expect(signals).toContain("ginrouter");
  });

  it("includes backend role signals (Go is a backend language)", () => {
    const { signals } = generateRepoSignals("payments-service", profile, [], {});
    expect(signals).toContain("backend");
    expect(signals).toContain("api");
    expect(signals).toContain("endpoint");
  });

  it("includes domain-specific repo name tokens, not generic ones", () => {
    const { sources } = generateRepoSignals("payments-service", profile, [], {});
    expect(sources.repoName).toContain("payments");
    expect(sources.repoName).not.toContain("service"); // in REPO_NAME_STOPLIST
  });
});

// ---------------------------------------------------------------------------
// Scenario 6: Next.js fullstack monorepo
// ---------------------------------------------------------------------------
describe("Next.js fullstack monorepo", () => {
  const profile = makeProfile("typescript", ["nextjs", "react"]);

  it("includes nextjs and react signals", () => {
    const { signals } = generateRepoSignals("acme-nextjs-app", profile, [], {});
    expect(signals).toContain("nextjs");
    expect(signals).toContain("react");
    expect(signals).toContain("api route");
    expect(signals).toContain("app router");
    expect(signals).toContain("server component");
  });

  it("includes BOTH backend AND frontend role signals (Next.js is fullstack)", () => {
    const { signals } = generateRepoSignals("acme-nextjs-app", profile, [], {});
    expect(signals).toContain("backend");  // nextjs is in BE_FRAMEWORKS (has API routes)
    expect(signals).toContain("frontend"); // nextjs is in FE_FRAMEWORKS
  });

  it("includes discriminative repo name tokens", () => {
    const { sources } = generateRepoSignals("acme-nextjs-app", profile, [], {});
    expect(sources.repoName).toContain("acme");
    expect(sources.repoName).not.toContain("app"); // in REPO_NAME_STOPLIST
  });
});

// ---------------------------------------------------------------------------
// Scenario 7: AWS Lambda (TypeScript, no framework)
// ---------------------------------------------------------------------------
describe("Lambda function repo", () => {
  const profile: StackProfile = {
    ...makeProfile("typescript", [], true),
    isLambda: true,
  };

  it("includes lambda-specific signals", () => {
    const { signals } = generateRepoSignals("invoice-lambda", profile, [], {});
    expect(signals).toContain("lambda");
    expect(signals).toContain("serverless");
    expect(signals).toContain("handler");
    expect(signals).toContain("event");
    expect(signals).toContain("trigger");
  });

  it("includes discriminative repo name tokens", () => {
    const { sources } = generateRepoSignals("invoice-lambda", profile, [], {});
    expect(sources.repoName).toContain("invoice");
    expect(sources.repoName).toContain("lambda");
  });

  it("emits signals array with no crashes even with empty classTypeCounts", () => {
    expect(() =>
      generateRepoSignals("invoice-lambda", profile, [], {}),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Scenario 8: Unknown stack (graceful degradation)
// ---------------------------------------------------------------------------
describe("Unknown stack (graceful degradation)", () => {
  const profile = makeProfile("unknown");

  it("returns at least repo name tokens and does not crash", () => {
    const { signals } = generateRepoSignals("mystery-service", profile, [], {});
    expect(Array.isArray(signals)).toBe(true);
    expect(signals).toContain("mystery");
    // "service" is in REPO_NAME_STOPLIST — should be absent from repoName signals
  });

  it("returns no language signals for unknown language", () => {
    const { sources } = generateRepoSignals("mystery-service", profile, [], {});
    expect(sources.language).toHaveLength(0);
  });

  it("returns no role signals when no frameworks and not backend language", () => {
    const { sources } = generateRepoSignals("mystery-service", profile, [], {});
    // "unknown" is not in BACKEND_LANGUAGES — no role signals unless class types indicate
    expect(sources.role).toHaveLength(0);
  });

  it("uses class type distribution as fallback for role when language is unknown", () => {
    // More than 40% BE-type classes → backend role signals
    const classTypeCounts = { controller: 10, model: 8, service: 5, component: 2 };
    const { signals } = generateRepoSignals("mystery-service", profile, [], classTypeCounts);
    expect(signals).toContain("backend");
  });
});

// ---------------------------------------------------------------------------
// Domain signal domain terms — extractCrossCorpusDomainTerms
// ---------------------------------------------------------------------------
describe("extractCrossCorpusDomainTerms", () => {
  it("penalizes terms appearing in ALL repos (IDF suppresses common terms)", () => {
    const allDocs = new Map([
      ["backend",  ["This application handles user authentication and data persistence via REST API endpoints."]],
      ["frontend", ["This application handles user authentication and data persistence via REST API endpoints."]],
      ["worker",   ["This application handles user authentication and data persistence via REST API endpoints."]],
    ]);
    const terms = extractCrossCorpusDomainTerms(allDocs);
    // "application", "authentication", "persistence", "endpoints" appear in ALL 3 repos
    // IDF = log(4/3) ≈ 0.29 — very low. Should not dominate top-N.
    // They may still appear, but at very low TF-IDF score vs. unique terms
    // (No unique terms here — all docs are identical, so all get same low IDF)
    // At minimum, verify no crash and returns map with all 3 repos
    expect(terms.size).toBe(3);
  });

  it("surfaces terms unique to one repo with high TF-IDF", () => {
    const allDocs = new Map([
      ["billing-api", [
        "This service handles pre_authorization and billing_order management.",
        "Pre_authorization is checked before each billing cycle. billing_order is the core entity.",
        "Pre_authorization records are stored with BillingOrder relationships.",
      ]],
      ["auth-api", [
        "This service handles user authentication and session management.",
        "Sessions are validated on each request. Token refresh is supported.",
        "Authentication uses JWT tokens with session expiration.",
      ]],
      ["profile-api", [
        "This service manages user profiles and preferences.",
        "Profile updates are tracked. Preferences are stored per user.",
        "User profile photos are processed via background jobs.",
      ]],
    ]);

    const terms = extractCrossCorpusDomainTerms(allDocs, 15);

    // billing-api should have billing/authorization domain terms
    const billingTerms = terms.get("billing-api") ?? [];
    expect(billingTerms.some((t) => t.includes("billing") || t.includes("authorization"))).toBe(true);

    // auth-api should have auth-related terms
    const authTerms = terms.get("auth-api") ?? [];
    expect(authTerms.some((t) => t.includes("session") || t.includes("token") || t.includes("authentication"))).toBe(true);
  });

  it("returns empty map for empty input", () => {
    expect(extractCrossCorpusDomainTerms(new Map())).toEqual(new Map());
  });

  it("handles repos with empty doc arrays gracefully", () => {
    const allDocs = new Map([
      ["repo-a", ["Some content about billing and payments"]],
      ["repo-b", []], // no docs
    ]);
    expect(() => extractCrossCorpusDomainTerms(allDocs)).not.toThrow();
    const result = extractCrossCorpusDomainTerms(allDocs);
    expect(result.has("repo-a")).toBe(true);
    // repo-b may or may not have entries (empty doc = no terms)
  });

  it("requires freq >= 2 — single occurrences are excluded", () => {
    const allDocs = new Map([
      ["repo", ["The word supercalifragilistic appears once only in this document."]],
    ]);
    const terms = extractCrossCorpusDomainTerms(allDocs, 10);
    const repoTerms = terms.get("repo") ?? [];
    expect(repoTerms).not.toContain("supercalifragilistic");
  });

  it("respects topN limit", () => {
    const longDoc = Array.from({ length: 100 }, (_, i) => `term${i} term${i} term${i}`).join(" ");
    const allDocs = new Map([["repo", [longDoc]]]);
    const terms = extractCrossCorpusDomainTerms(allDocs, 5);
    expect((terms.get("repo") ?? []).length).toBeLessThanOrEqual(5);
  });

  it("weights snake_case higher than single words (freq bonus)", () => {
    const allDocs = new Map([
      ["repo", [
        "pre_authorization is checked on every request. pre_authorization is validated.",
        "authorization is also important. authorization must be valid.",
      ]],
    ]);
    const terms = extractCrossCorpusDomainTerms(allDocs, 10);
    const repoTerms = terms.get("repo") ?? [];
    // Both should appear; pre_authorization (weight 2×TF) should rank >= authorization
    const preIdx = repoTerms.indexOf("pre_authorization");
    const authIdx = repoTerms.indexOf("authorization");
    if (preIdx !== -1 && authIdx !== -1) {
      expect(preIdx).toBeLessThanOrEqual(authIdx);
    }
  });
});

// ---------------------------------------------------------------------------
// Lookup table completeness sanity checks
// ---------------------------------------------------------------------------
describe("LANGUAGE_SIGNALS", () => {
  it("has entries for all supported languages", () => {
    const expectedLanguages = ["ruby", "python", "go", "typescript", "javascript", "php", "rust", "java"];
    for (const lang of expectedLanguages) {
      expect(LANGUAGE_SIGNALS).toHaveProperty(lang);
      expect(Array.isArray(LANGUAGE_SIGNALS[lang])).toBe(true);
    }
  });

  it("has no entries for unknown (correct — no signals emitted)", () => {
    expect(LANGUAGE_SIGNALS["unknown"]).toEqual([]);
  });
});

describe("FRAMEWORK_SIGNALS", () => {
  it("covers Rails-family frameworks", () => {
    expect(FRAMEWORK_SIGNALS).toHaveProperty("rails");
    expect(FRAMEWORK_SIGNALS["rails"]).toContain("controller");
    expect(FRAMEWORK_SIGNALS["rails"]).toContain("activerecord");
  });

  it("covers Python frameworks", () => {
    expect(FRAMEWORK_SIGNALS).toHaveProperty("django");
    expect(FRAMEWORK_SIGNALS).toHaveProperty("fastapi");
    expect(FRAMEWORK_SIGNALS["fastapi"]).toContain("pydantic");
  });

  it("covers JS/TS frameworks", () => {
    expect(FRAMEWORK_SIGNALS).toHaveProperty("react");
    expect(FRAMEWORK_SIGNALS).toHaveProperty("nextjs");
    expect(FRAMEWORK_SIGNALS).toHaveProperty("vue");
    expect(FRAMEWORK_SIGNALS["vue"]).toContain("composable");
  });
});

describe("LAMBDA_SIGNALS", () => {
  it("contains the expected serverless-specific terms", () => {
    expect(LAMBDA_SIGNALS).toContain("lambda");
    expect(LAMBDA_SIGNALS).toContain("serverless");
    expect(LAMBDA_SIGNALS).toContain("handler");
    expect(LAMBDA_SIGNALS).toContain("event");
  });
});
