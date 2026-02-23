/** A single classifier rule that maps a file path pattern to a semantic role. */
export interface ClassifierRule {
  pattern: RegExp;
  role: "domain" | "test" | "config" | "entry_point" | "shared_utility";
}

/** Structured best practices for a framework, used to seed doc prompts and calibrate verification. */
export interface BestPractices {
  /** Architectural conventions: service layers, module boundaries, separation of concerns. */
  architecture: string[];
  /** Coding style conventions: naming, method length, readability. */
  codeStyle: string[];
  /** Testing conventions: frameworks, patterns, naming. */
  testing: string[];
  /** Performance conventions: query optimization, caching, async. */
  performance: string[];
  /** Security conventions: input validation, auth patterns, SQL safety. */
  security: string[];
  /** Known anti-patterns to flag in generated docs and code review. */
  antiPatterns: string[];
}

/** Per-framework calibration hints for the code-consistency verifier. */
export interface VerificationHints {
  /**
   * Fraction of sampled code units that must match a rule for auto-promotion.
   * Default: 0.80. Lower for languages where idioms vary widely (e.g. Go: 0.70).
   */
  confirmThreshold: number;
  /**
   * Patterns that look like anti-patterns but are idiomatic in this framework.
   * Verifier excludes these from the denominator.
   * E.g. Rails DSL blocks look like 1-line methods but are valid.
   */
  knownExceptions?: string[];
}

/**
 * A skill captures all the framework-specific context needed to enhance
 * search, card generation, file classification, and doc-baseline seeding
 * for a given technology.
 */
export interface Skill {
  /** Unique identifier used in StackProfile.skillIds. */
  id: string;
  /** Human-readable label for this skill. */
  label: string;
  /**
   * Short (≤ 6 words) embedding prefix for query-time vector search.
   * Kept token-lean so it doesn't dominate the embedding space.
   * Example: "Rails ActiveRecord model"
   */
  searchTag: string;
  /** Prepended to semantic queries to bias embedding search. */
  searchContextPrefix: string;
  /** Injected into card generation LLM prompts for framework awareness. */
  cardPromptHints: string;
  /** Relative importance multipliers per doc type. */
  docTypeWeights: Record<string, number>;
  /** Path-pattern rules that override the default file role classifier. */
  classifierOverrides: ClassifierRule[];
  /**
   * Curated best practices for this framework.
   * Injected as a "Framework Baseline" section into code_style and rules doc prompts,
   * so generated docs start from idiomatic conventions rather than blank slate.
   */
  bestPractices: BestPractices;
  /**
   * Hints for the code-consistency verifier (verifier.ts).
   * Used to calibrate auto-promotion thresholds per framework.
   * @todo Consumed by src/conversations/verifier.ts (not yet implemented).
   *       Do not remove — this data is captured here while skill authors
   *       have framework context fresh, to be used when verifier is built.
   */
  verificationHints: VerificationHints;
}
