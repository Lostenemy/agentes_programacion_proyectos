import path from "path";
import fs from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import simpleGit from "simple-git";
import SSH2Promise from "ssh2-promise";
import { v4 as uuidv4 } from "uuid";
import { ChatRequest, Message, Plan, auditLogSchema, defaultStore, planSchema } from "chat-core";
import { createLLMClient, getDefaultModel, LLMClient, StreamEvent } from "llm-client";
import { isAllowed } from "./allowlist.js";

const execAsync = promisify(exec);

const SYSTEM_PROMPT = `Eres "DevOps", un agente de operaciones con herramientas restringidas.
Tu respuesta a cualquier petición es SIEMPRE un PLAN en JSON (no ejecutar):
{traceId, intent, risk, approvals_required, steps[], commands[], tools[]}
Solo generas comandos de una allowlist y explícitas validaciones previas/posteriores.
No manejas secretos en claro: usa variables y secretos del entorno.`;

export class DevOpsAgent {
  private readonly client: LLMClient;
  private readonly store = defaultStore;

  constructor() {
    this.client = createLLMClient();
  }

  private buildMessages(request: ChatRequest, history: Message[]) {
    const systemMessage: Message = {
      id: uuidv4(),
      role: "system",
      content: SYSTEM_PROMPT,
      createdAt: new Date().toISOString()
    };
    return [systemMessage, ...history, ...request.messages];
  }

  async *streamChat(request: ChatRequest): AsyncGenerator<StreamEvent, void, void> {
    const sessionId = request.sessionId ? request.sessionId : await this.store.createSession();
    const session = (await this.store.loadSession(sessionId)) ?? { sessionId, messages: [], updatedAt: new Date().toISOString() };
    const fullMessages = this.buildMessages(request, session.messages);
    const iterator = this.client.stream({
      model: getDefaultModel(),
      messages: fullMessages.map((message) => ({
        role: message.role,
        content: message.content,
        name: message.name
      }))
    });
    let accumulated = "";
    for await (const event of iterator) {
      if (event.type === "message" && event.data && typeof event.data === "object") {
        const chunk = (event.data as any).content ?? "";
        accumulated += chunk;
        const message: Message = {
          id: uuidv4(),
          role: "assistant",
          content: chunk,
          createdAt: new Date().toISOString()
        };
        await this.store.appendMessages(sessionId, [message]);
        yield event;
        continue;
      }
      if (event.type === "done") {
        const plan = await this.tryPersistPlan(accumulated);
        yield { type: "done", data: { traceId: plan?.traceId ?? null, sessionId } } satisfies StreamEvent;
        break;
      }
      yield event;
    }
  }

  async chat(request: ChatRequest) {
    const sessionId = request.sessionId ? request.sessionId : await this.store.createSession();
    const session = (await this.store.loadSession(sessionId)) ?? { sessionId, messages: [], updatedAt: new Date().toISOString() };
    const fullMessages = this.buildMessages(request, session.messages);
    const completion = await this.client.chat({
      model: getDefaultModel(),
      messages: fullMessages.map((message) => ({
        role: message.role,
        content: message.content,
        name: message.name
      }))
    });
    const messages: Message[] = completion.messages.map((message) => ({
      id: uuidv4(),
      role: "assistant",
      content: message.content,
      createdAt: new Date().toISOString()
    }));
    let plan: Plan | null = null;
    if (messages.length) {
      await this.store.appendMessages(sessionId, messages);
      plan = await this.tryPersistPlan(messages.map((msg) => msg.content).join(""));
    }
    return { sessionId, messages, plan };
  }

  private async tryPersistPlan(content: string): Promise<Plan | null> {
    try {
      const parsed = JSON.parse(content);
      const plan = planSchema.parse(parsed);
      await this.store.savePlan(plan);
      return plan;
    } catch (error) {
      return null;
    }
  }

  async executePlan(traceId: string, user: string) {
    const plan = await this.store.getPlan(traceId);
    if (!plan) {
      throw new Error(`Plan ${traceId} not found`);
    }
    const logs: { timestamp: string; level: "info" | "error"; message: string }[] = [];
    const startedAt = new Date().toISOString();
    try {
      for (const command of plan.commands) {
        if (!isAllowed(command)) {
          throw new Error(`Command not allowed: ${command}`);
        }
        logs.push({ timestamp: new Date().toISOString(), level: "info", message: `Executing: ${command}` });
        await this.runCommand(command, logs);
      }
      const audit = auditLogSchema.parse({
        traceId: plan.traceId,
        user,
        plan,
        logs,
        startedAt,
        finishedAt: new Date().toISOString()
      });
      await this.store.saveAudit(audit);
      return audit;
    } catch (error: any) {
      logs.push({ timestamp: new Date().toISOString(), level: "error", message: error.message ?? String(error) });
      const audit = auditLogSchema.parse({
        traceId: plan.traceId,
        user,
        plan,
        logs,
        startedAt,
        finishedAt: new Date().toISOString()
      });
      await this.store.saveAudit(audit);
      throw error;
    }
  }

  private async runCommand(command: string, logs: Array<{ timestamp: string; level: "info" | "error"; message: string }>) {
    const trimmed = command.trim();
    if (trimmed.startsWith("git ")) {
      await this.runGitCommand(trimmed, logs);
    } else if (trimmed.startsWith("docker compose")) {
      await this.runLocalCommand(trimmed, logs);
    } else if (trimmed.startsWith("rsync")) {
      await this.runLocalCommand(this.replaceRemoteDir(trimmed), logs);
    } else {
      await this.runRemoteCommand(trimmed, logs);
    }
  }

  private async runGitCommand(command: string, logs: Array<{ timestamp: string; level: "info" | "error"; message: string }>) {
    const git = simpleGit({ baseDir: process.cwd() });
    if (command === "git pull --rebase") {
      await git.pull(["--rebase"]);
      logs.push({ timestamp: new Date().toISOString(), level: "info", message: "git pull --rebase completed" });
    } else if (command === "git status") {
      const status = await git.status();
      logs.push({ timestamp: new Date().toISOString(), level: "info", message: JSON.stringify(status) });
    } else {
      throw new Error(`Unsupported git command: ${command}`);
    }
  }

  private async runLocalCommand(command: string, logs: Array<{ timestamp: string; level: "info" | "error"; message: string }>) {
    const { stdout, stderr } = await execAsync(command, { cwd: process.cwd(), env: process.env });
    if (stdout) {
      logs.push({ timestamp: new Date().toISOString(), level: "info", message: stdout });
    }
    if (stderr) {
      logs.push({ timestamp: new Date().toISOString(), level: "error", message: stderr });
    }
  }

  private async runRemoteCommand(command: string, logs: Array<{ timestamp: string; level: "info" | "error"; message: string }>) {
    const host = process.env.SSH_HOST;
    const user = process.env.SSH_USER;
    const port = Number(process.env.SSH_PORT || 22);
    const keyPath = process.env.SSH_KEY_PATH;
    if (!host || !user || !keyPath) {
      throw new Error("SSH configuration missing");
    }
    const privateKey = await fs.readFile(path.resolve(keyPath), "utf8");
    const ssh = new SSH2Promise({
      host,
      username: user,
      port,
      privateKey
    });
    try {
      const remoteCommand = this.replaceRemoteDir(command);
      if (!isAllowed(command)) {
        throw new Error(`Command not allowed: ${command}`);
      }
      const result = await ssh.exec(remoteCommand);
      logs.push({ timestamp: new Date().toISOString(), level: "info", message: String(result) });
    } finally {
      ssh.close();
    }
  }

  private replaceRemoteDir(command: string) {
    const remoteDir = process.env.REMOTE_SITE_DIR || "/srv/site";
    return command.replace(/REMOTE_SITE_DIR/g, remoteDir);
  }
}
