import { describe, expect, it } from "vitest";
import { MemoryConversationStore } from "@/modules/conversations/conversation-store";

describe("MemoryConversationStore", () => {
  it("keeps the newest sanitized conversation first", async () => {
    const store = new MemoryConversationStore();
    await store.save({ id: "old", title: "قدیمی", createdAt: "2026-01-01", updatedAt: "2026-01-01", messages: [] });
    await store.save({ id: "new", title: "جدید", createdAt: "2026-01-02", updatedAt: "2026-01-02", messages: [] });
    expect((await store.list()).map((item) => item.id)).toEqual(["new", "old"]);
  });

  it("removes a conversation without affecting the rest", async () => {
    const store = new MemoryConversationStore();
    await store.save({ id: "one", title: "یک", createdAt: "1", updatedAt: "1", messages: [] });
    await store.save({ id: "two", title: "دو", createdAt: "2", updatedAt: "2", messages: [] });
    await store.remove("one");
    expect(await store.get("one")).toBeUndefined();
    expect(await store.get("two")).toBeDefined();
  });
});
