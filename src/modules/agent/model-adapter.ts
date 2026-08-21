import type { ChatAttachment, SourceDocument } from "@/modules/chat/types";

export interface ModelTurnInput {
  systemInstruction: string;
  prompt: string;
  currentUserMessage?: string;
  retrievalContext?: string;
  attachments: ChatAttachment[];
  sources: SourceDocument[];
  responseSchema?: Record<string, unknown>;
}

export interface LanguageModelAdapter {
  readonly name: string;
  readonly structuredOutput?: boolean;
  stream(input: ModelTurnInput): AsyncIterable<string>;
}

export async function collectModelOutput(
  model: LanguageModelAdapter,
  input: ModelTurnInput,
) {
  let output = "";
  for await (const text of model.stream(input)) output += text;
  return output;
}
