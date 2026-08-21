import type {
  EvaluationReport,
  EvaluationSubject,
  EvaluationTurn,
  GoldenScenario,
} from "@/modules/evaluation/evaluation-runner";

/** Reuses persisted model evidence so scoring changes do not spend model tokens. */
export class ReplayEvaluationSubject implements EvaluationSubject {
  readonly name: string;
  private readonly resultsByScenarioId: Map<string, EvaluationReport["results"][number]>;

  constructor(report: EvaluationReport) {
    this.name = `replay:${report.subject}`;
    this.resultsByScenarioId = new Map(
      report.results.map((result) => [result.scenarioId, result]),
    );
  }

  async run(scenario: GoldenScenario): Promise<EvaluationTurn> {
    const stored = this.resultsByScenarioId.get(scenario.id);
    if (!stored) {
      throw new Error(`Evaluation artifact has no turn for scenario ${scenario.id}`);
    }

    return {
      answer: stored.answer,
      sources: structuredClone(stored.sources),
      intent: stored.observed.intent,
      confidence: stored.observed.confidence,
      model: stored.observed.model,
      latencyMs: stored.latencyMs,
      redactionCount: stored.observed.redactionCount,
    };
  }
}
