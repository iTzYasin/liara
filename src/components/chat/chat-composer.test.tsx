import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatComposer } from "@/components/chat/chat-composer";

describe("ChatComposer action states", () => {
  it("keeps ready-to-send and stop controls semantically distinct", () => {
    const onStop = vi.fn();
    const { rerender } = render(
      <ChatComposer
        disabled={false}
        onSubmit={vi.fn()}
        onStop={onStop}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "پیام به دستیار لیارا" }), {
      target: { value: "پیام آماده ارسال" },
    });
    const send = screen.getByRole("button", { name: "ارسال پیام" });
    expect(send.classList.contains("is-ready")).toBe(true);
    expect(send.classList.contains("is-stopping")).toBe(false);

    rerender(
      <ChatComposer
        disabled
        onSubmit={vi.fn()}
        onStop={onStop}
      />,
    );
    const stop = screen.getByRole("button", { name: "توقف پاسخ" });
    expect(stop.classList.contains("is-stopping")).toBe(true);
    expect(stop.classList.contains("is-ready")).toBe(false);
    fireEvent.click(stop);
    expect(onStop).toHaveBeenCalledOnce();
  });
});
