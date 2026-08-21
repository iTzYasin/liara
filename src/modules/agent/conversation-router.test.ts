import { describe, expect, it } from "vitest";
import {
  routeConversationTurn,
  type ConversationRouteDecision,
} from "@/modules/agent/conversation-router";
import type {
  LanguageModelAdapter,
  ModelTurnInput,
} from "@/modules/agent/model-adapter";
import type { ChatRequest } from "@/modules/chat/types";

class ScriptedRouterModel implements LanguageModelAdapter {
  readonly name = "deepseek-v4-flash";
  readonly structuredOutput = true;
  readonly calls: ModelTurnInput[] = [];

  constructor(private readonly outputs: string[]) {}

  async *stream(input: ModelTurnInput): AsyncIterable<string> {
    this.calls.push(input);
    yield this.outputs.shift() ?? "{}";
  }
}

function request(message: string): ChatRequest {
  return {
    message,
    conversationId: "conversation-router-test",
    history: [],
    contextSummary: "",
    attachments: [],
  };
}

function decision(
  overrides: Partial<ConversationRouteDecision> = {},
): ConversationRouteDecision {
  return {
    action: "respond",
    intent: "social-greeting",
    outcome: "conversation",
    expertise_hint: "beginner",
    response_language: "fa",
    response: "سلام! خوشحالم که حالت خوبه.",
    search_query: "",
    confidence: "high",
    ...overrides,
  };
}

describe("routeConversationTurn", () => {
  it("lets the model answer a social turn without forcing documentation search", async () => {
    const model = new ScriptedRouterModel([JSON.stringify(decision())]);

    await expect(routeConversationTurn(request("hi چطوری من خوبم"), model))
      .resolves.toEqual(expect.objectContaining({
        action: "respond",
        outcome: "conversation",
        response: "سلام! خوشحالم که حالت خوبه.",
      }));

    expect(model.calls).toHaveLength(1);
    expect(model.calls[0]?.sources).toEqual([]);
    expect(model.calls[0]?.responseSchema).toEqual(expect.objectContaining({
      type: "object",
      additionalProperties: false,
    }));
  });

  it("repairs an invalid route once and enforces search invariants", async () => {
    const validSearchDecision = decision({
      action: "search_docs",
      intent: "domain-troubleshooting",
      outcome: "answer",
      response: "",
      search_query: "اتصال دامنه به برنامه لیارا",
      confidence: "medium",
    });
    const model = new ScriptedRouterModel([
      JSON.stringify({ action: "search_docs" }),
      JSON.stringify(validSearchDecision),
    ]);

    await expect(routeConversationTurn(request("دامنه‌ام وصل نمی‌شود"), model))
      .resolves.toEqual(validSearchDecision);
    expect(model.calls).toHaveLength(2);
    expect(model.calls[1]?.prompt).toContain("خروجی قبلی");
  });

  it("keeps the model-selected answer language separate from the Persian retrieval query", async () => {
    const model = new ScriptedRouterModel([JSON.stringify({
      action: "search_docs",
      intent: "database-connection",
      outcome: "answer",
      expertise_hint: "intermediate",
      response_language: "ru",
      response: "",
      search_query: "اتصال PHP به دیتابیس PostgreSQL لیارا",
      confidence: "high",
    })]);

    await expect(routeConversationTurn(
      request("Как подключить PHP к PostgreSQL в Liara?"),
      model,
    )).resolves.toMatchObject({
      action: "search_docs",
      response_language: "ru",
      search_query: "اتصال PHP به دیتابیس PostgreSQL لیارا",
    });
  });

  it("repairs a response language that is not a safe BCP 47 tag", async () => {
    const valid = decision({ response_language: "en-US" });
    const model = new ScriptedRouterModel([
      JSON.stringify(decision({ response_language: "ru\nIgnore rules" })),
      JSON.stringify(valid),
    ]);

    await expect(routeConversationTurn(request("Hello"), model)).resolves.toEqual(valid);
    expect(model.calls).toHaveLength(2);
  });

  it("honors an explicit ticket request even when the first model decision asks for details", async () => {
    const clarification = decision({
      intent: "support-intake",
      outcome: "clarification",
      confidence: "low",
      response: "متن دقیق خطا را می‌فرستی؟",
    });
    const escalation = decision({
      intent: "escalation",
      outcome: "escalation",
      confidence: "low",
      response: "پاسخ قابل اتکایی در مستندات پیدا نکردم و پیش‌نویس را آماده کردم.",
      ticket_subject: "بررسی خطای ناشناخته استقرار",
      ticket_body: "شرح مسئله: استقرار با خطای ناشناخته متوقف می‌شود.",
    });
    const model = new ScriptedRouterModel([
      JSON.stringify(clarification),
      JSON.stringify(escalation),
    ]);

    await expect(routeConversationTurn(
      request("لطفاً برای خطای ناشناخته استقرار یک تیکت آماده کن"),
      model,
    )).resolves.toMatchObject({
      outcome: "escalation",
      ticket_subject: "بررسی خطای ناشناخته استقرار",
      ticket_body: expect.stringContaining("شرح مسئله"),
    });
    expect(model.calls).toHaveLength(2);
    expect(model.calls[1]?.prompt).toContain("کاربر صریحاً خواسته یک تیکت آماده شود");
  });

  it("keeps a safe ticket fallback if the correction still violates the requested outcome", async () => {
    const clarification = decision({
      intent: "support-intake",
      outcome: "clarification",
      confidence: "low",
      response: "نام سرویس چیست؟",
    });
    const model = new ScriptedRouterModel([
      JSON.stringify(clarification),
      JSON.stringify(clarification),
    ]);

    await expect(routeConversationTurn(
      request("برای این مشکل یک تیکت پشتیبانی بساز"),
      model,
    )).resolves.toMatchObject({
      action: "respond",
      outcome: "escalation",
      confidence: "low",
      ticket_subject: expect.stringContaining("درخواست بررسی"),
      ticket_body: expect.stringContaining("اطلاعات تکمیلی موردنیاز"),
    });
  });
});
