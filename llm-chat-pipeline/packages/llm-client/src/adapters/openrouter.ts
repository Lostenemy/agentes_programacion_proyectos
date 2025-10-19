import fetch from "node-fetch";
import { createParser } from "eventsource-parser";
import { ChatCompletion, LLMClient, LLMMessage, LLMToolDefinition, StreamEvent } from "../types.js";

const defaultBaseUrl = "https://openrouter.ai/api/v1";

export function createOpenRouterClient(baseUrl = defaultBaseUrl, apiKey?: string): LLMClient {
  if (!apiKey) {
    throw new Error("OpenRouter client requires LLM_API_KEY");
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "HTTP-Referer": "https://localhost",
    "X-Title": "LLM Chat Pipeline"
  };

  return {
    async chat(payload) {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: payload.model,
          messages: payload.messages,
          tools: payload.tools,
          stream: false
        })
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`OpenRouter request failed: ${response.status} ${text}`);
      }
      const json = (await response.json()) as any;
      const choice = json.choices?.[0]?.message ?? {};
      return {
        id: json.id ?? Date.now().toString(),
        messages: choice.content ? [{ role: "assistant", content: choice.content }] : [],
        toolCalls: choice.tool_calls?.map((call: any) => ({
          id: call.id,
          name: call.function?.name,
          args: call.function?.arguments ? JSON.parse(call.function.arguments) : undefined
        }))
      } satisfies ChatCompletion;
    },

    async *stream(payload) {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: payload.model,
          messages: payload.messages,
          tools: payload.tools,
          stream: true
        })
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`OpenRouter stream failed: ${response.status} ${text}`);
      }
      const queue: StreamEvent[] = [];
      const parser = createParser((event) => {
        if (event.type !== "event") return;
        const data = event.data;
        if (!data || data === "[DONE]") {
          queue.push({ type: "done", data: null });
          return;
        }
        try {
          const json = JSON.parse(data);
          const choice = json.choices?.[0];
          if (!choice) return;
          const delta = choice.delta ?? {};
          if (delta.content) {
            queue.push({ type: "message", data: { role: "assistant", content: delta.content } });
          }
          if (Array.isArray(delta.tool_calls)) {
            for (const call of delta.tool_calls) {
              queue.push({
                type: "tool_call",
                data: {
                  id: call.id,
                  name: call.function?.name,
                  args: call.function?.arguments ?? ""
                }
              });
            }
          }
          if (choice.finish_reason) {
            queue.push({ type: "done", data: { reason: choice.finish_reason } });
          }
        } catch (error) {
          queue.push({ type: "message", data: { role: "assistant", content: String(error) } });
        }
      });
      const decoder = new TextDecoder();
      const stream = response.body as unknown as AsyncIterable<Uint8Array>;
      for await (const chunk of stream) {
        parser.feed(decoder.decode(chunk, { stream: true }));
        while (queue.length) {
          yield queue.shift()!;
        }
      }
      while (queue.length) {
        yield queue.shift()!;
      }
    }
  } satisfies LLMClient;
}
