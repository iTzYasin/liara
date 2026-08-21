import { describe, expect, it } from "vitest";
import {
  buildConversationContext,
  summarizeConversationHistory,
} from "@/modules/agent/context-manager";
import type { ChatHistoryMessage } from "@/modules/chat/types";

const history: ChatHistoryMessage[] = [
  { role: "user", content: "برنامه Next.js من هنگام deploy خطای ECONNRESET دارد." },
  { role: "assistant", content: "ابتدا لاگ build را بررسی کن. [[1]]" },
  { role: "user", content: "لاگ را دیدم و تنظیم NODE_OPTIONS را هم انجام دادم اما حل نشد." },
  { role: "assistant", content: "مرحله بعد بررسی health check است. [[2]]" },
  { role: "user", content: "حالا فنی‌تر ادامه بده؛ health check پاسخ 503 می‌دهد." },
];

describe("conversation context manager", () => {
  it("keeps recent turns verbatim and compresses older problem state", () => {
    const context = buildConversationContext(history, "", { recentMessageCount: 2, summaryMaxCharacters: 500 });

    expect(context.recent).toEqual(history.slice(-2));
    expect(context.summary).toMatch(/Next\.js|ECONNRESET/);
    expect(context.summary).toMatch(/NODE_OPTIONS/);
    expect(context.summary).not.toContain("[[1]]");
    expect(context.summary.length).toBeLessThanOrEqual(500);
  });

  it("merges a previous rolling summary without dropping the latest old turn", () => {
    const summary = summarizeConversationHistory(
      history.slice(0, 2),
      "هدف قبلی: رفع خطای deploy",
      240,
    );

    expect(summary).toContain("هدف قبلی");
    expect(summary).toContain("ECONNRESET");
    expect(summary.length).toBeLessThanOrEqual(240);
  });
});
