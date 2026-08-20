import { describe, expect, it } from "vitest";
import { DemoModelAdapter, streamAgentTurn, type LanguageModelAdapter } from "@/modules/agent/agent";
import { InMemoryDocsRetriever } from "@/modules/retrieval/docs-retriever";
import type { AgentEvent, ChatRequest } from "@/modules/chat/types";

const request: ChatRequest = {
  message: "چطور دامنه را به برنامه وصل کنم؟",
  conversationId: "conversation",
  history: [],
  attachments: [],
};

async function collect(stream: AsyncGenerator<AgentEvent>) {
  const events: AgentEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("streamAgentTurn", () => {
  it("retrieves sources before producing a grounded response", async () => {
    const retriever = new InMemoryDocsRetriever([
      {
        id: "domain",
        title: "اتصال دامنه",
        heading: "رکورد DNS",
        service: "paas",
        url: "https://docs.liara.ir/domain",
        path: "paas/domain.md",
        text: "برای اتصال دامنه، رکورد DNS را تنظیم کنید و وضعیت را بررسی کنید.",
      },
    ]);
    const events = await collect(streamAgentTurn(request, { retriever, model: new DemoModelAdapter() }));
    const sourcesIndex = events.findIndex((event) => event.type === "sources");
    const deltaIndex = events.findIndex((event) => event.type === "delta");
    expect(sourcesIndex).toBeGreaterThan(-1);
    expect(deltaIndex).toBeGreaterThan(sourcesIndex);
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("escalates without calling the model when evidence is missing", async () => {
    const retriever = new InMemoryDocsRetriever([]);
    const explodingModel: LanguageModelAdapter = {
      name: "must-not-run",
      async *stream() {
        throw new Error("model should not be called");
      },
    };
    const events = await collect(streamAgentTurn(
      { ...request, message: "یک قابلیت ناشناخته و بدون سند" },
      { retriever, model: explodingModel },
    ));
    const text = events.filter((event) => event.type === "delta").map((event) => event.text).join("");
    expect(text).toContain("متن آماده تیکت");
    expect(text).toContain("نمی‌خواهم حدس بزنم");
  });

  it("reuses a grounded response only for a public context-free question", async () => {
    const retriever = new InMemoryDocsRetriever([{
      id: "cache-source",
      title: "راهنمای دامنه",
      heading: "مراحل عمومی اتصال",
      service: "paas",
      url: "https://docs.liara.ir/paas/domains/cache-test",
      path: "paas/domains/cache-test.md",
      text: "مراحل عمومی اتصال دامنه به برنامه شامل افزودن دامنه و تنظیم رکوردها است.",
    }]);
    let modelCalls = 0;
    const model: LanguageModelAdapter = {
      name: "cache-test-model",
      async *stream() {
        modelCalls += 1;
        yield "پاسخ مستند و قابل استفاده مجدد [[1]]";
      },
    };
    const cacheRequest = {
      ...request,
      message: "مراحل عمومی اتصال دامنه برای آزمون حافظه چیست؟",
    };
    await collect(streamAgentTurn(cacheRequest, { retriever, model }));
    await collect(streamAgentTurn({ ...cacheRequest, conversationId: "conversation-2" }, { retriever, model }));
    expect(modelCalls).toBe(1);
  });
});
