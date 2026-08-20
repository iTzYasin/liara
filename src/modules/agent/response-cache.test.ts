import { describe, expect, it } from "vitest";
import { isPublicCacheableRequest, ResponseCache } from "@/modules/agent/response-cache";
import type { ChatRequest } from "@/modules/chat/types";

const base: ChatRequest = {
  message: "روش اتصال دامنه به برنامه چیست؟",
  conversationId: "conversation",
  history: [],
  attachments: [],
};

describe("response cache policy", () => {
  it("accepts a general documentation question", () => {
    expect(isPublicCacheableRequest(base, 0)).toBe(true);
  });

  it("rejects history, attachments, secrets and user-specific errors", () => {
    expect(isPublicCacheableRequest({ ...base, history: [{ role: "user", content: "قبلی" }] }, 0)).toBe(false);
    expect(isPublicCacheableRequest({ ...base, message: "برنامه من error 502 دارد" }, 0)).toBe(false);
    expect(isPublicCacheableRequest(base, 1)).toBe(false);
  });

  it("stores reusable responses behind one interface", () => {
    const cache = new ResponseCache(2, 1_000);
    cache.set("key", { text: "پاسخ مستند" });
    expect(cache.get("key")?.text).toBe("پاسخ مستند");
  });
});
