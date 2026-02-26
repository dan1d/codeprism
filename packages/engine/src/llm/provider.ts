import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";

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
  provider: "anthropic" | "openai" | "deepseek" | "gemini" | "none";
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
 * Google Gemini provider using the Generative AI SDK.
 * Default model: gemini-2.0-flash (free tier: 15 RPM / 1M tokens/day).
 * Get a free API key at https://ai.google.dev/
 */
export class GeminiProvider implements LLMProvider {
  private client: GoogleGenerativeAI;
  public model: string;

  constructor(apiKey: string, model?: string) {
    this.client = new GoogleGenerativeAI(apiKey);
    this.model = model ?? "gemini-2.0-flash";
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    const genModel = this.client.getGenerativeModel({
      model: this.model,
      systemInstruction: options?.systemPrompt,
      generationConfig: {
        maxOutputTokens: options?.maxTokens ?? 1024,
        temperature: options?.temperature ?? 0.2,
      },
    });

    const result = await genModel.generateContent(prompt);
    return result.response.text();
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

/**
 * OpenAI provider (GPT-4o-mini default).
 * Get an API key at https://platform.openai.com/
 */
export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  public model: string;

  constructor(apiKey: string, model?: string) {
    this.client = new OpenAI({ apiKey });
    this.model = model ?? "gpt-4o-mini";
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (options?.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      max_tokens: options?.maxTokens ?? 1024,
      temperature: options?.temperature ?? 0.2,
    });

    return response.choices[0]?.message?.content ?? "";
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

/**
 * DeepSeek provider using the OpenAI-compatible API.
 * Default model: deepseek-chat (DeepSeek-V3).
 * Get an API key at https://platform.deepseek.com/
 * Pricing: ~$0.14/1M input tokens, ~$0.28/1M output tokens (much cheaper than GPT-4).
 */
export class DeepSeekProvider implements LLMProvider {
  private client: OpenAI;
  public model: string;

  constructor(apiKey: string, model?: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL: "https://api.deepseek.com/v1",
    });
    this.model = model ?? "deepseek-chat";
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (options?.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      max_tokens: options?.maxTokens ?? 1024,
      temperature: options?.temperature ?? 0.2,
    });

    return response.choices[0]?.message?.content ?? "";
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

/**
 * Create an LLM provider from config or environment variables.
 * Falls back to env: CODEPRISM_LLM_PROVIDER, CODEPRISM_LLM_MODEL, CODEPRISM_LLM_API_KEY.
 *
 * Supported providers:
 *  - deepseek  → DeepSeek-V3 via OpenAI-compatible API (cheap: ~$0.14/1M input tokens)
 *  - gemini    → Google Gemini 2.0 Flash (free tier: https://ai.google.dev/)
 *  - anthropic → Claude (paid)
 *  - openai    → GPT-4o-mini (paid)
 *
 * @returns Provider instance or null if none configured
 */
export function createLLMProvider(config?: LLMConfig): LLMProvider | null {
  const cfg: LLMConfig = config ?? {
    provider:
      (process.env["CODEPRISM_LLM_PROVIDER"] as LLMConfig["provider"]) ?? "none",
    model: process.env["CODEPRISM_LLM_MODEL"],
    apiKey: process.env["CODEPRISM_LLM_API_KEY"],
  };

  if (cfg.provider === "none" || !cfg.apiKey) return null;

  switch (cfg.provider) {
    case "deepseek":
      return new DeepSeekProvider(cfg.apiKey, cfg.model);
    case "gemini":
      return new GeminiProvider(cfg.apiKey, cfg.model);
    case "anthropic":
      return new AnthropicProvider(cfg.apiKey, cfg.model);
    case "openai":
      return new OpenAIProvider(cfg.apiKey, cfg.model);
    default:
      return null;
  }
}
