import "dotenv/config";
import express from "express";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import fetch from "node-fetch";
import { v4 as uuidv4 } from "uuid";

const PORT = Number(process.env.PORT || 3000);
const API_TOKEN = process.env.API_TOKEN || "";
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || `http://localhost:${process.env.ORCHESTRATOR_PORT || 3600}`;

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
app.use(express.json({ limit: "2mb" }));
app.use(limiter);
app.use(morgan("dev"));
app.use(authenticate);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/jobs", async (req, res) => {
  try {
    const job = {
      id: uuidv4(),
      createdAt: new Date().toISOString(),
      payload: req.body
    };
    const response = await fetch(`${ORCHESTRATOR_URL}/jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_TOKEN}`
      },
      body: JSON.stringify(job)
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Orchestrator error: ${text}`);
    }
    res.status(202).json({ jobId: job.id });
  } catch (error: any) {
    res.status(400).json({ error: error.message ?? String(error) });
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`API Input server listening on port ${PORT}`);
});
