import { afterEach, describe, expect, it } from "vitest";
import {
  DistributedRateLimiter,
  InMemoryRateLimiter,
} from "@/modules/infra/rate-limiter";

const previousMinute = process.env.RATE_LIMIT_PER_MINUTE;
const previousHour = process.env.RATE_LIMIT_PER_HOUR;
const previousMessageLimit = process.env.CHAT_MESSAGE_LIMIT;
const previousMessageWindow = process.env.CHAT_MESSAGE_WINDOW_MINUTES;

afterEach(() => {
  process.env.RATE_LIMIT_PER_MINUTE = previousMinute;
  process.env.RATE_LIMIT_PER_HOUR = previousHour;
  process.env.CHAT_MESSAGE_LIMIT = previousMessageLimit;
  process.env.CHAT_MESSAGE_WINDOW_MINUTES = previousMessageWindow;
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

  it("enforces visitor and trusted IP budgets atomically", () => {
    process.env.RATE_LIMIT_PER_MINUTE = "1";
    process.env.RATE_LIMIT_PER_HOUR = "10";
    const limiter = new InMemoryRateLimiter();
    expect(limiter.check(["visitor:a", "ip:203.0.113.10"], 1_000).allowed).toBe(true);
    expect(limiter.check(["visitor:b", "ip:203.0.113.10"], 1_100).allowed).toBe(false);
    expect(limiter.check(["visitor:b", "ip:203.0.113.11"], 1_200).allowed).toBe(true);
  });

  it("locks the chat after the message quota until the configured window resets", () => {
    process.env.RATE_LIMIT_PER_MINUTE = "100";
    process.env.RATE_LIMIT_PER_HOUR = "100";
    process.env.CHAT_MESSAGE_LIMIT = "2";
    process.env.CHAT_MESSAGE_WINDOW_MINUTES = "30";
    const limiter = new InMemoryRateLimiter();

    expect(limiter.check("visitor", 1_000)).toMatchObject({
      allowed: true,
      remainingMessages: 1,
      resetsAt: 1_801_000,
    });
    expect(limiter.check("visitor", 2_000)).toMatchObject({
      allowed: true,
      remainingMessages: 0,
    });
    expect(limiter.check("visitor", 3_000)).toMatchObject({
      allowed: false,
      remainingMessages: 0,
      retryAfterSeconds: 1_798,
      resetsAt: 1_801_000,
    });
    expect(limiter.check("visitor", 1_801_001).allowed).toBe(true);
  });
});

describe("DistributedRateLimiter", () => {
  it("enforces minute and hour budgets for every trusted identity", async () => {
    const minute = {
      limit: async (key: string) => ({
        success: key !== "ip:blocked",
        remaining: key === "ip:blocked" ? 0 : 8,
        reset: 61_000,
      }),
    };
    const hour = {
      limit: async () => ({ success: true, remaining: 50, reset: 3_601_000 }),
    };
    const messageWindow = {
      limit: async () => ({ success: true, remaining: 18, reset: 1_801_000 }),
    };
    const limiter = new DistributedRateLimiter(
      minute,
      hour,
      messageWindow,
      new InMemoryRateLimiter(),
    );

    await expect(limiter.check(["visitor:a", "ip:blocked"], 1_000)).resolves.toMatchObject({
      allowed: false,
      remainingMinute: 0,
      retryAfterSeconds: 60,
    });
  });

  it("falls back to the local limiter when the shared store is unavailable", async () => {
    process.env.RATE_LIMIT_PER_MINUTE = "1";
    process.env.RATE_LIMIT_PER_HOUR = "10";
    const unavailable = { limit: async () => { throw new Error("redis unavailable"); } };
    const limiter = new DistributedRateLimiter(
      unavailable,
      unavailable,
      unavailable,
      new InMemoryRateLimiter(),
    );

    expect((await limiter.check("visitor", 1_000)).allowed).toBe(true);
    expect((await limiter.check("visitor", 1_100)).allowed).toBe(false);
  });
});
