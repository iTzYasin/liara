import { describe, expect, it, vi } from "vitest";
import { AvalAIModelAdapter } from "@/modules/agent/avalai-model-adapter";
import type { LanguageModelAdapter } from "@/modules/agent/model-adapter";

describe("AvalAIModelAdapter", () => {
  it("streams structured chat completions through the AvalAI OpenAI-compatible endpoint", async () => {
    const providerStream = [
      'data: {"id":"chat-1","model":"deepseek-v4-flash","choices":[{"index":0,"delta":{"role":"assistant","content":"{\\"answer"},"finish_reason":null}]}',
      "",
      'data: {"id":"chat-1","model":"deepseek-v4-flash","choices":[{"index":0,"delta":{"content":"_summary\\\":\\\"ok\\\"}"},"finish_reason":"stop"}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    const providerFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(providerStream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));
    const model: LanguageModelAdapter = new AvalAIModelAdapter(
      "unused-test-key",
      "deepseek-v4-flash",
      "https://api.avalai.ir/v1",
      providerFetch,
    );
    const chunks: string[] = [];

    for await (const chunk of model.stream({
      systemInstruction: "system-policy",
      prompt: "user-context",
      attachments: [],
      sources: [],
    })) chunks.push(chunk);

    expect(chunks.join("")).toBe('{"answer_summary":"ok"}');
    expect(model.name).toBe("deepseek-v4-flash");
    expect(providerFetch).toHaveBeenCalledOnce();

    const [url, init] = providerFetch.mock.calls[0];
    expect(url).toBe("https://api.avalai.ir/v1/chat/completions");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer unused-test-key");
    const payload = JSON.parse(String(init?.body));
    expect(payload).toEqual({
      model: "deepseek-v4-flash",
      messages: [
        { role: "system", content: expect.stringContaining("system-policy") },
        { role: "user", content: "user-context" },
      ],
      stream: true,
      max_tokens: 2_000,
      response_format: { type: "json_object" },
    });
    expect(payload.messages[0].content).toContain('"answer_summary"');
    expect(payload.messages[0].content).toContain('"needs_clarification"');
  });
});
