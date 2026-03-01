import { pipeline, env } from "@huggingface/transformers";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Embedding model configuration. Supported models and their prefixes:
 *
 *  nomic-ai/nomic-embed-text-v1.5 (default, 768-d)
 *    Documents: "search_document: " + content
 *    Queries:   "search_query: "   + query
 *
 *  mixedbread-ai/mxbai-embed-large-v1 (1024-d, MTEB ~64.5, best for RAG)
 *  BAAI/bge-large-en-v1.5 (1024-d, MTEB ~64.2)
 *    Queries: "Represent this sentence for searching relevant passages: " + query
 *    Documents: no prefix
 *
 *  Xenova/all-MiniLM-L6-v2 (384-d, tiny fallback)
 *    No prefix needed.
 *
 * Override via env:
 *   CODEPRISM_EMBEDDING_MODEL=mixedbread-ai/mxbai-embed-large-v1
 *   CODEPRISM_EMBEDDING_DIM=1024
 */
const MODEL_ID = process.env["CODEPRISM_EMBEDDING_MODEL"] ?? "nomic-ai/nomic-embed-text-v1.5";

/** Returns the task-type prefix for the active model. Empty string = no prefix. */
function getTaskPrefix(taskType: EmbedTaskType): string {
  if (MODEL_ID.includes("nomic")) {
    return taskType === "query" ? "search_query: " : "search_document: ";
  }
  if (
    MODEL_ID.includes("mxbai-embed-large") ||
    MODEL_ID.includes("bge-large") ||
    MODEL_ID.includes("bge-m3")
  ) {
    // These models use the same retrieval instruction for queries; docs need no prefix.
    return taskType === "query"
      ? "Represent this sentence for searching relevant passages: "
      : "";
  }
  return ""; // all-MiniLM and unknown models: no prefix
}

const _rawDim = Number(process.env["CODEPRISM_EMBEDDING_DIM"] ?? "768");
if (!Number.isInteger(_rawDim) || _rawDim < 64) {
  throw new Error(
    `Invalid CODEPRISM_EMBEDDING_DIM: "${process.env["CODEPRISM_EMBEDDING_DIM"]}". ` +
      `Must be an integer >= 64 (default: 768).`,
  );
}
export const EMBEDDING_DIM = _rawDim;

export type EmbedTaskType = "query" | "document";

/**
 * Generates embeddings locally using nomic-embed-text-v1.5 (768-d) via
 * HuggingFace Transformers.js. The model (~300 MB) is downloaded and cached
 * under `~/.cache/codeprism/models/` on first use.
 *
 * Pass `taskType` to inject the Matryoshka prefix:
 *   - `"query"`:    prefixes with `"search_query: "`
 *   - `"document"`: prefixes with `"search_document: "`
 *   - omitted:      no prefix (backward-compat, avoid for new call sites)
 */
export class LocalEmbedder {
  private pipeline: FeatureExtractionPipeline | null = null;
  private ready: Promise<void>;

  constructor() {
    // CODEPRISM_MODELS_PATH overrides the cache directory.
    // In Docker, set to /data/models so models survive container restarts.
    env.cacheDir = process.env["CODEPRISM_MODELS_PATH"] ?? join(homedir(), ".cache", "codeprism", "models");
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    this.pipeline = await pipeline("feature-extraction", MODEL_ID);
  }

  /** Embed a single text into a unit-length vector. */
  async embed(text: string, taskType?: EmbedTaskType): Promise<Float32Array> {
    await this.ready;
    if (!this.pipeline) throw new Error("Embedder pipeline failed to initialize");
    if (!text.trim()) return new Float32Array(EMBEDDING_DIM);

    const prefix = taskType ? getTaskPrefix(taskType) : "";
    const prefixed = prefix ? `${prefix}${text}` : text;

    const output = await this.pipeline(prefixed, {
      pooling: "mean",
      normalize: true,
    });
    return new Float32Array(output.data as Float32Array);
  }

  /** Embed multiple texts sequentially, returning one vector per input. */
  async embedBatch(texts: string[], taskType?: EmbedTaskType): Promise<Float32Array[]> {
    await this.ready;
    const results: Float32Array[] = [];
    for (const text of texts) {
      results.push(await this.embed(text, taskType));
    }
    return results;
  }
}

let instance: LocalEmbedder | null = null;

/** Returns the shared {@link LocalEmbedder} singleton. */
export function getEmbedder(): LocalEmbedder {
  if (!instance) {
    instance = new LocalEmbedder();
  }
  return instance;
}
