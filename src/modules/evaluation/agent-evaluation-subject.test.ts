import { describe, expect, it } from "vitest";
import type { LanguageModelAdapter, ModelTurnInput } from "@/modules/agent/model-adapter";
import { AgentEvaluationSubject } from "@/modules/evaluation/agent-evaluation-subject";
import type { GoldenScenario } from "@/modules/evaluation/evaluation-runner";
import type { DocsRetriever } from "@/modules/retrieval/docs-retriever";

const scenario: GoldenScenario = {
  id: "direct-001",
  category: "direct-single-document",
  service: "paas",
  question: "چطور دامنه را اضافه کنم؟",
  context: [{ name: "note.txt", content: "دامنه example.test است" }],
  expected: {
    intent: "guided-setup",
    sourcePaths: ["paas/domains/add-domain.md"],
    headings: ["افزودن دامنه"],
    requiredFacts: ["ثبت دامنه"],
    forbiddenClaims: [],
    needsClarification: false,
    confidence: ["high"],
    escalation: false,
  },
};

describe("AgentEvaluationSubject", () => {
  it("captures the observable answer, sources and metadata from an agent turn", async () => {
    const retriever: DocsRetriever = {
      async retrieve() {
        return {
          sources: [{
            id: "domain-source",
            citationIndex: 1,
            title: "افزودن دامنه",
            heading: "افزودن دامنه",
            path: "paas/domains/add-domain.md",
            service: "paas",
            url: "https://docs.liara.ir/paas/domains/add-domain/",
            snippet: "دامنه را در پنل ثبت کنید.",
            score: 90,
          }],
          context: [{ sourceId: "domain-source", text: "دامنه را در پنل ثبت کنید." }],
          topScore: 90,
          queryCoverage: 1,
          domainMatched: true,
        };
      },
      async status() {
        return { ready: true, documents: 1, chunks: 1, sourceCommit: "test", backend: "local" as const };
      },
    };
    const model: LanguageModelAdapter = {
      name: "in-memory-model",
      async *stream(input: ModelTurnInput) {
        const properties = (input.responseSchema as {
          properties?: Record<string, unknown>;
        } | undefined)?.properties;
        if (properties && "action" in properties) {
          yield JSON.stringify({
            action: "search_docs",
            intent: "guided-setup",
            outcome: "answer",
            expertise_hint: "beginner",
            response_language: "fa",
            response: "",
            search_query: scenario.question,
            confidence: "high",
          });
          return;
        }
        yield "دامنه را در پنل ثبت کنید. [[1]]";
      },
    };

    const turn = await new AgentEvaluationSubject({ retriever, model }).run(scenario);

    expect(turn).toMatchObject({
      answer: "دامنه را در پنل ثبت کنید. [[1]]",
      intent: "guided-setup",
      confidence: "high",
      model: "in-memory-model",
      redactionCount: 0,
    });
    expect(turn.sources).toHaveLength(1);
    expect(turn.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
