import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChatRateLimitError,
  consumeChatStream,
} from "@/modules/chat/chat-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chat client", () => {
  it("turns a 429 response into a timed chat lock", async () => {
    const lockedUntil = "2026-08-21T12:30:00.000Z";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      code: "RATE_LIMITED",
      message: "سقف استفاده شما تکمیل شده است.",
      retryAfterSeconds: 1_800,
      lockedUntil,
    }, { status: 429 })));

    const result = consumeChatStream({
      message: "سلام",
      conversationId: "conversation",
      history: [],
      attachments: [],
    }, vi.fn());

    await expect(result).rejects.toMatchObject({
      name: "ChatRateLimitError",
      lockedUntil: Date.parse(lockedUntil),
    } satisfies Partial<ChatRateLimitError>);
  });
});
