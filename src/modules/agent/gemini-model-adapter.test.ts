import { describe, expect, it, vi } from "vitest";
import { GeminiModelAdapter } from "@/modules/agent/gemini-model-adapter";
import type { LanguageModelAdapter } from "@/modules/agent/model-adapter";

describe("GeminiModelAdapter", () => {
  it("consumes the provider streaming API instead of buffering generateContent", async () => {
    const generateContentStream = vi.fn().mockResolvedValue((async function* () {
      yield { text: "{\"answer", modelVersion: "gemini-stream-version" };
      yield { text: "_summary\":\"ok\"}" };
    })());
    const model: LanguageModelAdapter = new GeminiModelAdapter(
      "unused-test-key",
      "gemini-stream-test",
      { models: { generateContentStream } },
    );
    const chunks: string[] = [];

    for await (const chunk of model.stream({
      systemInstruction: "system",
      prompt: "prompt",
      attachments: [],
      sources: [],
    })) chunks.push(chunk);

    expect(chunks).toEqual(["{\"answer", "_summary\":\"ok\"}"]);
    expect(model.name).toBe("gemini-stream-version");
    expect(generateContentStream).toHaveBeenCalledOnce();
  });
});
