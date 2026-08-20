import type { LanguageModelAdapter } from "@/modules/agent/agent";

interface ResilienceOptions {
  maxRetries?: number;
  timeoutMs?: number;
  circuitThreshold?: number;
  circuitResetMs?: number;
  baseDelayMs?: number;
}

export class ModelTimeoutError extends Error {
  constructor() {
    super("Model response timed out");
    this.name = "ModelTimeoutError";
  }
}

function statusFrom(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { status?: unknown; code?: unknown };
  const raw = candidate.status ?? candidate.code;
  return typeof raw === "number" ? raw : Number(raw) || undefined;
}

export function isTransientModelError(error: unknown) {
  if (error instanceof ModelTimeoutError || error instanceof TypeError) return true;
  const status = statusFrom(error);
  if (status === 408 || status === 429 || (status !== undefined && status >= 500)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|temporar|rate.?limit|unavailable|overload|ECONN|fetch failed/i.test(message);
}

function nextWithTimeout<T>(iterator: AsyncIterator<T>, timeoutMs: number) {
  return new Promise<IteratorResult<T>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ModelTimeoutError()), timeoutMs);
    iterator.next().then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Reliability policy around any model provider. It retries only before the first
 * streamed token so a retry can never duplicate a partial answer.
 */
export class ResilientModelAdapter implements LanguageModelAdapter {
  readonly name: string;
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;
  private readonly options: Required<ResilienceOptions>;

  constructor(
    private readonly inner: LanguageModelAdapter,
    options: ResilienceOptions = {},
  ) {
    this.name = inner.name;
    this.options = {
      maxRetries: options.maxRetries ?? 2,
      timeoutMs: options.timeoutMs ?? 45_000,
      circuitThreshold: options.circuitThreshold ?? 4,
      circuitResetMs: options.circuitResetMs ?? 30_000,
      baseDelayMs: options.baseDelayMs ?? 240,
    };
  }

  async *stream(input: Parameters<LanguageModelAdapter["stream"]>[0]): AsyncIterable<string> {
    if (Date.now() < this.circuitOpenUntil) {
      throw new Error("Model provider circuit is temporarily open");
    }

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      let emitted = false;
      const iterator = this.inner.stream(input)[Symbol.asyncIterator]();
      try {
        while (true) {
          const next = await nextWithTimeout(iterator, this.options.timeoutMs);
          if (next.done) {
            this.consecutiveFailures = 0;
            return;
          }
          emitted = true;
          yield next.value;
        }
      } catch (error) {
        // A provider may be stuck inside `next()`; awaiting `return()` would make
        // our own timeout hang behind the stalled provider call.
        void iterator.return?.().catch(() => undefined);
        const canRetry = !emitted && isTransientModelError(error) && attempt < this.options.maxRetries;
        if (canRetry) {
          const jitter = Math.floor(Math.random() * 80);
          await new Promise((resolve) => setTimeout(resolve, this.options.baseDelayMs * (2 ** attempt) + jitter));
          continue;
        }

        this.consecutiveFailures += 1;
        if (this.consecutiveFailures >= this.options.circuitThreshold) {
          this.circuitOpenUntil = Date.now() + this.options.circuitResetMs;
          this.consecutiveFailures = 0;
        }
        throw error;
      }
    }
  }
}
