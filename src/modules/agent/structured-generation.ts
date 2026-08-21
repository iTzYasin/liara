import {
  collectModelOutput,
  type LanguageModelAdapter,
  type ModelTurnInput,
} from "@/modules/agent/model-adapter";
import {
  parseStructuredModelResponse,
  type StructuredModelResponse,
} from "@/modules/agent/model-response";

interface StructuredGenerationResult {
  response?: StructuredModelResponse;
  inputCharacters: number;
}

export class ModelContractError extends Error {
  constructor(message = "The model did not return a safe structured response") {
    super(message);
    this.name = "ModelContractError";
  }
}

/**
 * Treats provider output as untrusted data. One constrained repair turn is
 * allowed; malformed output never falls through to the user-facing stream.
 */
export async function generateStructuredResponse(
  model: LanguageModelAdapter,
  input: ModelTurnInput,
  minimumCitationCount = 1,
): Promise<StructuredGenerationResult> {
  const firstOutput = await collectModelOutput(model, input);
  const firstParsed = parseStructuredModelResponse(firstOutput);
  const firstCitationCount = firstParsed.success
    ? new Set(firstParsed.data.citations).size
    : 0;
  const needsCoverageRepair = firstParsed.success
    && !firstParsed.data.needs_clarification
    && firstParsed.data.confidence !== "low"
    && firstCitationCount < minimumCitationCount;
  if (firstParsed.success && !needsCoverageRepair) {
    return { response: firstParsed.data, inputCharacters: input.prompt.length };
  }

  const repairPrompt = [
    input.prompt,
    "",
    needsCoverageRepair
      ? `پاسخ قبلی یک بخش از درخواست چندمرحله‌ای را جا انداخته است. همه زیرمسئله‌ها را پوشش بده و در citations حداقل ${minimumCitationCount} منبع مرتبط ثبت کن.`
      : "خروجی قبلی با قرارداد JSON معتبر نبود. همان پاسخ را فقط به شکل یک شیء JSON معتبر و دقیقاً مطابق schema بازسازی کن؛ توضیح، markdown fence یا کلید اضافه ننویس.",
    "خروجی قبلی:",
    firstOutput.slice(0, 6_000),
  ].join("\n");
  const repairedOutput = await collectModelOutput(model, { ...input, prompt: repairPrompt });
  const repairedParsed = parseStructuredModelResponse(repairedOutput);
  const repairedCitationCount = repairedParsed.success
    ? new Set(repairedParsed.data.citations).size
    : 0;
  const repairedStillMissingCoverage = repairedParsed.success
    && !repairedParsed.data.needs_clarification
    && repairedParsed.data.confidence !== "low"
    && repairedCitationCount < minimumCitationCount;
  return {
    response: repairedParsed.success && !repairedStillMissingCoverage
      ? repairedParsed.data
      : undefined,
    inputCharacters: input.prompt.length + repairPrompt.length,
  };
}
