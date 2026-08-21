import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PanelDashboard } from "./panel-dashboard";

afterEach(cleanup);

describe("PanelDashboard", () => {
  it("offers a direct assistant entry from the empty platform dashboard", () => {
    render(<PanelDashboard />);

    expect(screen.getByRole("heading", { name: "هنوز برنامه‌ای نساخته‌اید" })).toBeTruthy();
    const assistantLinks = screen.getAllByRole("link", { name: /دستیار لیارا/ });
    expect(assistantLinks.length).toBeGreaterThanOrEqual(2);
    expect(assistantLinks.every((link) => link.getAttribute("href") === "/assistant?source=panel"))
      .toBe(true);
    expect(screen.getByRole("link", { name: "مستندات" }).getAttribute("href")).toBe("/docs");
  });

  it("explains the simulated create-service action", () => {
    render(<PanelDashboard />);

    fireEvent.click(screen.getByRole("button", { name: "ایجاد برنامه" }));
    expect(screen.getByRole("status").textContent).toContain(
      "ساخت سرویس در این نمونه فعال نیست.",
    );
  });
});
