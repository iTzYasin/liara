import { afterEach, describe, expect, it } from "vitest";
import { InMemoryRateLimiter } from "@/modules/infra/rate-limiter";

const previousMinute = process.env.RATE_LIMIT_PER_MINUTE;
const previousHour = process.env.RATE_LIMIT_PER_HOUR;

afterEach(() => {
  process.env.RATE_LIMIT_PER_MINUTE = previousMinute;
  process.env.RATE_LIMIT_PER_HOUR = previousHour;
});

describe("InMemoryRateLimiter", () => {
  it("blocks requests above the configured minute budget", () => {
    process.env.RATE_LIMIT_PER_MINUTE = "2";
    process.env.RATE_LIMIT_PER_HOUR = "10";
    const limiter = new InMemoryRateLimiter();
    expect(limiter.check("visitor", 1_000).allowed).toBe(true);
    expect(limiter.check("visitor", 1_100).allowed).toBe(true);
    const blocked = limiter.check("visitor", 1_200);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("opens a new minute window", () => {
    process.env.RATE_LIMIT_PER_MINUTE = "1";
    process.env.RATE_LIMIT_PER_HOUR = "10";
    const limiter = new InMemoryRateLimiter();
    expect(limiter.check("visitor", 1_000).allowed).toBe(true);
    expect(limiter.check("visitor", 61_001).allowed).toBe(true);
  });
});
