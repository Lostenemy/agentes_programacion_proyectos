import "dotenv/config";
import express from "express";
import morgan from "morgan";
import fetch from "node-fetch";
import { v4 as uuidv4 } from "uuid";

const PORT = Number(process.env.ORCHESTRATOR_PORT || 3600);
const API_TOKEN = process.env.API_TOKEN || "";
const ESBIRRO_URL = process.env.ESBIRRO_URL || `http://localhost:${process.env.ESBIRRO_PORT || 3100}`;
const DEVOPS_URL = process.env.DEVOPS_URL || `http://localhost:${process.env.DEVOPS_PORT || 4000}`;
const GIT_WORKER_URL = process.env.GIT_WORKER_URL || `http://localhost:${process.env.GIT_WORKER_PORT || 3500}`;
const AUTO_APPROVE = String(process.env.AUTO_APPROVE || "false").toLowerCase() === "true";

interface JobRecord {
  id: string;
  createdAt: string;
  status: "queued" | "running" | "completed" | "failed";
  error?: string;
  traceId?: string | null;
}

const jobs = new Map<string, JobRecord>();

function authenticate(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${API_TOKEN}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return next();
}

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));
app.use(authenticate);

app.post("/jobs", async (req, res) => {
  const jobId = req.body?.id ?? uuidv4();
  const job: JobRecord = {
    id: jobId,
    createdAt: new Date().toISOString(),
    status: "queued"
  };
  jobs.set(job.id, job);
  processJob(job, req.body?.payload).catch((error) => {
    const record = jobs.get(job.id);
    if (record) {
      record.status = "failed";
      record.error = error.message ?? String(error);
    }
  });
  res.status(202).json({ jobId: job.id });
});

app.get("/jobs", (_req, res) => {
  res.json({ jobs: Array.from(jobs.values()) });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Orchestrator listening on port ${PORT}`);
});

async function processJob(job: JobRecord, payload: any) {
  job.status = "running";
  try {
    const markdown = payload?.markdown ?? payload?.content ?? "";
    const esbirroResponse = await fetch(`${ESBIRRO_URL}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_TOKEN}`
      },
      body: JSON.stringify({
        sessionId: payload?.sessionId,
        stream: false,
        messages: [
          {
            id: uuidv4(),
            role: "user",
            content: "Convierte este contenido en HTML accesible",
            createdAt: new Date().toISOString()
          },
          {
            id: uuidv4(),
            role: "user",
            content: payload?.raw ?? markdown,
            createdAt: new Date().toISOString()
          }
        ]
      })
    });
    if (!esbirroResponse.ok) {
      throw new Error(await esbirroResponse.text());
    }

    const gitResponse = await fetch(`${GIT_WORKER_URL}/commit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_TOKEN}`
      },
      body: JSON.stringify({ message: payload?.commitMessage })
    });
    if (!gitResponse.ok) {
      throw new Error(await gitResponse.text());
    }

    const devopsResponse = await fetch(`${DEVOPS_URL}/ops/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_TOKEN}`
      },
      body: JSON.stringify({
        stream: false,
        messages: [
          {
            id: uuidv4(),
            role: "user",
            content: "Genera un plan para desplegar la web actualizada",
            createdAt: new Date().toISOString()
          }
        ]
      })
    });
    if (!devopsResponse.ok) {
      throw new Error(await devopsResponse.text());
    }
    const planResult = (await devopsResponse.json()) as { plan?: { traceId?: string } };
    const traceId = planResult.plan?.traceId;
    job.traceId = traceId;

    if (AUTO_APPROVE && traceId) {
      await fetch(`${DEVOPS_URL}/ops/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_TOKEN}`
        },
        body: JSON.stringify({ traceId, approve: true, user: "orchestrator" })
      });
    }

    job.status = "completed";
  } catch (error: any) {
    job.status = "failed";
    job.error = error.message ?? String(error);
  }
}
