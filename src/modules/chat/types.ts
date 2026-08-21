import { z } from "zod";
import {
  agentWorkflowStateSchema,
  type AgentWorkflowState,
} from "@/modules/agent/workflow-state";

export type ChatRole = "user" | "assistant";

export interface WorkspaceUser {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export type AttachmentKind = "text" | "image" | "pdf";

export interface ChatAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: AttachmentKind;
  content: string;
  redactionCount?: number;
}

export interface ChatHistoryMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  message: string;
  conversationId: string;
  history: ChatHistoryMessage[];
  contextSummary?: string;
  workflowState?: AgentWorkflowState;
  attachments: ChatAttachment[];
}

export interface SourceDocument {
  id: string;
  citationIndex: number;
  title: string;
  heading: string;
  /** Present on v2 sources; optional for conversations persisted before the v2 index. */
  breadcrumb?: string[];
  path?: string;
  service: string;
  url: string;
  snippet: string;
  score: number;
}

export type Confidence = "high" | "medium" | "low";

export interface SupportTicketDraft {
  subject: string;
  body: string;
}

export interface SupportTicketState {
  draft: SupportTicketDraft;
  status: "ready";
}

export type AgentEvent =
  | { type: "status"; message: string }
  | { type: "sources"; sources: SourceDocument[] }
  | { type: "delta"; text: string }
  | { type: "quota"; remaining: number; resetsAt: string }
  | { type: "ticket"; draft: SupportTicketDraft }
  | { type: "workflow"; state: AgentWorkflowState }
  | {
      type: "meta";
      requestId: string;
      confidence: Confidence;
      intent: string;
      redactionCount: number;
      model: string;
      latencyMs: number;
    }
  | { type: "error"; message: string; retryable: boolean }
  | { type: "done" };

const attachmentSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(240),
  mimeType: z.string().min(1).max(120),
  size: z.number().int().nonnegative().max(10_485_760),
  kind: z.enum(["text", "image", "pdf"]),
  content: z.string().max(14_500_000),
  redactionCount: z.number().int().nonnegative().optional(),
});

export const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(20_000),
  conversationId: z.string().min(1).max(100),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(20_000),
      }),
    )
    .max(16)
    .default([]),
  contextSummary: z.string().max(4_000).default(""),
  workflowState: agentWorkflowStateSchema.optional(),
  attachments: z.array(attachmentSchema).max(3).default([]),
}).superRefine((value, context) => {
  const totalBytes = value.attachments.reduce((sum, attachment) => sum + attachment.size, 0);
  if (totalBytes > 10_485_760) {
    context.addIssue({
      code: "custom",
      path: ["attachments"],
      message: "Total attachment size exceeds 10 MB",
    });
  }
  for (const [index, attachment] of value.attachments.entries()) {
    const mimeMatchesKind = attachment.kind === "image"
      ? attachment.mimeType.startsWith("image/")
      : attachment.kind === "pdf"
        ? attachment.mimeType === "application/pdf"
        : !attachment.mimeType.startsWith("image/") && attachment.mimeType !== "application/pdf";
    if (!mimeMatchesKind) {
      context.addIssue({
        code: "custom",
        path: ["attachments", index, "mimeType"],
        message: "Attachment kind and MIME type do not match",
      });
    }
  }
});

export interface StoredMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  sources?: SourceDocument[];
  attachments?: Omit<ChatAttachment, "content">[];
  status?: "streaming" | "complete" | "error";
  meta?: {
    confidence?: Confidence;
    intent?: string;
    requestId?: string;
    redactionCount?: number;
  };
  workflow?: AgentWorkflowState;
  ticket?: SupportTicketState;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: StoredMessage[];
  agentState?: AgentWorkflowState;
}
