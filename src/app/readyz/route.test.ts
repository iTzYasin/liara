import { describe, expect, it } from "vitest";
import { isModelProviderReady } from "@/app/readyz/route";

describe("readyz model provider configuration", () => {
  it("requires the AvalAI key when AvalAI is selected", () => {
    expect(isModelProviderReady({
      MODEL_PROVIDER: "avalai",
      AVALAI_API_KEY: "avalai-test-key",
      GEMINI_API_KEY: "",
      DEMO_MODE: "false",
    })).toBe(true);
    expect(isModelProviderReady({
      MODEL_PROVIDER: "avalai",
      AVALAI_API_KEY: "",
      GEMINI_API_KEY: "gemini-key-must-not-count",
      DEMO_MODE: "false",
    })).toBe(false);
  });

  it("treats demo as ready only when it is explicitly enabled", () => {
    expect(isModelProviderReady({
      MODEL_PROVIDER: "gemini",
      AVALAI_API_KEY: "",
      GEMINI_API_KEY: "",
      DEMO_MODE: "true",
    })).toBe(true);
    expect(isModelProviderReady({
      MODEL_PROVIDER: "gemini",
      AVALAI_API_KEY: "",
      GEMINI_API_KEY: "",
      DEMO_MODE: "false",
    })).toBe(false);
  });
});
