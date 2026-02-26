/**
 * Tests for llm/provider.ts — factory function and shared provider behaviours.
 *
 * External HTTP clients (Anthropic, OpenAI, Google) are mocked so no real API
 * calls are made.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock all three SDK clients before importing the module under test.
// NOTE: vi.fn() mock functions ARE callable as constructors; when the
// implementation returns a plain object the JS engine uses that object.
// ---------------------------------------------------------------------------

vi.mock("@anthropic-ai/sdk", () => {
  const create = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "Anthropic response" }],
  });
  function Anthropic() {
    return { messages: { create } };
  }
  return { default: Anthropic };
});

vi.mock("@google/generative-ai", () => {
  const generateContent = vi.fn().mockResolvedValue({
    response: { text: () => "Gemini response" },
  });
  function GoogleGenerativeAI() {
    return {
      getGenerativeModel: vi.fn().mockReturnValue({ generateContent }),
    };
  }
  return { GoogleGenerativeAI };
});

vi.mock("openai", () => {
  const create = vi.fn().mockResolvedValue({
    choices: [{ message: { content: "DeepSeek response" } }],
  });
  function OpenAI() {
    return { chat: { completions: { create } } };
  }
  return { default: OpenAI };
});

const {
  createLLMProvider,
  AnthropicProvider,
  GeminiProvider,
  DeepSeekProvider,
} = await import("../../llm/provider.js");

// ---------------------------------------------------------------------------
// createLLMProvider factory
// ---------------------------------------------------------------------------

describe("createLLMProvider", () => {
  beforeEach(() => {
    // Clean env vars between tests
    delete process.env["CODEPRISM_LLM_PROVIDER"];
    delete process.env["CODEPRISM_LLM_API_KEY"];
    delete process.env["CODEPRISM_LLM_MODEL"];
  });

  it("returns null when provider is 'none'", () => {
    const provider = createLLMProvider({ provider: "none" });
    expect(provider).toBeNull();
  });

  it("returns null when no apiKey is provided", () => {
    const provider = createLLMProvider({ provider: "deepseek" });
    expect(provider).toBeNull();
  });

  it("returns a DeepSeekProvider for provider='deepseek'", () => {
    const provider = createLLMProvider({ provider: "deepseek", apiKey: "sk-test" });
    expect(provider).toBeInstanceOf(DeepSeekProvider);
    expect(provider?.model).toContain("deepseek");
  });

  it("returns a GeminiProvider for provider='gemini'", () => {
    const provider = createLLMProvider({ provider: "gemini", apiKey: "gm-test" });
    expect(provider).toBeInstanceOf(GeminiProvider);
    expect(provider?.model).toContain("gemini");
  });

  it("returns an AnthropicProvider for provider='anthropic'", () => {
    const provider = createLLMProvider({ provider: "anthropic", apiKey: "ant-test" });
    expect(provider).toBeInstanceOf(AnthropicProvider);
    expect(provider?.model).toContain("claude");
  });

  it("uses a custom model when provided", () => {
    const provider = createLLMProvider({
      provider: "deepseek",
      apiKey: "sk-test",
      model: "my-custom-model",
    });
    expect(provider?.model).toBe("my-custom-model");
  });

  it("reads config from environment variables when no config passed", () => {
    process.env["CODEPRISM_LLM_PROVIDER"] = "deepseek";
    process.env["CODEPRISM_LLM_API_KEY"] = "env-key";

    const provider = createLLMProvider();
    expect(provider).toBeInstanceOf(DeepSeekProvider);
  });

  it("returns null when env provider is 'none'", () => {
    process.env["CODEPRISM_LLM_PROVIDER"] = "none";

    const provider = createLLMProvider();
    expect(provider).toBeNull();
  });

  it("returns null when env has no api key", () => {
    process.env["CODEPRISM_LLM_PROVIDER"] = "gemini";
    // CODEPRISM_LLM_API_KEY not set

    const provider = createLLMProvider();
    expect(provider).toBeNull();
  });

  it("handles unknown provider gracefully", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const provider = createLLMProvider({ provider: "unknown" as any, apiKey: "test" });
    expect(provider).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

describe("estimateTokens", () => {
  it("approximates 4 chars per token for DeepSeekProvider", () => {
    const p = createLLMProvider({ provider: "deepseek", apiKey: "sk-x" })!;
    expect(p.estimateTokens("hello world")).toBe(3); // 11 chars / 4 = 2.75 → 3
  });

  it("approximates 4 chars per token for GeminiProvider", () => {
    const p = createLLMProvider({ provider: "gemini", apiKey: "gm-x" })!;
    expect(p.estimateTokens("hello world")).toBe(3);
  });

  it("approximates 4 chars per token for AnthropicProvider", () => {
    const p = createLLMProvider({ provider: "anthropic", apiKey: "ant-x" })!;
    expect(p.estimateTokens("hello world")).toBe(3);
  });

  it("returns 0 for empty string", () => {
    const p = createLLMProvider({ provider: "deepseek", apiKey: "sk-x" })!;
    expect(p.estimateTokens("")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// generate — mocked API calls
// ---------------------------------------------------------------------------

describe("AnthropicProvider.generate", () => {
  it("returns the text from the first content block", async () => {
    const p = new AnthropicProvider("ant-key");
    const result = await p.generate("test prompt");
    expect(result).toBe("Anthropic response");
  });
});

describe("GeminiProvider.generate", () => {
  it("returns text from the response", async () => {
    const p = new GeminiProvider("gm-key");
    const result = await p.generate("test prompt");
    expect(result).toBe("Gemini response");
  });
});

describe("DeepSeekProvider.generate", () => {
  it("returns content from the first choice", async () => {
    const p = new DeepSeekProvider("sk-key");
    const result = await p.generate("test prompt");
    expect(result).toBe("DeepSeek response");
  });
});
