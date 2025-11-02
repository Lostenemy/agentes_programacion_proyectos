import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { streamChat, postJson } from "./api";
import { v4 as uuidv4 } from "uuid";

const API_TOKEN = import.meta.env.VITE_API_TOKEN || "supersecreto";

const AGENTS = {
  esbirro: {
    id: "esbirro",
    name: "Esbirro HTML",
    chatUrl: import.meta.env.VITE_ESBIRRO_URL || "http://localhost:3100/chat"
  },
  devops: {
    id: "devops",
    name: "DevOps",
    chatUrl: import.meta.env.VITE_DEVOPS_URL || "http://localhost:4000/ops/chat",
    executeUrl: import.meta.env.VITE_DEVOPS_EXECUTE_URL || "http://localhost:4000/ops/execute"
  }
} as const;

type AgentKey = keyof typeof AGENTS;

type Message = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  name?: string;
};

function App() {
  const [activeAgent, setActiveAgent] = useState<AgentKey>("esbirro");
  const [messages, setMessages] = useState<Record<AgentKey, Message[]>>({
    esbirro: [],
    devops: []
  });
  const [sessionIds, setSessionIds] = useState<Record<AgentKey, string | null>>({
    esbirro: null,
    devops: null
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [traceId, setTraceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeMessages = messages[activeAgent];

  const handleSend = async () => {
    if (!input.trim()) return;
    const agent = AGENTS[activeAgent];
    const newMessage: Message = {
      id: uuidv4(),
      role: "user",
      content: input,
      createdAt: new Date().toISOString()
    };
    setMessages((prev) => ({
      ...prev,
      [activeAgent]: [...prev[activeAgent], newMessage]
    }));
    setInput("");
    setLoading(true);
    setError(null);
    try {
      const sessionId = sessionIds[activeAgent];
      const payload = {
        sessionId: sessionId ?? undefined,
        stream: true,
        messages: [
          {
            id: newMessage.id,
            role: "user",
            content: newMessage.content,
            createdAt: newMessage.createdAt
          }
        ]
      };
      await streamChat({
        url: agent.chatUrl,
        token: API_TOKEN,
        body: payload,
        onEvent: ({ type, data }) => {
          if (type === "message") {
            const assistantMessage: Message = {
              id: uuidv4(),
              role: data.role ?? "assistant",
              content: data.content ?? "",
              createdAt: new Date().toISOString()
            };
            setMessages((prev) => ({
              ...prev,
              [activeAgent]: [...prev[activeAgent], assistantMessage]
            }));
          } else if (type === "tool_call" || type === "tool_result") {
            const content = typeof data === "string" ? data : JSON.stringify(data, null, 2);
            const toolMessage: Message = {
              id: uuidv4(),
              role: type,
              content,
              createdAt: new Date().toISOString()
            };
            setMessages((prev) => ({
              ...prev,
              [activeAgent]: [...prev[activeAgent], toolMessage]
            }));
          } else if (type === "done") {
            if (data?.sessionId) {
              setSessionIds((prev) => ({ ...prev, [activeAgent]: data.sessionId }));
            }
            if (activeAgent === "devops") {
              setTraceId(data?.traceId ?? null);
            }
          }
        }
      });
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setLoading(false);
    }
  };

  const approvePlan = async () => {
    if (!traceId) return;
    const agent = AGENTS.devops;
    try {
      setLoading(true);
      setError(null);
      await postJson(agent.executeUrl, API_TOKEN, {
        traceId,
        approve: true,
        user: "web-ui"
      });
      setMessages((prev) => ({
        ...prev,
        devops: [
          ...prev.devops,
          {
            id: uuidv4(),
            role: "system",
            content: `Plan ${traceId} aprobado y ejecutado` ,
            createdAt: new Date().toISOString()
          }
        ]
      }));
      setTraceId(null);
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <header>
        <h1>LLM Chat Pipeline</h1>
        <nav>
          {(Object.keys(AGENTS) as AgentKey[]).map((agentKey) => (
            <button
              key={agentKey}
              className={agentKey === activeAgent ? "active" : ""}
              onClick={() => {
                setActiveAgent(agentKey);
                setError(null);
              }}
            >
              {AGENTS[agentKey].name}
            </button>
          ))}
        </nav>
      </header>
      <section className="chat">
        <div className="messages">
          {activeMessages.map((message) => (
            <div key={message.id} className={`message ${message.role}`}>
              <strong>{message.role}</strong>
              <span>{message.content}</span>
            </div>
          ))}
        </div>
        <footer>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Escribe tu mensaje"
            rows={4}
            disabled={loading}
          />
          <div className="actions">
            <button onClick={handleSend} disabled={loading}>
              {loading ? "Enviando..." : "Enviar"}
            </button>
            {activeAgent === "devops" && traceId && (
              <button onClick={approvePlan} disabled={loading}>
                Aprobar &amp; Ejecutar ({traceId})
              </button>
            )}
          </div>
          {error && <p className="error">{error}</p>}
        </footer>
      </section>
      <style>{`
        body {
          margin: 0;
          font-family: Inter, system-ui, sans-serif;
          background: #0f172a;
          color: #e2e8f0;
        }
        .app {
          max-width: 960px;
          margin: 0 auto;
          padding: 2rem 1rem 4rem 1rem;
        }
        header {
          text-align: center;
          margin-bottom: 1rem;
        }
        nav {
          display: flex;
          gap: 1rem;
          justify-content: center;
          margin-top: 1rem;
        }
        button {
          background: #1e293b;
          color: inherit;
          border: 1px solid #334155;
          padding: 0.5rem 1rem;
          border-radius: 0.5rem;
          cursor: pointer;
        }
        button.active {
          background: #38bdf8;
          color: #0f172a;
        }
        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .chat {
          background: rgba(15, 23, 42, 0.9);
          border-radius: 1rem;
          padding: 1rem;
          min-height: 60vh;
          display: flex;
          flex-direction: column;
        }
        .messages {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          padding-right: 0.5rem;
        }
        .message {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          background: rgba(51, 65, 85, 0.4);
          border-radius: 0.75rem;
          padding: 0.75rem;
        }
        .message.user {
          background: rgba(59, 130, 246, 0.35);
        }
        .message.tool_call,
        .message.tool_result {
          font-family: "JetBrains Mono", monospace;
          white-space: pre-wrap;
        }
        textarea {
          width: 100%;
          margin-top: 1rem;
          border-radius: 0.75rem;
          border: 1px solid #334155;
          background: rgba(15, 23, 42, 0.8);
          color: inherit;
          padding: 0.75rem;
        }
        .actions {
          margin-top: 0.5rem;
          display: flex;
          gap: 1rem;
          justify-content: flex-end;
        }
        .error {
          color: #f87171;
        }
      `}</style>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
