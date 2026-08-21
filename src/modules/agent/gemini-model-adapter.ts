import { GoogleGenAI } from "@google/genai";
import type {
  LanguageModelAdapter,
  ModelTurnInput,
} from "@/modules/agent/model-adapter";
import { structuredModelResponseJsonSchema } from "@/modules/agent/model-response";

interface GeminiModelClient {
  models: {
    generateContentStream(input: Record<string, unknown>): Promise<AsyncIterable<{
      text?: string;
      modelVersion?: string;
    }>>;
  };
}

export class GeminiModelAdapter implements LanguageModelAdapter {
  readonly structuredOutput = true;
  private readonly client: GeminiModelClient;
  private activeModelName: string;

  constructor(
    apiKey: string,
    private readonly requestedModel = process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite",
    client?: GeminiModelClient,
  ) {
    this.client = client ?? (new GoogleGenAI({ apiKey }) as unknown as GeminiModelClient);
    this.activeModelName = requestedModel;
  }

  get name() {
    return this.activeModelName;
  }

  async *stream(input: ModelTurnInput): AsyncIterable<string> {
    const parts: Array<Record<string, unknown>> = [{ text: input.prompt }];
    for (const attachment of input.attachments) {
      if (attachment.kind === "text") continue;
      parts.push({
        inlineData: {
          mimeType: attachment.mimeType,
          data: attachment.content.replace(/^data:[^;]+;base64,/, ""),
        },
      });
    }

    const responseStream = await this.client.models.generateContentStream({
      model: this.requestedModel,
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction: input.systemInstruction,
        maxOutputTokens: 2_000,
        responseMimeType: "application/json",
        responseJsonSchema: input.responseSchema ?? structuredModelResponseJsonSchema,
      },
    });

    for await (const response of responseStream) {
      this.activeModelName = response.modelVersion ?? this.activeModelName;
      if (response.text) yield response.text;
    }
  }
}
