import { pipeline, env } from "@huggingface/transformers";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * nomic-embed-text-v1.5 uses Matryoshka Representation Learning and requires
 * task-type prefix injection for best performance:
 *   Documents: "search_document: " + content
 *   Queries:   "search_query: "   + query
 *
 * Without prefixes the model still works but underperforms its MTEB benchmarks.
 * Dimension: 768 (vs 384 for all-MiniLM-L6-v2).
 *
 * Fallback: set CODEPRISM_EMBEDDING_MODEL=Xenova/all-MiniLM-L6-v2 and
 * CODEPRISM_EMBEDDING_DIM=384 to revert to the smaller model.
 */
const MODEL_ID = process.env["CODEPRISM_EMBEDDING_MODEL"] ?? "nomic-ai/nomic-embed-text-v1.5";

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
    env.cacheDir = join(homedir(), ".cache", "codeprism", "models");
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

    const prefixed =
      taskType === "query"    ? `search_query: ${text}`
      : taskType === "document" ? `search_document: ${text}`
      : text;

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
