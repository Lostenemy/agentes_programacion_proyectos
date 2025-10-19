import fetch, { HeadersInit } from "node-fetch";
import { createParser } from "eventsource-parser";
import { ChatCompletion, LLMClient, LLMMessage, LLMToolDefinition, StreamEvent } from "../types.js";

interface OpenAIRequest {
  model: string;
  messages: Array<{
    role: string;
    content: string;
    name?: string;
    tool_call_id?: string;
  }>;
  tools?: Array<{
    type: "function";
    function: {
      name: string;
      description?: string;
      parameters?: Record<string, unknown>;
    };
  }>;
  stream?: boolean;
  temperature?: number;
}

const defaultBaseUrl = "https://api.openai.com/v1";

function mapMessages(messages: LLMMessage[]): OpenAIRequest["messages"] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    name: message.name,
    tool_call_id: message.tool_call_id
  }));
}

function mapTools(tools?: LLMToolDefinition[]): OpenAIRequest["tools"] | undefined {
  if (!tools) return undefined;
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));
}

function mapHeaders(apiKey: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`
  };
}

async function request<T>(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${response.statusText} - ${text}`);
  }
  return response as unknown as T;
}

export function createOpenAIClient(baseUrl = defaultBaseUrl, apiKey?: string): LLMClient {
  if (!apiKey) {
    throw new Error("OpenAI client requires LLM_API_KEY");
  }

  return {
    async chat(payload) {
      const body: OpenAIRequest = {
        model: payload.model,
        messages: mapMessages(payload.messages),
        tools: mapTools(payload.tools),
        temperature: payload.temperature ?? 0.2
      };
      const response = await request<Response>(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: mapHeaders(apiKey),
        body: JSON.stringify(body)
      });
      const json = (await response.json()) as any;
      const choice = json.choices?.[0]?.message ?? {};
      const toolCalls = choice.tool_calls?.map((call: any) => ({
        id: call.id,
        name: call.function?.name,
        args: call.function?.arguments ? JSON.parse(call.function.arguments) : undefined
      }));
      const messages: LLMMessage[] = choice.content
        ? [{ role: "assistant", content: choice.content }]
        : [];
      return {
        id: json.id,
        messages,
        toolCalls
      } satisfies ChatCompletion;
    },

    async *stream(payload) {
      const body: OpenAIRequest = {
        model: payload.model,
        messages: mapMessages(payload.messages),
        tools: mapTools(payload.tools),
        stream: true,
        temperature: payload.temperature ?? 0.2
      };
      const response = await request<Response>(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: mapHeaders(apiKey),
        body: JSON.stringify(body)
      });
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
            queue.push({
              type: "message",
              data: { role: "assistant", content: delta.content }
            });
          }
          if (Array.isArray(delta.tool_calls)) {
            for (const call of delta.tool_calls) {
              queue.push({
                type: "tool_call",
                data: {
                  id: call.id,
                  name: call.function?.name,
                  args: call.function?.arguments
                    ? call.function.arguments
                    : ""
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

      const bodyStream = response.body as unknown as AsyncIterable<Uint8Array>;
      for await (const chunk of bodyStream) {
        const text = decoder.decode(chunk, { stream: true });
        parser.feed(text);
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
