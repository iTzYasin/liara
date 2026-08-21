import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type {
  EvaluationJudge,
  EvaluationTurn,
  GoldenScenario,
  SemanticAssessment,
} from "@/modules/evaluation/evaluation-runner";

interface GeminiJudgeClient {
  models: {
    generateContent(input: Record<string, unknown>): Promise<{
      text?: string;
      modelVersion?: string;
    }>;
  };
}

const semanticAssessmentSchema = z.object({
  requiredFactsCovered: z.array(z.boolean()),
  forbiddenClaimsPresent: z.array(z.string()),
  entailedCitationIndexes: z.array(z.number().int().positive()),
  unsupportedCitationIndexes: z.array(z.number().int().positive()),
}).strict();

const responseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "requiredFactsCovered",
    "forbiddenClaimsPresent",
    "entailedCitationIndexes",
    "unsupportedCitationIndexes",
  ],
  properties: {
    requiredFactsCovered: { type: "array", items: { type: "boolean" } },
    forbiddenClaimsPresent: { type: "array", items: { type: "string" } },
    entailedCitationIndexes: { type: "array", items: { type: "integer", minimum: 1 } },
    unsupportedCitationIndexes: { type: "array", items: { type: "integer", minimum: 1 } },
  },
} as const;

function judgePrompt(scenario: GoldenScenario, turn: EvaluationTurn) {
  const sources = turn.sources.map((source) => ({
    citationIndex: source.citationIndex,
    title: source.title,
    heading: source.heading,
    path: source.path,
    url: source.url,
    snippet: source.snippet,
  }));

  return [
    "شما داور سخت‌گیر یک دستیار RAG فارسی هستید.",
    "فقط بر اساس پاسخ و متن منابع داده‌شده قضاوت کنید؛ از دانش بیرونی استفاده نکنید.",
    "برای هر requiredFact دقیقاً یک boolean و با همان ترتیب برگردانید.",
    "یک fact فقط وقتی پوشش‌داده‌شده است که پاسخ معنای آن را واقعاً منتقل کند.",
    "forbiddenClaimsPresent فقط مواردی را برگرداند که واقعاً در پاسخ ادعا شده‌اند.",
    "هر کاربرد [[n]] را به ادعای بلافاصله مرتبط با آن وصل کنید. اگر حتی یکی از کاربردهای یک شماره منبع پشتیبانی نشود، آن شماره را unsupported بدانید.",
    "شماره‌های citation استفاده‌شده و پشتیبانی‌شده را در entailedCitationIndexes و موارد بدون پشتوانه را در unsupportedCitationIndexes قرار دهید.",
    "فقط JSON مطابق schema خروجی بدهید.",
    "",
    `شناسه سناریو: ${scenario.id}`,
    `پرسش: ${scenario.question}`,
    `حقایق الزامی: ${JSON.stringify(scenario.expected.requiredFacts)}`,
    `ادعاهای ممنوع: ${JSON.stringify(scenario.expected.forbiddenClaims)}`,
    `پاسخ نامزد: ${turn.answer}`,
    `منابع: ${JSON.stringify(sources)}`,
  ].join("\n");
}

/** Uses a separate Gemini pass to measure semantic facts and claim/source entailment. */
export class GeminiEvaluationJudge implements EvaluationJudge {
  private readonly client: GeminiJudgeClient;
  private activeModelName: string;

  constructor(
    apiKey: string,
    private readonly requestedModel = process.env.GEMINI_EVAL_JUDGE_MODEL
      ?? process.env.GEMINI_MODEL
      ?? "gemini-3.5-flash-lite",
    client?: GeminiJudgeClient,
  ) {
    this.client = client ?? (new GoogleGenAI({ apiKey }) as unknown as GeminiJudgeClient);
    this.activeModelName = requestedModel;
  }

  get name() {
    return `gemini-semantic:${this.activeModelName}`;
  }

  async assess(
    scenario: GoldenScenario,
    turn: EvaluationTurn,
  ): Promise<SemanticAssessment> {
    const response = await this.client.models.generateContent({
      model: this.requestedModel,
      contents: [{ role: "user", parts: [{ text: judgePrompt(scenario, turn) }] }],
      config: {
        temperature: 0,
        maxOutputTokens: 1_000,
        responseMimeType: "application/json",
        responseJsonSchema,
      },
    });
    this.activeModelName = response.modelVersion ?? this.requestedModel;
    if (!response.text) throw new Error("Semantic judge returned an empty response");

    let decoded: unknown;
    try {
      decoded = JSON.parse(response.text);
    } catch {
      throw new Error("Semantic judge returned invalid JSON");
    }
    const parsed = semanticAssessmentSchema.safeParse(decoded);
    if (!parsed.success) {
      throw new Error(`Semantic judge response failed validation: ${parsed.error.message}`);
    }
    if (parsed.data.requiredFactsCovered.length !== scenario.expected.requiredFacts.length) {
      throw new Error(
        `Semantic judge requiredFactsCovered length ${parsed.data.requiredFactsCovered.length} did not match ${scenario.expected.requiredFacts.length}`,
      );
    }

    const validCitationIndexes = new Set(turn.sources.map((source) => source.citationIndex));
    const citedIndexes = new Set(
      [...turn.answer.matchAll(/\[\[(\d+)\]\]/g)].map((match) => Number(match[1])),
    );
    const assessmentIndexes = [
      ...parsed.data.entailedCitationIndexes,
      ...parsed.data.unsupportedCitationIndexes,
    ];
    if (assessmentIndexes.some((index) =>
      !validCitationIndexes.has(index) || !citedIndexes.has(index))) {
      throw new Error("Semantic judge referenced a citation that was not emitted with a valid source");
    }

    return parsed.data;
  }
}
