import { createOpenAIClient } from "./adapters/openai.js";
import { createOllamaClient } from "./adapters/ollama.js";
import { createOpenRouterClient } from "./adapters/openrouter.js";
import { LLMClient } from "./types.js";

export * from "./types.js";

export interface LLMClientOptions {
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
}

export function createLLMClient(options: LLMClientOptions = {}): LLMClient {
  const provider = (options.provider || process.env.LLM_PROVIDER || "openai").toLowerCase();
  const model = process.env.LLM_MODEL;
  const apiKey = options.apiKey ?? process.env.LLM_API_KEY;
  const baseUrl = options.baseUrl ?? process.env.LLM_BASE_URL;

  switch (provider) {
    case "openai":
      return createOpenAIClient(baseUrl && baseUrl.length > 0 ? baseUrl : undefined, apiKey);
    case "ollama":
      return createOllamaClient(baseUrl && baseUrl.length > 0 ? baseUrl : undefined);
    case "openrouter":
      return createOpenRouterClient(baseUrl && baseUrl.length > 0 ? baseUrl : undefined, apiKey);
    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
  }
}

export function getDefaultModel(): string {
  const model = process.env.LLM_MODEL;
  if (!model) {
    throw new Error("LLM_MODEL is not configured");
  }
  return model;
}
