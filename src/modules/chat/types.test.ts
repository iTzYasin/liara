import { describe, expect, it } from "vitest";
import { chatRequestSchema } from "@/modules/chat/types";

const base = {
  message: "خطای استقرار دارم",
  conversationId: "conversation",
  history: [],
};

describe("chatRequestSchema", () => {
  it("rejects attachment totals above 10 MB", () => {
    const attachment = {
      id: "file",
      name: "app.log",
      mimeType: "text/plain",
      size: 6 * 1024 * 1024,
      kind: "text",
      content: "safe",
    };
    const result = chatRequestSchema.safeParse({
      ...base,
      attachments: [attachment, { ...attachment, id: "file-2" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects mismatched MIME type and attachment kind", () => {
    const result = chatRequestSchema.safeParse({
      ...base,
      attachments: [{
        id: "file",
        name: "not-an-image.txt",
        mimeType: "text/plain",
        size: 20,
        kind: "image",
        content: "data:text/plain;base64,c2FmZQ==",
      }],
    });
    expect(result.success).toBe(false);
  });
});
