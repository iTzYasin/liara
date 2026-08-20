import { describe, expect, it } from "vitest";
import { conversationToMarkdown, safeExportFilename } from "@/modules/conversations/conversation-exporter";
import type { Conversation } from "@/modules/chat/types";

const conversation: Conversation = {
  id: "conversation",
  title: "اتصال دامنه / تست",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  messages: [
    { id: "user", role: "user", content: "API_KEY=[SECRET_1]", createdAt: "2026-01-01T00:00:00.000Z" },
    {
      id: "assistant",
      role: "assistant",
      content: "پاسخ [[1]]",
      createdAt: "2026-01-01T00:00:00.000Z",
      sources: [{
        id: "source",
        citationIndex: 1,
        title: "دامنه",
        heading: "اتصال",
        service: "paas",
        url: "https://docs.liara.ir/paas/domains/",
        snippet: "",
        score: 50,
      }],
    },
  ],
};

describe("conversation export", () => {
  it("exports only the stored sanitized content with exact sources", () => {
    const markdown = conversationToMarkdown(conversation);
    expect(markdown).toContain("API_KEY=[SECRET_1]");
    expect(markdown).toContain("https://docs.liara.ir/paas/domains/");
    expect(markdown).toContain("نسخه پاک‌سازی‌شده");
  });

  it("creates a filesystem-safe filename", () => {
    expect(safeExportFilename(conversation.title)).toBe("اتصال-دامنه-تست.md");
  });
});
