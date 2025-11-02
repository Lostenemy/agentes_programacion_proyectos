export type LLMRole = "system" | "user" | "assistant" | "tool";

export interface LLMMessage {
  role: LLMRole;
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface LLMToolDefinition {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface ChatCompletion {
  id: string;
  messages: LLMMessage[];
  toolCalls?: Array<{ name: string; args: unknown; id?: string }>;
}

export interface StreamEvent {
  type: "message" | "tool_call" | "tool_result" | "done";
  data: unknown;
}

export interface LLMClient {
  chat(payload: {
    model: string;
    messages: LLMMessage[];
    tools?: LLMToolDefinition[];
    temperature?: number;
  }): Promise<ChatCompletion>;
  stream(payload: {
    model: string;
    messages: LLMMessage[];
    tools?: LLMToolDefinition[];
    temperature?: number;
  }): AsyncGenerator<StreamEvent, void, void>;
}
