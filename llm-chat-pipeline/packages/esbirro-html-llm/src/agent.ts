import path from "path";
import fs from "fs-extra";
import matter from "gray-matter";
import Handlebars from "handlebars";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { v4 as uuidv4 } from "uuid";
import { ChatRequest, Message, defaultStore } from "chat-core";
import { createLLMClient, getDefaultModel, LLMClient, StreamEvent } from "llm-client";

const SYSTEM_PROMPT = `Eres "Esbirro HTML", un agente maquetador y editor. Conviertes Markdown/JSON + front-matter en HTML accesible listo para producción.
Reglas:
- No ejecutas JS de usuario; sanitiza HTML.
- Usa estructura semántica (main, article, header, nav, footer).
- Genera TOC a partir de H2/H3; produce CSS inline mínimo y dark-mode friendly.
- Si faltan metadatos, propones valores sin inventar hechos.
- Tu salida final siempre puede invocar herramientas para persistir.`;

const TOOL_DEFINITIONS = [
  {
    name: "render_html",
    description: "Renderiza contenido HTML usando plantillas predefinidas y actualiza el índice y manifiesto.",
    parameters: {
      type: "object",
      properties: {
        slug: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
        excerpt: { type: "string" },
        metadata: { type: "object" }
      },
      required: ["slug", "title", "body"],
      additionalProperties: true
    }
  },
  {
    name: "write_assets",
    description: "Escribe archivos adicionales codificados en base64 dentro de dist/site/assets.",
    parameters: {
      type: "object",
      properties: {
        assets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              content: { type: "string" },
              encoding: { type: "string", enum: ["base64"] }
            },
            required: ["path", "content"],
            additionalProperties: true
          }
        }
      },
      required: ["assets"],
      additionalProperties: false
    }
  }
];

export interface AgentToolResult {
  name: string;
  result: unknown;
}

export class EsbirroAgent {
  private readonly client: LLMClient;
  private readonly store = defaultStore;
  private readonly templateDir: string;

  constructor(templateDir: string = path.resolve(process.cwd(), "packages/esbirro-html-llm/src/templates")) {
    this.client = createLLMClient();
    this.templateDir = templateDir;
  }

  private buildMessages(request: ChatRequest, sessionMessages: Message[]) {
    const base: Message[] = [
      {
        id: uuidv4(),
        role: "system",
        content: SYSTEM_PROMPT,
        createdAt: new Date().toISOString()
      }
    ];
    return [...base, ...sessionMessages, ...request.messages];
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
      })),
      tools: TOOL_DEFINITIONS
    });
    for await (const event of iterator) {
      if (event.type === "message" && event.data && typeof event.data === "object") {
        const message: Message = {
          id: uuidv4(),
          role: "assistant",
          content: (event.data as any).content ?? "",
          createdAt: new Date().toISOString()
        };
        await this.store.appendMessages(sessionId, [message]);
      }
      if (event.type === "tool_call") {
        const toolData = event.data as { name: string; args: string };
        try {
          const parsedArgs = toolData.args ? JSON.parse(toolData.args) : {};
          const result = await this.executeTool(toolData.name, parsedArgs);
          yield { type: "tool_result", data: { name: toolData.name, result } } satisfies StreamEvent;
          const toolMessage: Message = {
            id: uuidv4(),
            role: "tool",
            name: toolData.name,
            content: JSON.stringify(result),
            createdAt: new Date().toISOString()
          };
          await this.store.appendMessages(sessionId, [toolMessage]);
        } catch (error) {
          yield { type: "message", data: { role: "assistant", content: String(error) } } satisfies StreamEvent;
        }
      }
      if (event.type === "done") {
        yield { type: "done", data: { sessionId, ...(event.data as Record<string, unknown> | undefined) } } satisfies StreamEvent;
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
      })),
      tools: TOOL_DEFINITIONS
    });
    const assistantMessages: Message[] = completion.messages.map((message) => ({
      id: uuidv4(),
      role: "assistant",
      content: message.content,
      createdAt: new Date().toISOString()
    }));
    if (assistantMessages.length) {
      await this.store.appendMessages(sessionId, assistantMessages);
    }
    const toolResults: AgentToolResult[] = [];
    if (Array.isArray(completion.toolCalls)) {
      for (const toolCall of completion.toolCalls) {
        const args = typeof toolCall.args === "string" ? JSON.parse(toolCall.args) : toolCall.args;
        const result = await this.executeTool(toolCall.name, args ?? {});
        toolResults.push({ name: toolCall.name, result });
        const toolMessage: Message = {
          id: uuidv4(),
          role: "tool",
          name: toolCall.name,
          content: JSON.stringify(result),
          createdAt: new Date().toISOString()
        };
        await this.store.appendMessages(sessionId, [toolMessage]);
      }
    }
    return {
      sessionId,
      messages: assistantMessages,
      toolResults
    };
  }

  private async executeTool(name: string, args: any) {
    switch (name) {
      case "render_html":
        return this.renderHtml(args ?? {});
      case "write_assets":
        return this.writeAssets(args?.assets ?? []);
      default:
        throw new Error(`Tool ${name} is not implemented`);
    }
  }

  private async renderHtml(payload: any) {
    const body = typeof payload.body === "string" ? payload.body : "";
    const markdown = matter(body);
    const slugSource = payload.slug ?? (markdown.data?.slug as string | undefined) ?? `page-${uuidv4()}`;
    const slug = `${slugSource}`;
    const safeSlug = slug.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase();
    const title = payload.title ?? (markdown.data?.title as string | undefined) ?? "Documento sin título";
    const metadata = { ...markdown.data, ...(payload.metadata ?? {}) };
    const content = markdown.content || body;
    marked.setOptions({ headerIds: true, mangle: false });
    const html = sanitizeHtml(marked.parse(content), {
      allowedTags: sanitizeHtml.defaults.allowedTags,
      allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        h1: ["id"],
        h2: ["id"],
        h3: ["id"],
        h4: ["id"],
        h5: ["id"],
        h6: ["id"],
        a: ["href", "name", "target", "rel"],
        img: ["src", "alt", "title"]
      }
    });

    const template = await this.loadTemplate("post.hbs");
    const base = await this.loadTemplate("base.hbs");

    const toc = this.buildToc(html);

    const compiledPost = Handlebars.compile(template)({
      title,
      html,
      excerpt: payload.excerpt ?? (metadata.excerpt as string | undefined) ?? "",
      toc,
      metadata
    });

    const finalHtml = Handlebars.compile(base)({
      title,
      body: compiledPost,
      metadata
    });

    const distDir = path.resolve(process.cwd(), "dist/site");
    const postPath = path.join(distDir, `${safeSlug}.html`);
    await fs.ensureDir(path.dirname(postPath));
    await fs.writeFile(postPath, finalHtml, "utf8");

    const manifestPath = path.join(distDir, "manifest.json");
    const manifest = (await this.readJson(manifestPath, { pages: [] })) as { pages: any[] };
    const existingIndex = manifest.pages.findIndex((page) => page.slug === safeSlug);
    const entry = {
      slug: safeSlug,
      title,
      updatedAt: new Date().toISOString(),
      metadata
    };
    if (existingIndex >= 0) {
      manifest.pages.splice(existingIndex, 1, entry);
    } else {
      manifest.pages.push(entry);
    }
    manifest.pages.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    await fs.writeJson(manifestPath, manifest, { spaces: 2 });

    const indexTemplate = await this.loadTemplate("index.hbs");
    const compiledIndex = Handlebars.compile(indexTemplate)({
      title: "Contenido",
      pages: manifest.pages
    });
    const baseCompiled = Handlebars.compile(base)({
      title: "Contenido",
      body: compiledIndex,
      metadata: {}
    });
    const indexPath = path.join(distDir, "index.html");
    await fs.writeFile(indexPath, baseCompiled, "utf8");

    return {
      htmlPath: postPath,
      indexPath,
      manifest: manifest.pages
    };
  }

  private buildToc(html: string) {
    const headings = Array.from(html.matchAll(/<h([23]) id="([^"]+)">([^<]+)<\/h[23]>/g)).map((match) => ({
      level: Number(match[1]),
      id: match[2],
      text: match[3]
    }));
    return headings;
  }

  private async writeAssets(assets: Array<{ path: string; content: string; encoding?: string }>) {
    const distDir = path.resolve(process.cwd(), "dist/site/assets");
    await fs.ensureDir(distDir);
    for (const asset of assets) {
      const filePath = path.join(distDir, asset.path);
      await fs.ensureDir(path.dirname(filePath));
      const buffer = asset.encoding === "base64" ? Buffer.from(asset.content, "base64") : Buffer.from(asset.content);
      await fs.writeFile(filePath, buffer);
    }
    return { count: assets.length };
  }

  private async loadTemplate(name: string) {
    const filePath = path.join(this.templateDir, name);
    if (!(await fs.pathExists(filePath))) {
      throw new Error(`Template ${name} not found`);
    }
    return fs.readFile(filePath, "utf8");
  }

  private async readJson<T>(file: string, fallback: T): Promise<T> {
    if (!(await fs.pathExists(file))) {
      await fs.writeJson(file, fallback, { spaces: 2 });
      return fallback;
    }
    return fs.readJson(file) as Promise<T>;
  }
}
