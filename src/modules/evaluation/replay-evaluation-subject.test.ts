import { describe, expect, it } from "vitest";
import {
  EvaluationRunner,
  type EvaluationSubject,
  type GoldenScenario,
} from "@/modules/evaluation/evaluation-runner";
import { ReplayEvaluationSubject } from "@/modules/evaluation/replay-evaluation-subject";

const scenario: GoldenScenario = {
  id: "direct-001",
  category: "direct-single-document",
  service: "paas",
  question: "چطور دامنه را اضافه کنم؟",
  context: [],
  expected: {
    intent: "guided-setup",
    sourcePaths: [],
    headings: [],
    requiredFacts: [],
    forbiddenClaims: [],
    needsClarification: false,
    confidence: ["high"],
    escalation: false,
  },
};

describe("ReplayEvaluationSubject", () => {
  it("replays stored observable turns without calling the original model", async () => {
    let calls = 0;
    const original: EvaluationSubject = {
      name: "live-model",
      async run() {
        calls += 1;
        return {
          answer: "پاسخ ذخیره‌شده",
          sources: [],
          intent: "guided-setup",
          confidence: "high",
          model: "gemini-test",
          latencyMs: 42,
          redactionCount: 0,
        };
      },
    };
    const report = await new EvaluationRunner(original).evaluate([scenario]);
    const replay = new ReplayEvaluationSubject(report);

    await expect(replay.run(scenario)).resolves.toMatchObject({
      answer: "پاسخ ذخیره‌شده",
      intent: "guided-setup",
      confidence: "high",
      model: "gemini-test",
      latencyMs: 42,
    });
    expect(replay.name).toBe("replay:live-model");
    expect(calls).toBe(1);
  });

  it("fails loudly when an artifact does not contain the requested scenario", async () => {
    const emptyReport = await new EvaluationRunner({
      name: "empty",
      async run() {
        throw new Error("must not run");
      },
    }).evaluate([]);

    await expect(new ReplayEvaluationSubject(emptyReport).run(scenario))
      .rejects.toThrow("direct-001");
  });
});
