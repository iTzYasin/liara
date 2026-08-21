import type { LanguageModelAdapter } from "@/modules/agent/model-adapter";
import { structuredModelResponseJsonSchema } from "@/modules/agent/model-response";

interface ChatCompletionChunk {
  model?: string;
  choices?: Array<{
    delta?: { content?: string | null };
  }>;
}

export class AvalAIModelAdapter implements LanguageModelAdapter {
  readonly structuredOutput = true;
  private activeModelName: string;

  constructor(
    private readonly apiKey: string,
    private readonly requestedModel = "deepseek-v4-flash",
    private readonly baseUrl = "https://api.avalai.ir/v1",
    private readonly providerFetch: typeof fetch = fetch,
  ) {
    this.activeModelName = requestedModel;
  }

  get name() {
    return this.activeModelName;
  }

  async *stream(input: Parameters<LanguageModelAdapter["stream"]>[0]): AsyncIterable<string> {
    const response = await this.providerFetch(
      `${this.baseUrl.replace(/\/+$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.requestedModel,
          messages: [
            {
              role: "system",
              content: [
                input.systemInstruction,
                "خروجی باید فقط یک شیء JSON معتبر مطابق schema زیر باشد:",
                JSON.stringify(input.responseSchema ?? structuredModelResponseJsonSchema),
              ].join("\n\n"),
            },
            { role: "user", content: input.prompt },
          ],
          stream: true,
          max_tokens: 2_000,
          response_format: { type: "json_object" },
        }),
      },
    );

    if (!response.ok) throw new Error(`AvalAI request failed with status ${response.status}`);
    if (!response.body) throw new Error("AvalAI response stream is unavailable");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = done ? "" : (lines.pop() ?? "");

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        const chunk = JSON.parse(data) as ChatCompletionChunk;
        if (chunk.model) this.activeModelName = chunk.model;
        const text = chunk.choices?.[0]?.delta?.content;
        if (text) yield text;
      }

      if (done) return;
    }
  }
}
