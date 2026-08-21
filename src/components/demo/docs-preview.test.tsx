import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DocsPreview } from "./docs-preview";

afterEach(cleanup);

describe("DocsPreview", () => {
  it("connects docs readers to the assistant and simulated panel", () => {
    render(<DocsPreview />);

    expect(screen.getByRole("heading", { name: "به مستندات لیارا خوش آمدید" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "از دستیار بپرس" }).getAttribute("href"))
      .toBe("/assistant?source=docs");
    expect(screen.getByRole("link", { name: "ورود به پنل کاربری" }).getAttribute("href"))
      .toBe("/panel");
    expect(screen.getByRole("link", { name: "مشاهده مخزن مستندات" }).getAttribute("href"))
      .toBe("https://github.com/liara-cloud/docs");
    expect(
      screen.getByRole("link", { name: "شروع گفتگو با دستیار لیارا" }).getAttribute("href"),
    ).toBe("/assistant?source=docs");
  });

  it("keeps demo search honest and points to the official source", () => {
    render(<DocsPreview />);

    fireEvent.change(screen.getByRole("searchbox", { name: "جستجو در مستندات" }), {
      target: { value: "اتصال دامنه" },
    });
    expect(screen.getByRole("status").textContent).toContain("جستجوی زنده در این شبیه‌سازی فعال نیست");
  });
});
