interface Bucket {
  minuteStartedAt: number;
  minuteCount: number;
  hourStartedAt: number;
  hourCount: number;
  lastSeenAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  remainingMinute: number;
}

export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  check(key: string, now = Date.now()): RateLimitResult {
    const minuteLimit = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 12);
    const hourLimit = Number(process.env.RATE_LIMIT_PER_HOUR ?? 60);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = {
        minuteStartedAt: now,
        minuteCount: 0,
        hourStartedAt: now,
        hourCount: 0,
        lastSeenAt: now,
      };
      this.buckets.set(key, bucket);
    }

    if (now - bucket.minuteStartedAt >= 60_000) {
      bucket.minuteStartedAt = now;
      bucket.minuteCount = 0;
    }
    if (now - bucket.hourStartedAt >= 3_600_000) {
      bucket.hourStartedAt = now;
      bucket.hourCount = 0;
    }
    bucket.lastSeenAt = now;

    const minuteBlocked = bucket.minuteCount >= minuteLimit;
    const hourBlocked = bucket.hourCount >= hourLimit;
    if (minuteBlocked || hourBlocked) {
      const retryAt = minuteBlocked
        ? bucket.minuteStartedAt + 60_000
        : bucket.hourStartedAt + 3_600_000;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((retryAt - now) / 1000)),
        remainingMinute: 0,
      };
    }

    bucket.minuteCount += 1;
    bucket.hourCount += 1;
    if (this.buckets.size > 5_000) this.compact(now);
    return {
      allowed: true,
      retryAfterSeconds: 0,
      remainingMinute: Math.max(0, minuteLimit - bucket.minuteCount),
    };
  }

  private compact(now: number) {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastSeenAt > 3_600_000) this.buckets.delete(key);
    }
  }
}

export const chatRateLimiter = new InMemoryRateLimiter();
