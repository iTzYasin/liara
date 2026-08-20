import { createHash } from "node:crypto";
import type { ChatRequest } from "@/modules/chat/types";
import { LruTtlCache } from "@/modules/infra/lru-ttl-cache";
import { normalizePersian } from "@/modules/retrieval/docs-retriever";

interface CachedResponse {
  text: string;
}

const privateSignals = [
  /(?:^|\s)(?:من|ما|برنامه.?ام|سرویس.?ام|دامنه.?ام|اکانت|حسابم)(?:\s|$)/i,
  /خطا|ارور|exception|traceback|stack trace|لاگ|log|failed/i,
  /(?:https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,})/i,
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
  /\[SECRET_\d+\]|token|password|api.?key|authorization|bearer/i,
  /```|\b[A-Z_]{3,}=|[A-Z]:\\|\/(?:home|var|etc)\//,
];

export function isPublicCacheableRequest(request: ChatRequest, redactionCount: number) {
  const message = request.message.trim();
  return redactionCount === 0
    && request.history.length === 0
    && request.attachments.length === 0
    && message.length >= 8
    && message.length <= 420
    && !privateSignals.some((pattern) => pattern.test(message));
}

export function responseCacheKey(message: string, sourceIds: string[], model: string) {
  return createHash("sha256")
    .update(`${normalizePersian(message)}|${sourceIds.join(",")}|${model}`)
    .digest("hex");
}

export class ResponseCache {
  private readonly cache: LruTtlCache<string, CachedResponse>;

  constructor(maxEntries = 120, ttlMs = 30 * 60_000) {
    this.cache = new LruTtlCache(maxEntries, ttlMs);
  }

  get(key: string) {
    return this.cache.get(key);
  }

  set(key: string, response: CachedResponse) {
    this.cache.set(key, response);
  }
}

const responseCacheGlobal = globalThis as typeof globalThis & { __liaraResponseCache?: ResponseCache };
export const responseCache = responseCacheGlobal.__liaraResponseCache ??= new ResponseCache();
