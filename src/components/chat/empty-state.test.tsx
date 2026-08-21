import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmptyState } from "./empty-state";

afterEach(cleanup);

describe("EmptyState entry variants", () => {
  it("welcomes a user arriving from the empty panel", () => {
    render(
      <EmptyState
        entryContext={{ source: "panel", returnHref: "/panel" }}
        onPrompt={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", {
        name: "برای شروع روی لیارا چه کمکی می‌خواهی؟",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "بازگشت به پیشخوان" }).getAttribute("href"),
    ).toBe("/panel");
    expect(screen.getByText("ورود از پیشخوان لیارا")).toBeTruthy();
  });

  it("welcomes a user arriving from docs without sending anything", () => {
    const onPrompt = vi.fn();
    render(
      <EmptyState
        entryContext={{ source: "docs", returnHref: "/docs" }}
        onPrompt={onPrompt}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "در مستندات دنبال چه چیزی هستی؟" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "بازگشت به مستندات" }).getAttribute("href"),
    ).toBe("/docs");
    expect(screen.getByText("ورود از مستندات لیارا")).toBeTruthy();
    expect(onPrompt).not.toHaveBeenCalled();
  });

  it("keeps the direct assistant welcome when no entry context is supplied", () => {
    render(<EmptyState onPrompt={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "چه مشکلی در لیارا داری؟" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /بازگشت/ })).toBeNull();
  });
});
