/**
 * Shared fixtures and mock factory functions for unit tests.
 */

import type { Card } from "../../db/schema.js";
import type { ParsedFile } from "../../indexer/types.js";
import type { LLMProvider } from "../../llm/provider.js";
import type { Flow } from "../../indexer/flow-detector.js";
import type { GraphEdge } from "../../indexer/graph-builder.js";
import type { SearchResult } from "../../search/hybrid.js";

// ---------------------------------------------------------------------------
// ParsedFile factory
// ---------------------------------------------------------------------------

export function makeParsedFile(overrides: Partial<ParsedFile> = {}): ParsedFile {
  return {
    path: "/repo/app/models/patient.rb",
    repo: "biobridge-backend",
    language: "ruby",
    fileRole: "domain",
    classes: [],
    associations: [],
    routes: [],
    imports: [],
    exports: [],
    functions: [],
    apiCalls: [],
    storeUsages: [],
    callbacks: [],
    validations: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Card factory
// ---------------------------------------------------------------------------

export function makeCard(overrides: Partial<Card> = {}): Card {
  const now = new Date().toISOString();
  return {
    id: `card-${Math.random().toString(36).slice(2, 10)}`,
    flow: "test-flow",
    title: "Test Card",
    content: "Test card content about patient authorization",
    card_type: "flow",
    source_files: '[]',
    source_repos: '["test-repo"]',
    tags: '[]',
    valid_branches: null,
    commit_sha: null,
    created_by: null,
    stale: 0,
    usage_count: 0,
    specificity_score: 0.5,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Flow factory
// ---------------------------------------------------------------------------

export function makeFlow(files: string[], overrides: Partial<Flow> = {}): Flow {
  return {
    name: "test-flow",
    files,
    repos: ["test-repo"],
    isHub: false,
    edgeCount: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// GraphEdge factory
// ---------------------------------------------------------------------------

export function makeEdge(overrides: Partial<GraphEdge> = {}): GraphEdge {
  return {
    sourceFile: "/repo/app/controllers/patients_controller.rb",
    targetFile: "/repo/app/models/patient.rb",
    relation: "controller_model",
    metadata: {},
    repo: "test-repo",
    weight: 4,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SearchResult factory
// ---------------------------------------------------------------------------

export function makeSearchResult(
  card: Card,
  score = 0.8,
  source: SearchResult["source"] = "semantic",
): SearchResult {
  return { card, score, source };
}

// ---------------------------------------------------------------------------
// Mock LLM provider
// ---------------------------------------------------------------------------

export const mockLlm: LLMProvider = {
  model: "mock",
  generate: async (_prompt: string, _opts?: unknown) =>
    "## Mock Card\n\nThis is a generated card for testing purposes.\n\nIt contains relevant information about the flow.",
  estimateTokens: (text: string) => Math.ceil(text.length / 4),
};

/** LLM that always throws — for testing fallback behaviour. */
export const failingLlm: LLMProvider = {
  model: "mock-failing",
  generate: async () => {
    throw new Error("LLM rate limit exceeded");
  },
  estimateTokens: (text: string) => Math.ceil(text.length / 4),
};

// ---------------------------------------------------------------------------
// Embedding helpers
// ---------------------------------------------------------------------------

/** Creates a normalised Float32Array of the given dimension. */
export function makeEmbedding(dim = 384, value = 1.0): Float32Array {
  const arr = new Float32Array(dim).fill(value / Math.sqrt(dim));
  return arr;
}

/** Creates an orthogonal embedding (cosine similarity = 0 against makeEmbedding). */
export function makeOrthogonalEmbedding(dim = 384): Float32Array {
  const arr = new Float32Array(dim);
  // Alternate +/- to be orthogonal to a constant vector
  for (let i = 0; i < dim; i++) {
    arr[i] = i % 2 === 0 ? 1 / Math.sqrt(dim / 2) : -1 / Math.sqrt(dim / 2);
  }
  return arr;
}

/** Serialises a Float32Array to a Buffer (DB storage format). */
export function embeddingToBuffer(emb: Float32Array): Buffer {
  return Buffer.from(emb.buffer);
}
