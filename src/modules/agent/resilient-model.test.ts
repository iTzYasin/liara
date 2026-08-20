import { describe, expect, it, vi } from "vitest";
import type { LanguageModelAdapter } from "@/modules/agent/agent";
import { ResilientModelAdapter } from "@/modules/agent/resilient-model";

const input = { systemInstruction: "", prompt: "", attachments: [], sources: [] };

async function collect(model: LanguageModelAdapter) {
  const chunks: string[] = [];
  for await (const chunk of model.stream(input)) chunks.push(chunk);
  return chunks.join("");
}

describe("ResilientModelAdapter", () => {
  it("retries a temporary failure before the first token", async () => {
    let attempts = 0;
    const inner: LanguageModelAdapter = {
      name: "fake",
      async *stream() {
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error("unavailable"), { status: 503 });
        yield "پاسخ";
      },
    };
    const model = new ResilientModelAdapter(inner, { baseDelayMs: 0 });
    await expect(collect(model)).resolves.toBe("پاسخ");
    expect(attempts).toBe(2);
  });

  it("does not retry after a partial response", async () => {
    let attempts = 0;
    const inner: LanguageModelAdapter = {
      name: "fake",
      async *stream() {
        attempts += 1;
        yield "نیمه";
        throw Object.assign(new Error("unavailable"), { status: 503 });
      },
    };
    const model = new ResilientModelAdapter(inner, { baseDelayMs: 0 });
    await expect(collect(model)).rejects.toThrow("unavailable");
    expect(attempts).toBe(1);
  });

  it("times out a stalled provider", async () => {
    vi.useFakeTimers();
    const inner: LanguageModelAdapter = {
      name: "fake",
      async *stream() {
        await new Promise(() => undefined);
        yield "never";
      },
    };
    const model = new ResilientModelAdapter(inner, { timeoutMs: 10, maxRetries: 0 });
    const pending = collect(model);
    const assertion = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(11);
    await assertion;
    vi.useRealTimers();
  });
});
