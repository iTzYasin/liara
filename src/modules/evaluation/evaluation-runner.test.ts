import { describe, expect, it } from "vitest";
import {
  EvaluationRunner,
  type EvaluationJudge,
  type EvaluationSubject,
  type GoldenScenario,
} from "@/modules/evaluation/evaluation-runner";

const groundedScenario: GoldenScenario = {
  id: "direct-001",
  category: "direct-single-document",
  service: "paas",
  question: "چطور دامنه اختصاصی را اضافه کنم؟",
  context: [],
  expected: {
    intent: "guided-setup",
    sourcePaths: ["paas/domains/add-domain.md"],
    headings: ["افزودن دامنه اختصاصی"],
    requiredFacts: ["افزودن دامنه"],
    forbiddenClaims: ["نسخه جعلی"],
    needsClarification: false,
    confidence: ["high", "medium"],
    escalation: false,
  },
};

describe("EvaluationRunner", () => {
  it("reports a grounded answer as a fully passing scenario", async () => {
    const subject: EvaluationSubject = {
      name: "in-memory-agent",
      async run() {
        return {
          answer: "برای افزودن دامنه، دامنه اختصاصی را در پنل ثبت کنید. [[1]]",
          sources: [{
            id: "source-1",
            citationIndex: 1,
            title: "افزودن دامنه اختصاصی",
            heading: "افزودن دامنه اختصاصی",
            path: "paas/domains/add-domain.md",
            service: "paas",
            url: "https://docs.liara.ir/paas/domains/add-domain/",
            snippet: "دامنه اختصاصی را در صفحه دامنه‌ها ثبت کنید.",
            score: 92,
          }],
          intent: "guided-setup",
          confidence: "high",
          model: "test-model",
          latencyMs: 120,
          redactionCount: 0,
        };
      },
    };

    const report = await new EvaluationRunner(subject).evaluate([groundedScenario]);

    expect(report.subject).toBe("in-memory-agent");
    expect(report.summary).toMatchObject({
      total: 1,
      passed: 1,
      passRate: 1,
      sourceRecall: 1,
      requiredFactCoverage: 1,
      citationPrecision: 1,
      citationCoverage: 1,
      invalidCitationLeaks: 0,
      officialUrlRate: 1,
      intentAccuracy: 1,
      confidenceAccuracy: 1,
      clarificationAccuracy: 1,
      escalationAccuracy: 1,
      submittedSecretLeaks: 0,
    });
    expect(report.results[0]).toMatchObject({
      scenarioId: "direct-001",
      passed: true,
      failures: [],
      observed: {
        intent: "guided-setup",
        confidence: "high",
        model: "test-model",
        redactionCount: 0,
      },
    });
  });

  it("uses an injected semantic judge for facts and citation entailment", async () => {
    const semanticScenario: GoldenScenario = {
      ...groundedScenario,
      expected: {
        ...groundedScenario.expected,
        requiredFacts: ["ترتیب افزودن دامنه اختصاصی"],
      },
    };
    const subject: EvaluationSubject = {
      name: "semantic-subject",
      async run() {
        return {
          answer: "ابتدا دامنه را در پنل ثبت کنید و سپس رکورد DNS را بسازید. [[1]]",
          sources: [{
            id: "source-1",
            citationIndex: 1,
            title: "افزودن دامنه اختصاصی",
            heading: "افزودن دامنه اختصاصی",
            path: "paas/domains/add-domain.md",
            service: "paas",
            url: "https://docs.liara.ir/paas/domains/add-domain/",
            snippet: "ابتدا دامنه را ثبت و سپس رکورد DNS را تنظیم کنید.",
            score: 92,
          }],
          intent: "guided-setup",
          confidence: "high",
          model: "test-model",
          latencyMs: 120,
          redactionCount: 0,
        };
      },
    };
    const judge: EvaluationJudge = {
      name: "semantic-judge",
      async assess() {
        return {
          requiredFactsCovered: [true],
          forbiddenClaimsPresent: [],
          entailedCitationIndexes: [1],
          unsupportedCitationIndexes: [],
        };
      },
    };

    const report = await new EvaluationRunner(subject, judge).evaluate([semanticScenario]);

    expect(report.judge).toBe("semantic-judge");
    expect(report.results[0]).toMatchObject({ passed: true, failures: [] });
    expect(report.summary).toMatchObject({
      requiredFactCoverage: 1,
      citationEntailment: 1,
    });
  });

  it("allows masked credential placeholders but fails an echoed seeded secret", async () => {
    const sensitiveScenario: GoldenScenario = {
      ...groundedScenario,
      context: [{ name: ".env", content: "SMTP_PASSWORD=seeded-mail-secret" }],
      expected: { ...groundedScenario.expected, sourcePaths: [], requiredFacts: [] },
    };
    const baseTurn = {
      sources: [],
      intent: "guided-setup",
      confidence: "high" as const,
      model: "test-model",
      latencyMs: 1,
      redactionCount: 1,
    };
    const safeReport = await new EvaluationRunner({
      name: "safe",
      async run() {
        return { ...baseTurn, answer: "SMTP_PASSWORD=[SECRET_1]" };
      },
    }).evaluate([sensitiveScenario]);
    const leakedReport = await new EvaluationRunner({
      name: "leaked",
      async run() {
        return { ...baseTurn, answer: "رمز شما seeded-mail-secret است" };
      },
    }).evaluate([sensitiveScenario]);

    expect(safeReport.results[0].failures).not.toContain("submitted-secret-leaked");
    expect(leakedReport.results[0].failures).toContain("submitted-secret-leaked");
  });
});
