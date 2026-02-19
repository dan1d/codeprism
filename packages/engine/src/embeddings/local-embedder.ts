import { pipeline, env } from "@huggingface/transformers";
import { join } from "node:path";
import { homedir } from "node:os";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const EMBEDDING_DIM = 384;

/**
 * Generates 384-dimensional embeddings locally using `all-MiniLM-L6-v2`
 * via HuggingFace Transformers.js. The model (~80 MB) is downloaded and
 * cached under `~/.cache/srcmap/models/` on first use.
 */
export class LocalEmbedder {
  private pipeline: any;
  private ready: Promise<void>;

  constructor() {
    env.cacheDir = join(homedir(), ".cache", "srcmap", "models");
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    this.pipeline = await pipeline("feature-extraction", MODEL_ID);
  }

  /** Embed a single text into a unit-length 384-d vector. */
  async embed(text: string): Promise<Float32Array> {
    await this.ready;
    if (!text.trim()) return new Float32Array(EMBEDDING_DIM);

    const output = await this.pipeline(text, {
      pooling: "mean",
      normalize: true,
    });
    return new Float32Array(output.data);
  }

  /** Embed multiple texts sequentially, returning one vector per input. */
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    await this.ready;
    const results: Float32Array[] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
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
