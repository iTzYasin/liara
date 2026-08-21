import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ChatWorkspace } from "@/components/chat/chat-workspace";
import { consumeChatStream } from "@/modules/chat/chat-client";
import type { Conversation } from "@/modules/chat/types";
import { getConversationStore } from "@/modules/conversations/conversation-store";

vi.mock("@/modules/chat/chat-client", () => ({
  consumeChatStream: vi.fn(),
}));

const user = {
  id: "77777777-7777-4777-8777-777777777777",
  name: "کاربر تست",
  email: "workspace@example.com",
  createdAt: "2026-08-21T00:00:00.000Z",
};

function storedConversation(
  id: string,
  title: string,
  updatedAt: string,
): Conversation {
  return {
    id,
    title,
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt,
    messages: [{
      id: `${id}-user`,
      role: "user",
      content: title,
      createdAt: "2026-08-21T00:00:00.000Z",
    }],
  };
}

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.mocked(consumeChatStream).mockReset();
  window.localStorage.clear();
});

describe("ChatWorkspace conversation navigation", () => {
  it("opens the full sources panel from the remaining sources button", async () => {
    const store = getConversationStore(user.id);
    await store.clear();
    const sources = Array.from({ length: 5 }, (_, index) => ({
      id: `workspace-source-${index + 1}`,
      citationIndex: index + 1,
      title: `راهنمای منبع ${(index + 1).toLocaleString("fa-IR")}`,
      heading: `بخش ${(index + 1).toLocaleString("fa-IR")}`,
      service: "paas",
      url: `https://docs.liara.ir/workspace-source-${index + 1}`,
      snippet: `توضیح منبع ${(index + 1).toLocaleString("fa-IR")}`,
      score: 1,
    }));
    await store.save({
      id: "sources-chat",
      title: "گفتگوی دارای منابع",
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T01:00:00.000Z",
      messages: [{
        id: "sources-chat-user",
        role: "user",
        content: "راهنمای استقرار",
        createdAt: "2026-08-21T00:00:00.000Z",
      }, {
        id: "sources-chat-assistant",
        role: "assistant",
        content: "راهنمای مستند آماده است.",
        createdAt: "2026-08-21T00:01:00.000Z",
        status: "complete",
        sources,
      }],
    });

    render(<ChatWorkspace user={user} onLogout={vi.fn()} />);

    const remainingSources = await screen.findByRole("button", {
      name: "مشاهده هر ۵ منبع در پنل منابع",
    });
    expect(remainingSources.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(remainingSources);

    const panel = screen.getByRole("complementary", { name: "منابع پاسخ" });
    expect(panel.classList.contains("is-open")).toBe(true);
    expect(remainingSources.getAttribute("aria-expanded")).toBe("true");
    expect(within(panel).getByRole("heading", { name: "راهنمای منبع ۵" })).toBeTruthy();
  });

  it("opens on a new chat when the authenticated entry requests a fresh start", async () => {
    const store = getConversationStore(user.id);
    await store.clear();
    await store.save(storedConversation(
      "saved-chat",
      "گفتگوی ذخیره‌شده",
      "2026-08-21T01:00:00.000Z",
    ));
    render(
      <ChatWorkspace
        user={user}
        onLogout={vi.fn()}
        startOnNewConversation
      />,
    );

    expect(await screen.findByRole("heading", { name: "چه مشکلی در لیارا داری؟" }))
      .toBeTruthy();
    expect(screen.getByText("گفتگوی ذخیره‌شده")).toBeTruthy();
  });

  it("keeps a response running while another chat is selected and marks it in history", async () => {
    const store = getConversationStore(user.id);
    await store.clear();
    await store.save(storedConversation(
      "older-chat",
      "گفتگوی قدیمی",
      "2026-08-21T01:00:00.000Z",
    ));
    await store.save(storedConversation(
      "newer-chat",
      "گفتگوی جدیدتر",
      "2026-08-21T02:00:00.000Z",
    ));

    const streams: Array<{
      signal: AbortSignal;
      resolve: () => void;
    }> = [];
    vi.mocked(consumeChatStream).mockImplementation((request, onEvent, signal) => {
      void request;
      void onEvent;
      return new Promise<void>((resolve) => {
        streams.push({ signal: signal ?? new AbortController().signal, resolve });
      });
    });

    render(<ChatWorkspace user={user} onLogout={vi.fn()} />);

    await screen.findByRole("button", { name: /^گفتگوی جدیدتر/ });
    const composer = screen.getByRole("textbox", { name: "پیام به دستیار لیارا" });
    fireEvent.change(composer, { target: { value: "پاسخ این گفتگو ادامه پیدا کند" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    await waitFor(() => expect(streams).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: /^گفتگوی قدیمی/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "ارسال پیام" })).toBeTruthy();
    });
    expect(streams[0]?.signal.aborted).toBe(false);
    expect(screen.getByLabelText("گفتگوی «گفتگوی جدیدتر» در حال دریافت پاسخ است"))
      .toBeTruthy();

    fireEvent.change(composer, { target: { value: "این گفتگو هم مستقل پاسخ بگیرد" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    await waitFor(() => expect(streams).toHaveLength(2));
    expect(streams.every((stream) => !stream.signal.aborted)).toBe(true);

    streams.forEach((stream) => stream.resolve());
  });

  it("keeps the current response running when a new chat is opened", async () => {
    const store = getConversationStore(user.id);
    await store.clear();
    await store.save(storedConversation(
      "running-chat",
      "گفتگوی در حال اجرا",
      "2026-08-21T03:00:00.000Z",
    ));

    let streamSignal: AbortSignal | undefined;
    vi.mocked(consumeChatStream).mockImplementation((request, onEvent, signal) => {
      void request;
      void onEvent;
      streamSignal = signal;
      return new Promise<void>(() => undefined);
    });

    render(<ChatWorkspace user={user} onLogout={vi.fn()} />);

    await screen.findByRole("button", { name: "گفتگوی در حال اجرا" });
    const composer = screen.getByRole("textbox", { name: "پیام به دستیار لیارا" });
    fireEvent.change(composer, { target: { value: "این پاسخ در پس‌زمینه ادامه پیدا کند" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    await waitFor(() => expect(streamSignal).toBeDefined());

    fireEvent.click(within(
      screen.getByRole("complementary", { name: "تاریخچه گفتگوها" }),
    ).getByRole("button", { name: /گفتگوی جدید/ }));

    expect(await screen.findByRole("heading", { name: "چه مشکلی در لیارا داری؟" }))
      .toBeTruthy();
    expect(streamSignal?.aborted).toBe(false);
    expect(screen.getByLabelText("گفتگوی «گفتگوی در حال اجرا» در حال دریافت پاسخ است"))
      .toBeTruthy();
  });

  it("stops only the deleted chat and does not restore it when its stream settles", async () => {
    const store = getConversationStore(user.id);
    await store.clear();
    await store.save(storedConversation(
      "deleted-chat",
      "گفتگوی قابل حذف",
      "2026-08-21T04:00:00.000Z",
    ));

    let streamSignal: AbortSignal | undefined;
    vi.mocked(consumeChatStream).mockImplementation((request, onEvent, signal) => {
      void request;
      void onEvent;
      streamSignal = signal;
      return new Promise<void>((resolve) => {
        signal?.addEventListener("abort", () => window.setTimeout(resolve, 10), { once: true });
      });
    });

    render(<ChatWorkspace user={user} onLogout={vi.fn()} />);

    await screen.findByRole("button", { name: "گفتگوی قابل حذف" });
    const composer = screen.getByRole("textbox", { name: "پیام به دستیار لیارا" });
    fireEvent.change(composer, { target: { value: "این پاسخ سپس حذف می‌شود" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    await screen.findByLabelText("گفتگوی «گفتگوی قابل حذف» در حال دریافت پاسخ است");

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "گزینه‌های گفتگوی گفتگوی قابل حذف" }),
      { button: 0, ctrlKey: false },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "حذف گفتگو" }));
    const dialog = await screen.findByRole("alertdialog", { name: "حذف گفتگو؟" });
    fireEvent.click(within(dialog).getByRole("button", { name: "حذف گفتگو" }));

    await waitFor(() => expect(streamSignal?.aborted).toBe(true));
    await waitFor(() => {
      expect(screen.queryByLabelText("گفتگوی «گفتگوی قابل حذف» در حال دریافت پاسخ است"))
        .toBeNull();
    });
    expect(await store.get("deleted-chat")).toBeUndefined();
  });

  it("locks the composer when the server reports that the message quota is exhausted", async () => {
    const store = getConversationStore(user.id);
    await store.clear();
    const resetsAt = new Date(Date.now() + 30 * 60_000).toISOString();
    vi.mocked(consumeChatStream).mockImplementation(async (_request, onEvent) => {
      onEvent({ type: "quota", remaining: 0, resetsAt });
      onEvent({ type: "delta", text: "پاسخ آخر این بازه" });
      onEvent({ type: "done" });
    });

    render(<ChatWorkspace user={user} onLogout={vi.fn()} startOnNewConversation />);
    const composer = await screen.findByRole("textbox", { name: "پیام به دستیار لیارا" });
    fireEvent.change(composer, { target: { value: "آخرین پیام مجاز" } });
    fireEvent.keyDown(composer, { key: "Enter" });

    await waitFor(() => expect(composer.hasAttribute("disabled")).toBe(true));
    expect(screen.getByText(/سقف پیام‌های این بازه تکمیل شده/)).toBeTruthy();
    expect(localStorage.getItem(`liara-assistant-limit:${user.id}`)).toBe(
      String(Date.parse(resetsAt)),
    );
    fireEvent.change(composer, { target: { value: "نباید ارسال شود" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(consumeChatStream).toHaveBeenCalledOnce();
  });

  it("renders an agent-generated ticket draft without calling a transport", async () => {
    const store = getConversationStore(user.id);
    await store.clear();
    vi.mocked(consumeChatStream).mockImplementation(async (_request, onEvent) => {
      onEvent({ type: "delta", text: "پاسخ قابل اتکایی در مستندات پیدا نکردم." });
      onEvent({
        type: "ticket",
        draft: {
          subject: "خطای ناشناخته برنامه",
          body: "برنامه در مرحله استقرار با خطا متوقف می‌شود.",
        },
      });
      onEvent({ type: "done" });
    });
    render(<ChatWorkspace user={user} onLogout={vi.fn()} startOnNewConversation />);
    const composer = await screen.findByRole("textbox", { name: "پیام به دستیار لیارا" });
    fireEvent.change(composer, { target: { value: "این خطا در داک نیست" } });
    fireEvent.keyDown(composer, { key: "Enter" });

    const sendTicket = await screen.findByRole("button", { name: "ارسال تیکت" });
    expect((sendTicket as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("خطای ناشناخته برنامه")).toBeTruthy();
    expect(screen.getByText(/فعلاً هیچ درخواستی ارسال نمی‌شود/)).toBeTruthy();
  });
});
