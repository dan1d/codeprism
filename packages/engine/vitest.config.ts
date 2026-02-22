import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        // Test helpers and infrastructure
        "src/**/*.test.ts",
        "src/__tests__/**",
        "src/cli/**",
        "src/index.ts",
        // Native binary / ML model dependents — cannot run without downloading models
        "src/embeddings/**",
        "src/search/semantic.ts",
        "src/search/reranker.ts",
        // Tree-sitter AST parsers and extractors (native node addons)
        "src/indexer/tree-sitter.ts",
        "src/indexer/parsers/**",
        "src/indexer/extractors/**",
        // ParserRegistry wires tree-sitter parsers together — integration territory
        "src/indexer/parser-registry.ts",
        // Complex LLM-orchestration (doc generation calls multiple external services)
        "src/indexer/doc-generator.ts",
        // Pure config / trivial re-export / type-only files (no runtime logic)
        "src/indexer/repo-config.ts",
        "src/indexer/types.ts",
        "**/graphology.ts",
        "src/skills/types.ts",
        "src/skills/index.ts",
        // DB connection opens a real file — integration test territory
        "src/db/connection.ts",
        // HTTP server route handlers (integration-test territory)
        "src/metrics/dashboard-api.ts",
        // MCP protocol wiring (requires full server context)
        "src/mcp/**",
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 80,
        statements: 90,
      },
    },
  },
});
