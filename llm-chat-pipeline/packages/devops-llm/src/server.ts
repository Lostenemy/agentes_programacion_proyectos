import "dotenv/config";
import express from "express";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import { ChatRequest, chatRequestSchema, defaultStore } from "chat-core";
import { DevOpsAgent } from "./agent.js";

const PORT = Number(process.env.DEVOPS_PORT || process.env.PORT || 4000);
const API_TOKEN = process.env.API_TOKEN || "";

function authenticate(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${API_TOKEN}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return next();
}

const limiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyGenerator: (req) => `${req.ip}:${req.headers.authorization ?? ""}`
});

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(limiter);
app.use(morgan("dev"));
app.use(authenticate);

const agent = new DevOpsAgent();

app.post("/ops/chat", async (req, res) => {
  try {
    const parsed = chatRequestSchema.parse(req.body) as ChatRequest;
    const sessionId = parsed.sessionId ?? (await defaultStore.createSession());
    const payload: ChatRequest = { ...parsed, sessionId };
    const stream = payload.stream ?? true;
    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();
      const iterator = agent.streamChat(payload);
      for await (const event of iterator) {
        res.write(`event: ${event.type}\n`);
        res.write(`data: ${JSON.stringify(event.data ?? {})}\n\n`);
        if (event.type === "done") {
          break;
        }
      }
      res.end();
    } else {
      const result = await agent.chat(payload);
      res.json({ sessionId: result.sessionId, messages: result.messages, plan: result.plan });
    }
  } catch (error: any) {
    res.status(400).json({ error: error.message ?? String(error) });
  }
});

app.get("/ops/chat/:sessionId/history", async (req, res) => {
  const session = await defaultStore.loadSession(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  const limit = Number(req.query.limit ?? 50);
  res.json({ sessionId: session.sessionId, messages: session.messages.slice(-limit) });
});

app.delete("/ops/chat/:sessionId", async (req, res) => {
  await defaultStore.deleteSession(req.params.sessionId);
  res.status(204).send();
});

app.post("/ops/execute", async (req, res) => {
  try {
    const { traceId, approve, user } = req.body as { traceId: string; approve?: boolean; user?: string };
    if (!traceId) {
      return res.status(400).json({ error: "traceId is required" });
    }
    if (!approve) {
      return res.status(400).json({ error: "Execution requires explicit approval" });
    }
    const audit = await agent.executePlan(traceId, user || "system");
    res.json({ status: "ok", audit });
  } catch (error: any) {
    res.status(400).json({ error: error.message ?? String(error) });
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`DevOps LLM server listening on port ${PORT}`);
});
