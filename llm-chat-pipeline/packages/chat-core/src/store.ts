import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import { AuditLog, Message, Plan } from "./schema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_DATA_DIR = process.env.CHAT_DATA_DIR || path.resolve(__dirname, "../../../data/chats");

export interface SessionRecord {
  sessionId: string;
  messages: Message[];
  updatedAt: string;
}

export class ChatStore {
  private readonly baseDir: string;

  constructor(baseDir: string = DEFAULT_DATA_DIR) {
    this.baseDir = baseDir;
    this.ensureBaseDir();
  }

  private ensureBaseDir() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    const auditDir = path.join(this.baseDir, "audit");
    if (!fs.existsSync(auditDir)) {
      fs.mkdirSync(auditDir, { recursive: true });
    }
    const planDir = path.join(this.baseDir, "plans");
    if (!fs.existsSync(planDir)) {
      fs.mkdirSync(planDir, { recursive: true });
    }
  }

  private sessionFile(sessionId: string) {
    return path.join(this.baseDir, `${sessionId}.jsonl`);
  }

  private planFile(traceId: string) {
    return path.join(this.baseDir, "plans", `${traceId}.json`);
  }

  private auditFile(traceId: string) {
    return path.join(this.baseDir, "audit", `${traceId}.json`);
  }

  async createSession(sessionId?: string) {
    const id = sessionId ?? uuidv4();
    const file = this.sessionFile(id);
    if (!fs.existsSync(file)) {
      await fsp.writeFile(file, "");
    }
    return id;
  }

  async appendMessages(sessionId: string, messages: Message[]) {
    const file = this.sessionFile(sessionId);
    await this.createSession(sessionId);
    const lines = messages.map((message) => JSON.stringify(message));
    await fsp.appendFile(file, lines.join("\n") + "\n");
  }

  async loadSession(sessionId: string): Promise<SessionRecord | null> {
    const file = this.sessionFile(sessionId);
    if (!fs.existsSync(file)) {
      return null;
    }
    const contents = await fsp.readFile(file, "utf8");
    const messages = contents
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Message);
    return {
      sessionId,
      messages,
      updatedAt: messages.length ? messages[messages.length - 1].createdAt : new Date().toISOString()
    };
  }

  async deleteSession(sessionId: string) {
    const file = this.sessionFile(sessionId);
    if (fs.existsSync(file)) {
      await fsp.unlink(file);
    }
  }

  async listSessionIds(): Promise<string[]> {
    const entries = await fsp.readdir(this.baseDir);
    return entries
      .filter((entry) => entry.endsWith(".jsonl"))
      .map((entry) => entry.replace(/\.jsonl$/, ""));
  }

  async savePlan(plan: Plan) {
    const file = this.planFile(plan.traceId);
    await fsp.writeFile(file, JSON.stringify(plan, null, 2));
  }

  async getPlan(traceId: string): Promise<Plan | null> {
    const file = this.planFile(traceId);
    if (!fs.existsSync(file)) {
      return null;
    }
    const raw = await fsp.readFile(file, "utf8");
    return JSON.parse(raw) as Plan;
  }

  async deletePlan(traceId: string) {
    const file = this.planFile(traceId);
    if (fs.existsSync(file)) {
      await fsp.unlink(file);
    }
  }

  async saveAudit(log: AuditLog) {
    const file = this.auditFile(log.traceId);
    await fsp.writeFile(file, JSON.stringify(log, null, 2));
  }

  async getAudit(traceId: string): Promise<AuditLog | null> {
    const file = this.auditFile(traceId);
    if (!fs.existsSync(file)) {
      return null;
    }
    const raw = await fsp.readFile(file, "utf8");
    return JSON.parse(raw) as AuditLog;
  }
}

export const defaultStore = new ChatStore();
