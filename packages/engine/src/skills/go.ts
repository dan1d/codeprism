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
  bestPractices: {
    architecture: [
      "Use interfaces to define service contracts; inject dependencies as interface parameters",
      "Follow the repository pattern: handler → service → repository → database",
      "Keep packages small and focused; avoid circular imports by using the dependency rule",
      "Place internal packages in internal/ to prevent external consumers",
      "Use cmd/ for executable entrypoints; pkg/ for reusable library code",
    ],
    codeStyle: [
      "Return errors as the last return value — never panic in library code",
      "Use %w verb in fmt.Errorf to wrap errors for errors.Is/As inspection",
      "Prefer named return values only when they aid clarity in deferred logic",
      "Keep function length short — if it doesn't fit on one screen, extract helpers",
      "Use table-driven tests with a slice of test cases and a subtest loop",
    ],
    testing: [
      "Use table-driven tests with t.Run() for subtests",
      "Use the standard testing package; avoid heavy test frameworks",
      "Mock interfaces with testify/mock or manually implement the interface for test doubles",
      "Name test files foo_test.go in the same package; use _test package for black-box testing",
      "Benchmark critical paths with testing.B; profile with pprof before optimizing",
    ],
    performance: [
      "Pre-allocate slices and maps with make([]T, 0, capacity) when the size is known",
      "Use sync.Pool for frequently allocated short-lived objects",
      "Use goroutines and channels for concurrency; prefer errgroup for coordinated goroutines",
      "Avoid interface conversions in hot paths — they involve reflection overhead",
      "Use buffered I/O (bufio) for read-heavy or write-heavy file/network operations",
    ],
    security: [
      "Validate all inputs at the handler boundary; reject early rather than sanitizing deep",
      "Use parameterized queries (database/sql placeholders) — never string-format SQL",
      "Set timeouts on all HTTP clients and servers — never use http.DefaultClient without timeout",
      "Use crypto/rand for cryptographic randomness, not math/rand",
      "Avoid storing secrets in struct fields that could be inadvertently logged",
    ],
    antiPatterns: [
      "Ignoring returned errors with _",
      "Using global mutable state instead of dependency injection",
      "Goroutine leaks from forgotten channel receives or missing context cancellation",
      "Using interface{}/any excessively instead of concrete types",
      "Returning concrete struct types from constructors instead of interfaces (breaks testability)",
    ],
  },
  verificationHints: {
    confirmThreshold: 0.70,
    knownExceptions: [
      "Single-return helper functions (getters, validators returning bool)",
      "Generated code files (*.pb.go, *_gen.go)",
      "Database migration files",
    ],
  },
};

export default goSkill;
