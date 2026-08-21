export type FeedbackReason = "incomplete" | "irrelevant-source" | "not-resolved" | "unclear" | "no-reason";

export type MetricEvent =
  | {
      type: "chat.completed";
      latencyMs: number;
      firstTokenLatencyMs: number | null;
      inputTokens: number;
      outputTokens: number;
      sourceCount: number;
      citationCount: number;
      invalidCitationCount: number;
      redactionCount: number;
      confidence: "high" | "medium" | "low";
      outcome: "answer" | "clarification" | "escalation" | "conversation";
      retrievalCacheHit: boolean;
      responseCacheEligible: boolean;
      responseCacheHit: boolean;
    }
  | { type: "chat.failed" }
  | { type: "feedback"; rating: "up" | "down"; reason?: FeedbackReason }
  | { type: "docs.sync"; status: "success" | "failed"; sourceCommit?: string; documentCount?: number };

interface CompletedTurn extends Extract<MetricEvent, { type: "chat.completed" }> {
  timestamp: number;
}

interface SyncState {
  status: "success" | "failed";
  at: string;
  sourceCommit?: string;
  documentCount?: number;
}

export interface MetricsSnapshot {
  generatedAt: string;
  since: string;
  requests: {
    total: number;
    successful: number;
    failed: number;
    successRate: number;
  };
  latency: {
    firstTokenP50Ms: number;
    firstTokenP95Ms: number;
    totalP50Ms: number;
    totalP95Ms: number;
  };
  usage: {
    inputTokens: number;
    outputTokens: number;
    averageTokensPerTurn: number;
    estimatedCostUsd: number;
    pricePerMillion: { inputUsd: number; outputUsd: number };
  };
  cache: {
    retrievalHits: number;
    responseHits: number;
    misses: number;
    hitRate: number;
  };
  quality: {
    averageSources: number;
    noResultRate: number;
    clarificationRate: number;
    escalationRate: number;
    highConfidenceRate: number;
    citationValidityRate: number;
  };
  feedback: {
    total: number;
    positive: number;
    negative: number;
    positiveRate: number;
    reasons: Record<FeedbackReason, number>;
  };
  privacy: { redactions: number };
  docsSync?: SyncState;
  alerts: string[];
}

function rounded(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function ratio(part: number, total: number) {
  return total ? rounded((part / total) * 100) : 0;
}

function percentile(values: number[], percentileValue: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(percentileValue * sorted.length) - 1);
  return Math.round(sorted[index]);
}

/** Aggregates only bounded, content-free observations; raw prompts never cross this interface. */
export class MetricsRegistry {
  private readonly startedAt = new Date().toISOString();
  private readonly turns: CompletedTurn[] = [];
  private failedRequests = 0;
  private positiveFeedback = 0;
  private negativeFeedback = 0;
  private feedbackReasons: Record<FeedbackReason, number> = {
    incomplete: 0,
    "irrelevant-source": 0,
    "not-resolved": 0,
    unclear: 0,
    "no-reason": 0,
  };
  private docsSync?: SyncState;

  record(event: MetricEvent) {
    if (event.type === "chat.completed") {
      this.turns.push({ ...event, timestamp: Date.now() });
      if (this.turns.length > 2_000) this.turns.splice(0, this.turns.length - 2_000);
      return;
    }
    if (event.type === "chat.failed") {
      this.failedRequests += 1;
      return;
    }
    if (event.type === "feedback") {
      if (event.rating === "up") this.positiveFeedback += 1;
      else this.negativeFeedback += 1;
      if (event.reason) this.feedbackReasons[event.reason] += 1;
      return;
    }
    this.docsSync = {
      status: event.status,
      at: new Date().toISOString(),
      sourceCommit: event.sourceCommit,
      documentCount: event.documentCount,
    };
  }

  snapshot(): MetricsSnapshot {
    const successful = this.turns.length;
    const knowledgeTurns = this.turns.filter((turn) => turn.outcome !== "conversation");
    const knowledgeSuccessful = knowledgeTurns.length;
    const total = successful + this.failedRequests;
    const firstToken = this.turns
      .map((turn) => turn.firstTokenLatencyMs)
      .filter((value): value is number => value !== null);
    const inputTokens = this.turns.reduce((sum, turn) => sum + turn.inputTokens, 0);
    const outputTokens = this.turns.reduce((sum, turn) => sum + turn.outputTokens, 0);
    const retrievalHits = this.turns.filter((turn) => turn.retrievalCacheHit).length;
    const responseHits = this.turns.filter((turn) => turn.responseCacheHit).length;
    const cacheOpportunities = knowledgeSuccessful
      + knowledgeTurns.filter((turn) => turn.responseCacheEligible).length;
    const inputUsd = Number(process.env.GEMINI_INPUT_USD_PER_MILLION ?? 0.3);
    const outputUsd = Number(process.env.GEMINI_OUTPUT_USD_PER_MILLION ?? 2.5);
    const feedbackTotal = this.positiveFeedback + this.negativeFeedback;
    const citationCount = this.turns.reduce((sum, turn) => sum + turn.citationCount, 0);
    const invalidCitationCount = this.turns.reduce((sum, turn) => sum + turn.invalidCitationCount, 0);
    const errorRate = total ? (this.failedRequests / total) * 100 : 0;
    const totalP95 = percentile(this.turns.map((turn) => turn.latencyMs), 0.95);
    const alerts: string[] = [];
    if (total >= 5 && errorRate > 5) alerts.push("نرخ خطا بیشتر از ۵٪ است.");
    if (successful >= 5 && totalP95 > 15_000) alerts.push("p95 زمان پاسخ بیشتر از ۱۵ ثانیه است.");
    if (this.docsSync?.status === "failed") alerts.push("آخرین همگام‌سازی مستندات ناموفق بوده است.");

    return {
      generatedAt: new Date().toISOString(),
      since: this.startedAt,
      requests: {
        total,
        successful,
        failed: this.failedRequests,
        successRate: ratio(successful, total),
      },
      latency: {
        firstTokenP50Ms: percentile(firstToken, 0.5),
        firstTokenP95Ms: percentile(firstToken, 0.95),
        totalP50Ms: percentile(this.turns.map((turn) => turn.latencyMs), 0.5),
        totalP95Ms: totalP95,
      },
      usage: {
        inputTokens,
        outputTokens,
        averageTokensPerTurn: successful ? Math.round((inputTokens + outputTokens) / successful) : 0,
        estimatedCostUsd: rounded((inputTokens * inputUsd + outputTokens * outputUsd) / 1_000_000, 6),
        pricePerMillion: { inputUsd, outputUsd },
      },
      cache: {
        retrievalHits,
        responseHits,
        misses: Math.max(0, cacheOpportunities - retrievalHits - responseHits),
        hitRate: ratio(retrievalHits + responseHits, cacheOpportunities),
      },
      quality: {
        averageSources: knowledgeSuccessful
          ? rounded(knowledgeTurns.reduce((sum, turn) => sum + turn.sourceCount, 0) / knowledgeSuccessful)
          : 0,
        noResultRate: ratio(knowledgeTurns.filter((turn) => turn.sourceCount === 0).length, knowledgeSuccessful),
        clarificationRate: ratio(knowledgeTurns.filter((turn) => turn.outcome === "clarification").length, knowledgeSuccessful),
        escalationRate: ratio(knowledgeTurns.filter((turn) => turn.outcome === "escalation").length, knowledgeSuccessful),
        highConfidenceRate: ratio(knowledgeTurns.filter((turn) => turn.confidence === "high").length, knowledgeSuccessful),
        citationValidityRate: citationCount
          ? ratio(citationCount - invalidCitationCount, citationCount)
          : 100,
      },
      feedback: {
        total: feedbackTotal,
        positive: this.positiveFeedback,
        negative: this.negativeFeedback,
        positiveRate: ratio(this.positiveFeedback, feedbackTotal),
        reasons: { ...this.feedbackReasons },
      },
      privacy: {
        redactions: this.turns.reduce((sum, turn) => sum + turn.redactionCount, 0),
      },
      docsSync: this.docsSync,
      alerts,
    };
  }
}

const metricsGlobal = globalThis as typeof globalThis & { __liaraMetrics?: MetricsRegistry };
export const metrics = metricsGlobal.__liaraMetrics ??= new MetricsRegistry();
