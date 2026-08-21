import { describe, expect, it, vi } from "vitest";
import { GeminiEvaluationJudge } from "@/modules/evaluation/gemini-evaluation-judge";
import type { EvaluationTurn, GoldenScenario } from "@/modules/evaluation/evaluation-runner";

const scenario: GoldenScenario = {
  id: "multi-001",
  category: "multi-step",
  service: "paas",
  question: "دامنه و SSL را چطور تنظیم کنم؟",
  context: [],
  expected: {
    intent: "guided-setup",
    sourcePaths: ["paas/domains/add-domain.md"],
    headings: ["افزودن دامنه"],
    requiredFacts: ["ثبت دامنه", "فعال‌سازی SSL"],
    forbiddenClaims: ["صدور آنی و تضمینی SSL"],
    needsClarification: false,
    confidence: ["high", "medium"],
    escalation: false,
  },
};

const turn: EvaluationTurn = {
  answer: "دامنه را ثبت و سپس SSL را فعال کنید. [[1]]",
  sources: [{
    id: "source-1",
    citationIndex: 1,
    title: "دامنه",
    heading: "افزودن دامنه",
    path: "paas/domains/add-domain.md",
    service: "paas",
    url: "https://docs.liara.ir/paas/domains/add-domain/",
    snippet: "دامنه را ثبت و سپس SSL را فعال کنید.",
    score: 100,
  }],
  intent: "guided-setup",
  confidence: "high",
  model: "candidate",
  latencyMs: 10,
  redactionCount: 0,
};

describe("GeminiEvaluationJudge", () => {
  it("returns strict semantic coverage and citation-entailment evidence", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      modelVersion: "gemini-judge-version",
      text: JSON.stringify({
        requiredFactsCovered: [true, true],
        forbiddenClaimsPresent: [],
        entailedCitationIndexes: [1],
        unsupportedCitationIndexes: [],
      }),
    });
    const judge = new GeminiEvaluationJudge(
      "unused-test-key",
      "gemini-test-judge",
      { models: { generateContent } },
    );

    await expect(judge.assess(scenario, turn)).resolves.toEqual({
      requiredFactsCovered: [true, true],
      forbiddenClaimsPresent: [],
      entailedCitationIndexes: [1],
      unsupportedCitationIndexes: [],
    });
    expect(judge.name).toBe("gemini-semantic:gemini-judge-version");
    expect(generateContent).toHaveBeenCalledOnce();
    expect(generateContent.mock.calls[0][0]).toMatchObject({
      model: "gemini-test-judge",
      config: { responseMimeType: "application/json" },
    });
  });

  it("fails closed when the judge returns a malformed fact vector", async () => {
    const judge = new GeminiEvaluationJudge(
      "unused-test-key",
      "gemini-test-judge",
      {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: JSON.stringify({
              requiredFactsCovered: [true],
              forbiddenClaimsPresent: [],
              entailedCitationIndexes: [1],
              unsupportedCitationIndexes: [],
            }),
          }),
        },
      },
    );

    await expect(judge.assess(scenario, turn)).rejects.toThrow(/requiredFactsCovered/);
  });
});
