interface Bucket {
  minuteStartedAt: number;
  minuteCount: number;
  hourStartedAt: number;
  hourCount: number;
  messageWindowStartedAt: number;
  messageCount: number;
  lastSeenAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  remainingMinute: number;
  remainingMessages: number;
  resetsAt: number;
}

interface DistributedLimitDriver {
  limit(key: string): Promise<{
    success: boolean;
    remaining: number;
    reset: number;
  }>;
}

export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  check(key: string | string[], now = Date.now()): RateLimitResult {
    const minuteLimit = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 12);
    const hourLimit = Number(process.env.RATE_LIMIT_PER_HOUR ?? 60);
    const messageLimit = Math.max(1, Number(process.env.CHAT_MESSAGE_LIMIT ?? 20));
    const messageWindowMs = Math.max(
      1,
      Number(process.env.CHAT_MESSAGE_WINDOW_MINUTES ?? 30),
    ) * 60_000;
    const keys = [...new Set(Array.isArray(key) ? key : [key])];
    const active = keys.map((item) => {
      let bucket = this.buckets.get(item);
      if (!bucket) {
        bucket = {
          minuteStartedAt: now,
          minuteCount: 0,
          hourStartedAt: now,
          hourCount: 0,
          messageWindowStartedAt: now,
          messageCount: 0,
          lastSeenAt: now,
        };
        this.buckets.set(item, bucket);
      }

      if (now - bucket.minuteStartedAt >= 60_000) {
        bucket.minuteStartedAt = now;
        bucket.minuteCount = 0;
      }
      if (now - bucket.hourStartedAt >= 3_600_000) {
        bucket.hourStartedAt = now;
        bucket.hourCount = 0;
      }
      if (now - bucket.messageWindowStartedAt >= messageWindowMs) {
        bucket.messageWindowStartedAt = now;
        bucket.messageCount = 0;
      }
      bucket.lastSeenAt = now;
      return bucket;
    });

    const retryTimes = active.flatMap((bucket) => {
      const blockedUntil: number[] = [];
      if (bucket.minuteCount >= minuteLimit) blockedUntil.push(bucket.minuteStartedAt + 60_000);
      if (bucket.hourCount >= hourLimit) blockedUntil.push(bucket.hourStartedAt + 3_600_000);
      if (bucket.messageCount >= messageLimit) {
        blockedUntil.push(bucket.messageWindowStartedAt + messageWindowMs);
      }
      return blockedUntil;
    });
    if (retryTimes.length) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((Math.max(...retryTimes) - now) / 1000)),
        remainingMinute: 0,
        remainingMessages: 0,
        resetsAt: Math.max(...retryTimes),
      };
    }

    for (const bucket of active) {
      bucket.minuteCount += 1;
      bucket.hourCount += 1;
      bucket.messageCount += 1;
    }
    if (this.buckets.size > 5_000) this.compact(now, messageWindowMs);
    return {
      allowed: true,
      retryAfterSeconds: 0,
      remainingMinute: Math.max(0, Math.min(...active.map((bucket) => minuteLimit - bucket.minuteCount))),
      remainingMessages: Math.max(0, Math.min(...active.map((bucket) => messageLimit - bucket.messageCount))),
      resetsAt: Math.max(...active.map((bucket) => bucket.messageWindowStartedAt + messageWindowMs)),
    };
  }

  private compact(now: number, messageWindowMs: number) {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastSeenAt > Math.max(3_600_000, messageWindowMs)) {
        this.buckets.delete(key);
      }
    }
  }
}

/** Shared limiter for horizontally-scaled deployments, with bounded local fallback. */
export class DistributedRateLimiter {
  constructor(
    private readonly minute: DistributedLimitDriver,
    private readonly hour: DistributedLimitDriver,
    private readonly messageWindow: DistributedLimitDriver,
    private readonly fallback: InMemoryRateLimiter,
  ) {}

  async check(key: string | string[], now = Date.now()): Promise<RateLimitResult> {
    const keys = [...new Set(Array.isArray(key) ? key : [key])];
    try {
      const [minuteResults, hourResults, messageResults] = await Promise.all([
        Promise.all(keys.map((item) => this.minute.limit(item))),
        Promise.all(keys.map((item) => this.hour.limit(item))),
        Promise.all(keys.map((item) => this.messageWindow.limit(item))),
      ]);
      const blocked = [...minuteResults, ...hourResults, ...messageResults]
        .filter((result) => !result.success);
      return {
        allowed: blocked.length === 0,
        retryAfterSeconds: blocked.length
          ? Math.max(1, Math.ceil((Math.max(...blocked.map((result) => result.reset)) - now) / 1_000))
          : 0,
        remainingMinute: Math.max(0, Math.min(...minuteResults.map((result) => result.remaining))),
        remainingMessages: Math.max(0, Math.min(...messageResults.map((result) => result.remaining))),
        resetsAt: blocked.length
          ? Math.max(...blocked.map((result) => result.reset))
          : Math.max(...messageResults.map((result) => result.reset)),
      };
    } catch (error) {
      logEvent("warn", "rate_limit.shared_store_unavailable", {
        error_name: error instanceof Error ? error.name : "UnknownError",
        fallback: "in-memory",
      });
      return this.fallback.check(keys, now);
    }
  }
}

function createChatRateLimiter() {
  const fallback = new InMemoryRateLimiter();
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return fallback;

  const redis = new Redis({ url, token });
  const timeout = Number(process.env.RATE_LIMIT_STORE_TIMEOUT_MS ?? 1_000);
  const minute = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(Number(process.env.RATE_LIMIT_PER_MINUTE ?? 12), "1 m"),
    prefix: "liara-assistant:minute",
    analytics: false,
    timeout,
  });
  const hour = new Ratelimit({
    redis,
    limiter: Ratelimit.fixedWindow(Number(process.env.RATE_LIMIT_PER_HOUR ?? 60), "1 h"),
    prefix: "liara-assistant:hour",
    analytics: false,
    timeout,
  });
  const messageWindow = new Ratelimit({
    redis,
    limiter: Ratelimit.fixedWindow(
      Number(process.env.CHAT_MESSAGE_LIMIT ?? 20),
      `${Number(process.env.CHAT_MESSAGE_WINDOW_MINUTES ?? 30)} m`,
    ),
    prefix: "liara-assistant:message-window",
    analytics: false,
    timeout,
  });
  return new DistributedRateLimiter(minute, hour, messageWindow, fallback);
}

export const chatRateLimiter = createChatRateLimiter();
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { logEvent } from "@/modules/infra/logger";
