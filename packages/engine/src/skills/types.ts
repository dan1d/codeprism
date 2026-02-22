/** A single classifier rule that maps a file path pattern to a semantic role. */
export interface ClassifierRule {
  pattern: RegExp;
  role: "domain" | "test" | "config" | "entry_point" | "shared_utility";
}

/**
 * A skill captures all the framework-specific context needed to enhance
 * search, card generation, and file classification for a given technology.
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
}
