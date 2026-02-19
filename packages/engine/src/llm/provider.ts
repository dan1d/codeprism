import Anthropic from "@anthropic-ai/sdk";

/**
 * Options for LLM completion generation.
 */
export interface GenerateOptions {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

/**
 * Configuration for creating an LLM provider.
 */
export interface LLMConfig {
  provider: "anthropic" | "openai" | "none";
  model?: string;
  apiKey?: string;
}

/**
 * LLM provider abstraction for text completion.
 */
export interface LLMProvider {
  /** Generate a completion from a prompt */
  generate(prompt: string, options?: GenerateOptions): Promise<string>;
  /** Get the model name being used */
  model: string;
  /** Estimate token count for a string (rough approximation) */
  estimateTokens(text: string): number;
}

/**
 * Anthropic Claude provider using the Messages API.
 */
export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  public model: string;

  constructor(apiKey: string, model?: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model ?? "claude-haiku-4-5-20241022";
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? 1024,
      ...(options?.temperature != null ? { temperature: options.temperature } : {}),
      messages: [{ role: "user", content: prompt }],
      ...(options?.systemPrompt ? { system: options.systemPrompt } : {}),
    });

    const textBlock = response.content.find((b) => b.type === "text");
    return textBlock && "text" in textBlock ? textBlock.text : "";
  }

  estimateTokens(text: string): number {
    // ~4 chars per token is a reasonable approximation
    return Math.ceil(text.length / 4);
  }
}

/**
 * Create an LLM provider from config or environment variables.
 * Falls back to env: SRCMAP_LLM_PROVIDER, SRCMAP_LLM_MODEL, SRCMAP_LLM_API_KEY.
 *
 * @returns Provider instance or null if none configured
 */
export function createLLMProvider(config?: LLMConfig): LLMProvider | null {
  const cfg: LLMConfig = config ?? {
    provider:
      (process.env["SRCMAP_LLM_PROVIDER"] as LLMConfig["provider"]) ?? "none",
    model: process.env["SRCMAP_LLM_MODEL"],
    apiKey: process.env["SRCMAP_LLM_API_KEY"],
  };

  if (cfg.provider === "none" || !cfg.apiKey) return null;

  switch (cfg.provider) {
    case "anthropic":
      return new AnthropicProvider(cfg.apiKey, cfg.model);
    case "openai":
      // Future: add OpenAI provider
      console.warn(
        "[srcmap] OpenAI provider not yet implemented, falling back to structural cards"
      );
      return null;
    default:
      return null;
  }
}
