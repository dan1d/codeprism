import type { Skill } from "./types.js";

export const goSkill: Skill = {
  id: "go",
  label: "Go",
  searchTag: "Go handler service interface struct",
  searchContextPrefix:
    "Go codebase: focus on HTTP handlers, service layer, repository pattern, struct definitions, and interface implementations.",
  cardPromptHints:
    "This is a Go application. Emphasize: handler functions, service interfaces and implementations, repository pattern for data access, struct types with JSON tags, error handling patterns, and goroutine/channel usage for concurrency.",
  docTypeWeights: {
    about: 0.9,
    architecture: 1.1,
    rules: 0.9,
    code_style: 1.0,
    specialist: 1.2,
  },
  classifierOverrides: [
    { pattern: /_test\.go$/, role: "test" },
    { pattern: /\/cmd\//, role: "entry_point" },
    { pattern: /\/internal\//, role: "domain" },
    { pattern: /\/pkg\//, role: "shared_utility" },
  ],
};

export default goSkill;
