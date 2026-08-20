import { describe, expect, it } from "vitest";
import { MetricsRegistry } from "@/modules/observability/metrics";

describe("MetricsRegistry", () => {
  it("aggregates quality, cache, privacy and feedback without content fields", () => {
    const registry = new MetricsRegistry();
    registry.record({
      type: "chat.completed",
      latencyMs: 800,
      firstTokenLatencyMs: 120,
      inputTokens: 1_000,
      outputTokens: 200,
      sourceCount: 4,
      citationCount: 2,
      invalidCitationCount: 0,
      redactionCount: 2,
      confidence: "high",
      outcome: "answer",
      retrievalCacheHit: true,
      responseCacheEligible: true,
      responseCacheHit: false,
    });
    registry.record({ type: "feedback", rating: "down", reason: "incomplete" });
    const snapshot = registry.snapshot();
    expect(snapshot.requests).toMatchObject({ total: 1, successful: 1, successRate: 100 });
    expect(snapshot.cache.hitRate).toBe(50);
    expect(snapshot.feedback.reasons.incomplete).toBe(1);
    expect(snapshot.privacy.redactions).toBe(2);
    expect(snapshot.quality.citationValidityRate).toBe(100);
    expect(JSON.stringify(snapshot)).not.toContain("prompt");
  });

  it("raises an error-rate alert after enough failures", () => {
    const registry = new MetricsRegistry();
    for (let index = 0; index < 5; index += 1) registry.record({ type: "chat.failed" });
    expect(registry.snapshot().alerts).toContain("نرخ خطا بیشتر از ۵٪ است.");
  });
});
