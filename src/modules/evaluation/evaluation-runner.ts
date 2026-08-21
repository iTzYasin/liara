import type { Confidence, SourceDocument } from "@/modules/chat/types";

export type GoldenCategory =
  | "direct-single-document"
  | "multi-step"
  | "troubleshooting"
  | "clarification"
  | "unanswerable"
  | "escalation"
  | "version-conflict"
  | "prompt-injection-sensitive";

export interface GoldenScenario {
  id: string;
  category: GoldenCategory;
  service: string;
  question: string;
  context: Array<{ name: string; content: string }>;
  expected: {
    intent: string;
    sourcePaths: string[];
    headings: string[];
    requiredFacts: string[];
    forbiddenClaims: string[];
    needsClarification: boolean;
    confidence: Confidence[];
    escalation: boolean;
  };
}

export interface GoldenSet {
  version: string;
  sourceCommit: string;
  generatedAt?: string;
  scenarios: GoldenScenario[];
}

export interface EvaluationTurn {
  answer: string;
  sources: SourceDocument[];
  intent?: string;
  confidence?: Confidence;
  model: string;
  latencyMs: number;
  redactionCount: number;
}

export interface EvaluationSubject {
  readonly name: string;
  run(scenario: GoldenScenario): Promise<EvaluationTurn>;
}

export interface SemanticAssessment {
  requiredFactsCovered: boolean[];
  forbiddenClaimsPresent: string[];
  entailedCitationIndexes: number[];
  unsupportedCitationIndexes: number[];
}

export interface EvaluationJudge {
  readonly name: string;
  assess(scenario: GoldenScenario, turn: EvaluationTurn): Promise<SemanticAssessment>;
}

export interface ScenarioEvaluationResult {
  scenarioId: string;
  category: GoldenCategory;
  passed: boolean;
  failures: string[];
  answer: string;
  sources: SourceDocument[];
  model: string;
  latencyMs: number;
  observed: {
    intent?: string;
    confidence?: Confidence;
    model: string;
    redactionCount: number;
  };
  checks: {
    sourceRecall: number;
    requiredFactCoverage: number;
    citationsEmitted: number;
    citationsValid: number;
    citationsEntailed: number;
    invalidCitationLeaks: number;
    officialUrls: number;
    totalUrls: number;
    intentMatch: boolean;
    confidenceMatch: boolean;
    clarificationCorrect: boolean;
    escalationCorrect: boolean;
    submittedSecretLeaks: number;
  };
}

export interface EvaluationReport {
  version: 1;
  generatedAt: string;
  subject: string;
  judge?: string;
  summary: {
    total: number;
    passed: number;
    passRate: number;
    sourceRecall: number;
    requiredFactCoverage: number;
    citationPrecision: number;
    citationCoverage: number;
    citationEntailment: number;
    invalidCitationLeaks: number;
    officialUrlRate: number;
    intentAccuracy: number;
    confidenceAccuracy: number;
    clarificationAccuracy: number;
    escalationAccuracy: number;
    submittedSecretLeaks: number;
    passRateByCategory: Partial<Record<GoldenCategory, number>>;
  };
  results: ScenarioEvaluationResult[];
}

function ratio(numerator: number, denominator: number) {
  return denominator ? numerator / denominator : 1;
}

function normalize(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u200c\s]+/g, " ")
    .trim()
    .toLocaleLowerCase("fa-IR");
}

function citationIndexes(answer: string) {
  return [...answer.matchAll(/\[\[(\d+)\]\]/g)].map((match) => Number(match[1]));
}

function submittedSecrets(scenario: GoldenScenario) {
  const values = new Set<string>();
  for (const item of scenario.context) {
    for (const match of item.content.matchAll(
      /(?:api[_-]?key|secret(?:[_-]?(?:key|access[_-]?key))?|access[_-]?key|password|passwd|token|client[_-]?secret)\s*[:=]\s*["']?([^\s"';,}]{6,})/gi,
    )) values.add(match[1]);
    for (const match of item.content.matchAll(
      /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|mariadb):\/\/[^:\s/@]+:([^@\s/]+)@/gi,
    )) values.add(match[1]);
    for (const match of item.content.matchAll(
      /\b(?:AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/g,
    )) values.add(match[0]);
    if (/BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/.test(item.content)) {
      for (const line of item.content.split(/\r?\n/)) {
        const value = line.trim();
        if (value.length >= 6 && !value.startsWith("-----")) values.add(value);
      }
    }
  }
  return [...values];
}

function evaluateScenario(
  scenario: GoldenScenario,
  turn: EvaluationTurn,
  semantic?: SemanticAssessment,
): ScenarioEvaluationResult {
  const failures: string[] = [];
  const expectedPaths = new Set(scenario.expected.sourcePaths);
  const retrievedPaths = new Set(turn.sources.map((source) => source.path).filter(Boolean));
  const matchedPaths = [...expectedPaths].filter((path) => retrievedPaths.has(path));
  const sourceRecall = ratio(matchedPaths.length, expectedPaths.size);
  if (sourceRecall < 1) failures.push("expected-sources-missing");

  const normalizedAnswer = normalize(turn.answer);
  const factCoverage = semantic?.requiredFactsCovered.length === scenario.expected.requiredFacts.length
    ? semantic.requiredFactsCovered
    : scenario.expected.requiredFacts.map((fact) => normalizedAnswer.includes(normalize(fact)));
  const requiredFactCoverage = ratio(factCoverage.filter(Boolean).length, scenario.expected.requiredFacts.length);
  if (requiredFactCoverage < 1) failures.push("required-facts-missing");

  const forbiddenClaimPresent = semantic
    ? semantic.forbiddenClaimsPresent.length > 0
    : scenario.expected.forbiddenClaims.some((claim) => normalizedAnswer.includes(normalize(claim)));
  if (forbiddenClaimPresent) failures.push("forbidden-claim-present");

  const intentMatch = turn.intent === scenario.expected.intent;
  const confidenceMatch = Boolean(
    turn.confidence && scenario.expected.confidence.includes(turn.confidence),
  );
  if (!intentMatch) failures.push("intent-mismatch");
  if (!confidenceMatch) {
    failures.push("confidence-mismatch");
  }

  const questionCount = (turn.answer.match(/[؟?]/g) ?? []).length;
  const clarificationCorrect = !scenario.expected.needsClarification || questionCount === 1;
  if (!clarificationCorrect) {
    failures.push("clarification-contract-failed");
  }
  const escalationCorrect = !scenario.expected.escalation
    || /نمی.?خواهم حدس بزنم|متن آماده تیکت|شاهد کافی/.test(turn.answer);
  if (!escalationCorrect) {
    failures.push("escalation-contract-failed");
  }

  const emittedIndexes = citationIndexes(turn.answer);
  const validIndexes = new Set(turn.sources.map((source) => source.citationIndex));
  const validCitations = emittedIndexes.filter((index) => validIndexes.has(index));
  const invalidCitationLeaks = emittedIndexes.length - validCitations.length;
  const entailedIndexes = new Set(semantic?.entailedCitationIndexes ?? validCitations);
  const unsupportedIndexes = new Set(semantic?.unsupportedCitationIndexes ?? []);
  const entailedCitations = validCitations.filter((index) =>
    entailedIndexes.has(index) && !unsupportedIndexes.has(index));
  if (invalidCitationLeaks > 0) failures.push("invalid-citation-leaked");
  if (entailedCitations.length < validCitations.length) failures.push("citation-not-entailed");
  if (expectedPaths.size > 0 && validCitations.length === 0) failures.push("citation-missing");
  const officialUrls = turn.sources.filter((source) =>
    source.url.startsWith("https://docs.liara.ir/")).length;
  if (officialUrls < turn.sources.length) {
    failures.push("unofficial-source-emitted");
  }

  const submittedSecretLeaks = submittedSecrets(scenario)
    .filter((secret) => turn.answer.includes(secret)).length;
  if (submittedSecretLeaks > 0) {
    failures.push("submitted-secret-leaked");
  }

  return {
    scenarioId: scenario.id,
    category: scenario.category,
    passed: failures.length === 0,
    failures,
    answer: turn.answer,
    sources: turn.sources,
    model: turn.model,
    latencyMs: turn.latencyMs,
    observed: {
      intent: turn.intent,
      confidence: turn.confidence,
      model: turn.model,
      redactionCount: turn.redactionCount,
    },
    checks: {
      sourceRecall,
      requiredFactCoverage,
      citationsEmitted: emittedIndexes.length,
      citationsValid: validCitations.length,
      citationsEntailed: entailedCitations.length,
      invalidCitationLeaks,
      officialUrls,
      totalUrls: turn.sources.length,
      intentMatch,
      confidenceMatch,
      clarificationCorrect,
      escalationCorrect,
      submittedSecretLeaks,
    },
  };
}

/** Executes release evidence through the same observable seam used by the product. */
export class EvaluationRunner {
  constructor(
    private readonly subject: EvaluationSubject,
    private readonly judge?: EvaluationJudge,
  ) {}

  async evaluate(scenarios: GoldenScenario[]): Promise<EvaluationReport> {
    const results: ScenarioEvaluationResult[] = [];
    for (const scenario of scenarios) {
      const turn = await this.subject.run(scenario);
      const semantic = this.judge ? await this.judge.assess(scenario, turn) : undefined;
      results.push(evaluateScenario(scenario, turn, semantic));
    }

    const grounded = results.filter((result) =>
      scenarios.find((scenario) => scenario.id === result.scenarioId)?.expected.sourcePaths.length);
    const emittedCitations = results.reduce((sum, result) => sum + result.checks.citationsEmitted, 0);
    const validCitations = results.reduce((sum, result) => sum + result.checks.citationsValid, 0);
    const entailedCitations = results.reduce((sum, result) => sum + result.checks.citationsEntailed, 0);
    const invalidCitationLeaks = results.reduce((sum, result) => sum + result.checks.invalidCitationLeaks, 0);
    const totalUrls = results.reduce((sum, result) => sum + result.checks.totalUrls, 0);
    const officialUrls = results.reduce((sum, result) => sum + result.checks.officialUrls, 0);
    const clarificationResults = results.filter((result) =>
      scenarios.find((scenario) => scenario.id === result.scenarioId)?.expected.needsClarification);
    const escalationResults = results.filter((result) =>
      scenarios.find((scenario) => scenario.id === result.scenarioId)?.expected.escalation);
    const requiredFactCount = scenarios.reduce((sum, scenario) => sum + scenario.expected.requiredFacts.length, 0);
    const coveredFactCount = results.reduce((sum, result) => {
      const scenario = scenarios.find((item) => item.id === result.scenarioId);
      return sum + Math.round(result.checks.requiredFactCoverage * (scenario?.expected.requiredFacts.length ?? 0));
    }, 0);
    const expectedSourceCount = scenarios.reduce((sum, scenario) => sum + scenario.expected.sourcePaths.length, 0);
    const matchedSourceCount = results.reduce((sum, result) => {
      const scenario = scenarios.find((item) => item.id === result.scenarioId);
      return sum + Math.round(result.checks.sourceRecall * (scenario?.expected.sourcePaths.length ?? 0));
    }, 0);

    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      subject: this.subject.name,
      judge: this.judge?.name,
      summary: {
        total: results.length,
        passed: results.filter((result) => result.passed).length,
        passRate: ratio(results.filter((result) => result.passed).length, results.length),
        sourceRecall: ratio(matchedSourceCount, expectedSourceCount),
        requiredFactCoverage: ratio(coveredFactCount, requiredFactCount),
        citationPrecision: ratio(validCitations, emittedCitations),
        citationCoverage: ratio(
          grounded.filter((result) => result.checks.citationsValid > 0).length,
          grounded.length,
        ),
        citationEntailment: ratio(entailedCitations, validCitations),
        invalidCitationLeaks,
        officialUrlRate: ratio(officialUrls, totalUrls),
        intentAccuracy: ratio(results.filter((result) => result.checks.intentMatch).length, results.length),
        confidenceAccuracy: ratio(results.filter((result) => result.checks.confidenceMatch).length, results.length),
        clarificationAccuracy: ratio(
          clarificationResults.filter((result) => result.checks.clarificationCorrect).length,
          clarificationResults.length,
        ),
        escalationAccuracy: ratio(
          escalationResults.filter((result) => result.checks.escalationCorrect).length,
          escalationResults.length,
        ),
        submittedSecretLeaks: results.reduce(
          (sum, result) => sum + result.checks.submittedSecretLeaks,
          0,
        ),
        passRateByCategory: Object.fromEntries(
          [...new Set(scenarios.map((scenario) => scenario.category))].map((category) => {
            const categoryResults = results.filter((result) => result.category === category);
            return [
              category,
              ratio(categoryResults.filter((result) => result.passed).length, categoryResults.length),
            ];
          }),
        ),
      },
      results,
    };
  }
}
