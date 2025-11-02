import fetch from "node-fetch";
import { ChatCompletion, LLMClient, LLMMessage, LLMToolDefinition, StreamEvent } from "../types.js";

const defaultBaseUrl = "http://127.0.0.1:11434";

export function createOllamaClient(baseUrl = defaultBaseUrl): LLMClient {
  return {
    async chat(payload) {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: payload.model,
          messages: payload.messages,
          stream: false,
          tools: payload.tools
        })
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Ollama request failed: ${response.status} ${text}`);
      }
      const json = (await response.json()) as any;
      const message = json.message ?? { role: "assistant", content: "" };
      return {
        id: json.id ?? json.created_at ?? Date.now().toString(),
        messages: [message]
      } satisfies ChatCompletion;
    },

    async *stream(payload) {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: payload.model,
          messages: payload.messages,
          stream: true,
          tools: payload.tools
        })
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Ollama stream failed: ${response.status} ${text}`);
      }
      const reader = response.body as unknown as AsyncIterable<Uint8Array>;
      const decoder = new TextDecoder();
      for await (const chunk of reader) {
        const text = decoder.decode(chunk, { stream: true });
        const lines = text
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        for (const line of lines) {
          try {
            const json = JSON.parse(line);
            if (json.done) {
              yield { type: "done", data: null } satisfies StreamEvent;
              return;
            }
            if (json.message?.content) {
              yield {
                type: "message",
                data: { role: json.message.role ?? "assistant", content: json.message.content }
              } satisfies StreamEvent;
            }
          } catch (error) {
            yield { type: "message", data: { role: "assistant", content: String(error) } } satisfies StreamEvent;
          }
        }
      }
      yield { type: "done", data: null } satisfies StreamEvent;
    }
  } satisfies LLMClient;
}
