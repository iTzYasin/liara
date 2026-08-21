import { afterEach, describe, expect, it, vi } from "vitest";
import { createModelAdapter } from "@/modules/agent/model-provider";

describe("createModelAdapter", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("selects the configured AvalAI model instead of silently using demo mode", () => {
    vi.stubEnv("MODEL_PROVIDER", "avalai");
    vi.stubEnv("AVALAI_API_KEY", "unused-test-key");
    vi.stubEnv("AVALAI_BASE_URL", "https://api.avalai.ir/v1");
    vi.stubEnv("AVALAI_MODEL", "deepseek-v4-flash");
    vi.stubEnv("DEMO_MODE", "false");

    const model = createModelAdapter();

    expect(model.name).toBe("deepseek-v4-flash");
    expect(model.structuredOutput).toBe(true);
  });

  it("fails configuration when AvalAI is selected without an API key", () => {
    vi.stubEnv("MODEL_PROVIDER", "avalai");
    vi.stubEnv("AVALAI_API_KEY", "");
    vi.stubEnv("DEMO_MODE", "false");

    expect(() => createModelAdapter()).toThrow("AVALAI_API_KEY");
  });

  it("never enables demo mode implicitly when Gemini has no API key", () => {
    vi.stubEnv("MODEL_PROVIDER", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("DEMO_MODE", "false");

    expect(() => createModelAdapter()).toThrow("GEMINI_API_KEY");
  });
});
