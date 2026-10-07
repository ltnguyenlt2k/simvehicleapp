import { anthropicProvider } from "./anthropic.ts";
import { geminiProvider } from "./gemini.ts";
import { openaiProvider } from "./openai.ts";
import type { LlmProvider } from "./types.ts";

/**
 * Provider from the environment (ADR-0030 §2): `SV_AI_PROVIDER` (anthropic | openai | openai-compatible |
 * ollama | gemini) + `SV_AI_MODEL`, keys from `.env`. Returns why when it is not configured, so the chat
 * says so instead of failing late.
 */
export function providerFromEnv(env: Record<string, string | undefined>): LlmProvider | { error: string } {
  const kind = (env.SV_AI_PROVIDER ?? "").trim().toLowerCase();
  const model = env.SV_AI_MODEL?.trim();
  switch (kind) {
    case "anthropic":
      if (!env.ANTHROPIC_API_KEY) return { error: "ANTHROPIC_API_KEY is not set" };
      return anthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: model || "claude-sonnet-5-5", ...(env.ANTHROPIC_BASE_URL ? { baseUrl: env.ANTHROPIC_BASE_URL } : {}) });
    case "openai":
      if (!env.OPENAI_API_KEY) return { error: "OPENAI_API_KEY is not set" };
      if (!model) return { error: "SV_AI_MODEL is not set (the OpenAI model to use)" };
      return openaiProvider({ name: "openai", apiKey: env.OPENAI_API_KEY, model, baseUrl: env.OPENAI_BASE_URL || "https://api.openai.com/v1" });
    case "openai-compatible":
      if (!env.OPENAI_COMPAT_BASE_URL) return { error: "OPENAI_COMPAT_BASE_URL is not set" };
      if (!model) return { error: "SV_AI_MODEL is not set" };
      return openaiProvider({ apiKey: env.OPENAI_COMPAT_API_KEY, model, baseUrl: env.OPENAI_COMPAT_BASE_URL });
    case "ollama":
      // Ollama's OpenAI-compatible endpoint; reasoning off in the tool loop (ADR-0030 Notes §11).
      return openaiProvider({ name: "ollama", model: model || "qwen3.5:9b", baseUrl: env.OLLAMA_BASE_URL || "http://host.docker.internal:11434/v1", extraBody: { reasoning_effort: "none" } });
    case "gemini":
      if (!env.GEMINI_API_KEY) return { error: "GEMINI_API_KEY is not set" };
      if (!model) return { error: "SV_AI_MODEL is not set (the Gemini model to use)" };
      return geminiProvider({ apiKey: env.GEMINI_API_KEY, model });
    case "":
      return { error: "No AI provider configured: set SV_AI_PROVIDER (anthropic, openai, openai-compatible, ollama, gemini) in .env" };
    default:
      return { error: `Unknown SV_AI_PROVIDER "${kind}"` };
  }
}

export type { LlmProvider } from "./types.ts";
