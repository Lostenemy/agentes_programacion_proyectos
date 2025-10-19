export type ChatMessage = {
  id: string;
  role: string;
  content: string;
  createdAt?: string;
  name?: string;
};

export interface StreamOptions {
  url: string;
  token: string;
  body: unknown;
  onEvent: (event: { type: string; data: any }) => void;
}

export async function streamChat({ url, token, body, onEvent }: StreamOptions) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(text || `Request failed with ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const lines = chunk.split("\n");
      let eventType = "message";
      let data = "";
      for (const line of lines) {
        if (line.startsWith("event:")) {
          eventType = line.replace("event:", "").trim();
        } else if (line.startsWith("data:")) {
          data += line.replace("data:", "").trim();
        }
      }
      if (data) {
        try {
          onEvent({ type: eventType, data: JSON.parse(data) });
        } catch {
          onEvent({ type: eventType, data });
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
  if (buffer.trim().length > 0) {
    const lines = buffer.split("\n");
    let eventType = "message";
    let data = "";
    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventType = line.replace("event:", "").trim();
      } else if (line.startsWith("data:")) {
        data += line.replace("data:", "").trim();
      }
    }
    if (data) {
      try {
        onEvent({ type: eventType, data: JSON.parse(data) });
      } catch {
        onEvent({ type: eventType, data });
      }
    }
  }
}

export async function postJson<T = any>(url: string, token: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as T;
}
