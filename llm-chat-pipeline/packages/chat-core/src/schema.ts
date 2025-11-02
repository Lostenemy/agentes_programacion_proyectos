import { z } from "zod";

export const roleSchema = z.union([
  z.literal("system"),
  z.literal("user"),
  z.literal("assistant"),
  z.literal("tool")
]);

export type Role = z.infer<typeof roleSchema>;

export const toolInvocationSchema = z.object({
  name: z.string(),
  args: z.unknown(),
  result: z.unknown().optional()
});

export const messageSchema = z.object({
  id: z.string(),
  role: roleSchema,
  content: z.string(),
  name: z.string().optional(),
  createdAt: z.string(),
  toolInvocation: toolInvocationSchema.optional()
});

export type Message = z.infer<typeof messageSchema>;

export const chatRequestSchema = z.object({
  sessionId: z.string().optional(),
  messages: z.array(messageSchema),
  stream: z.boolean().optional().default(true),
  vars: z.record(z.string()).optional()
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const planSchema = z.object({
  traceId: z.string(),
  intent: z.string(),
  risk: z.string(),
  approvals_required: z.number().nonnegative(),
  steps: z.array(z.string()),
  commands: z.array(z.string()),
  tools: z.array(z.string())
});

export type Plan = z.infer<typeof planSchema>;

export const auditLogSchema = z.object({
  traceId: z.string(),
  user: z.string(),
  plan: planSchema,
  logs: z.array(z.object({
    timestamp: z.string(),
    level: z.enum(["info", "error"]),
    message: z.string()
  })),
  startedAt: z.string(),
  finishedAt: z.string()
});

export type AuditLog = z.infer<typeof auditLogSchema>;
