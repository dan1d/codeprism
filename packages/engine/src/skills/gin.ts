import type { Skill } from "./types.js";

export const ginSkill: Skill = {
  id: "gin",
  label: "Gin (Go)",
  searchTag: "Gin handler router middleware context",
  searchContextPrefix:
    "Gin Go web application: focus on route handlers, router groups, middleware, context binding, and service layer.",
  cardPromptHints:
    "This is a Gin (Go) web application. Emphasize: handler functions with gin.Context, router groups and middleware chains, request binding with ShouldBindJSON/ShouldBindQuery, response helpers (c.JSON, c.AbortWithStatus), service layer for business logic, and graceful shutdown.",
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
    { pattern: /\/middleware\//, role: "shared_utility" },
    { pattern: /\/handlers?\//, role: "domain" },
    { pattern: /\/routes?\//, role: "entry_point" },
  ],
  bestPractices: {
    architecture: [
      "Follow a layered architecture: router → handler → service → repository → database",
      "Register routes in a dedicated router setup function, not scattered through main.go",
      "Use router groups (r.Group()) to namespace related routes and share middleware",
      "Inject dependencies (DB, services) through handler structs — avoid package-level globals",
      "Use gin.Context only in handlers; pass domain types to service functions",
    ],
    codeStyle: [
      "Bind request input with ShouldBind or ShouldBindJSON — return 400 on binding error",
      "Return consistent JSON error responses: {error: string} on failures",
      "Use c.AbortWithStatusJSON() in middleware to stop processing and return an error",
      "Keep handler functions under 20 lines — extract validation, transformation, and logic to helpers",
      "Use typed constants for route paths to avoid string duplication across files",
    ],
    testing: [
      "Use net/http/httptest with gin.New() to create a test engine in isolation",
      "Use table-driven tests for route handler tests with request/expected-response pairs",
      "Mock service interfaces in handler tests to isolate HTTP logic from business logic",
      "Use testify/assert for assertions in handler and service tests",
      "Write integration tests against a real or in-memory database for the repository layer",
    ],
    performance: [
      "Use gin.New() (not gin.Default()) in production to control which middleware runs",
      "Use gin's built-in context pool — gin.Context is already pooled, do not store it in goroutines",
      "Stream large responses with c.Stream() instead of buffering entire responses",
      "Use connection pooling on the database client — set max open/idle connections",
      "Add timeouts to all external HTTP client calls using context.WithTimeout",
    ],
    security: [
      "Always validate and bind request input — never access c.Request.Body directly in handlers",
      "Use parameterized SQL queries — never format SQL strings with user data",
      "Set timeouts on the http.Server (ReadTimeout, WriteTimeout, IdleTimeout)",
      "Recover from panics with gin's Recovery middleware (already in gin.Default())",
      "Return generic error messages to clients — log full error details server-side only",
    ],
    antiPatterns: [
      "Business logic inside handler functions instead of service layer",
      "Accessing gin.Context outside the goroutine that owns the request",
      "Missing c.Abort() after c.JSON() in middleware, allowing handler execution to continue",
      "Storing the gin.Context in a goroutine that outlives the request",
      "Using gin.Default() in tests (adds logger and recovery noise)",
    ],
  },
  verificationHints: {
    confirmThreshold: 0.70,
    knownExceptions: [
      "main.go server setup",
      "Generated protobuf/mock files",
      "Table-driven test definitions",
    ],
  },
};

export default ginSkill;
