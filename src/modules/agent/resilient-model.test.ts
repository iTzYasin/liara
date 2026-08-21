import { describe, expect, it, vi } from "vitest";
import type { LanguageModelAdapter } from "@/modules/agent/model-adapter";
import {
  FallbackModelAdapter,
  MODEL_RESPONSE_TIMEOUT_MS,
  ResilientModelAdapter,
} from "@/modules/agent/resilient-model";

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

  it("allows two minutes for a model response by default", async () => {
    vi.useFakeTimers();
    const inner: LanguageModelAdapter = {
      name: "fake",
      async *stream() {
        await new Promise(() => undefined);
        yield "never";
      },
    };
    const model = new ResilientModelAdapter(inner, { maxRetries: 0 });
    const pending = collect(model);
    const assertion = expect(pending).rejects.toThrow("timed out");

    await vi.advanceTimersByTimeAsync(MODEL_RESPONSE_TIMEOUT_MS - 1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    vi.useRealTimers();
  });

  it("falls back after a transient primary failure and reports the used model", async () => {
    const primary: LanguageModelAdapter = {
      name: "primary-flash",
      structuredOutput: true,
      async *stream() {
        throw Object.assign(new Error("high demand"), { status: 503 });
      },
    };
    const fallback: LanguageModelAdapter = {
      name: "fallback-lite",
      structuredOutput: true,
      async *stream() {
        yield "پاسخ پشتیبان";
      },
    };
    const model = new FallbackModelAdapter(primary, fallback);

    await expect(collect(model)).resolves.toBe("پاسخ پشتیبان");
    expect(model.name).toBe("fallback-lite");
    expect(model.structuredOutput).toBe(true);
  });
});
