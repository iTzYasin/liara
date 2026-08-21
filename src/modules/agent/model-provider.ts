import { AvalAIModelAdapter } from "@/modules/agent/avalai-model-adapter";
import { DemoModelAdapter } from "@/modules/agent/demo-model-adapter";
import { GeminiModelAdapter } from "@/modules/agent/gemini-model-adapter";
import type { LanguageModelAdapter } from "@/modules/agent/model-adapter";
import {
  FallbackModelAdapter,
  ResilientModelAdapter,
} from "@/modules/agent/resilient-model";

let modelSingleton: LanguageModelAdapter | undefined;
let modelSignature = "";

export function createModelAdapter(): LanguageModelAdapter {
  const provider = process.env.MODEL_PROVIDER ?? "gemini";
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const avalaiApiKey = process.env.AVALAI_API_KEY;
  const signature = [
    provider,
    Boolean(geminiApiKey),
    Boolean(avalaiApiKey),
    process.env.DEMO_MODE,
    process.env.GEMINI_MODEL,
    process.env.GEMINI_FALLBACK_MODEL,
    process.env.AVALAI_MODEL,
    process.env.AVALAI_BASE_URL,
  ].join(":");
  if (modelSingleton && modelSignature === signature) return modelSingleton;

  if (process.env.DEMO_MODE === "true") {
    modelSingleton = new ResilientModelAdapter(new DemoModelAdapter());
  } else if (provider === "avalai") {
    if (!avalaiApiKey) {
      throw new Error("AVALAI_API_KEY is required when MODEL_PROVIDER=avalai");
    }
    modelSingleton = new ResilientModelAdapter(new AvalAIModelAdapter(
      avalaiApiKey,
      process.env.AVALAI_MODEL ?? "deepseek-v4-flash",
      process.env.AVALAI_BASE_URL ?? "https://api.avalai.ir/v1",
    ));
  } else if (!geminiApiKey) {
    throw new Error("GEMINI_API_KEY is required when MODEL_PROVIDER=gemini");
  } else {
    const primaryModel = process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";
    const fallbackModel = process.env.GEMINI_FALLBACK_MODEL ?? "gemini-flash-lite-latest";
    const primary = new ResilientModelAdapter(
      new GeminiModelAdapter(geminiApiKey, primaryModel),
      { maxRetries: 0 },
    );
    modelSingleton = fallbackModel && fallbackModel !== primaryModel
      ? new FallbackModelAdapter(
          primary,
          new ResilientModelAdapter(new GeminiModelAdapter(geminiApiKey, fallbackModel)),
        )
      : primary;
  }

  modelSignature = signature;
  return modelSingleton;
}
