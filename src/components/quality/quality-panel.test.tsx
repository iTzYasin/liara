import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QualityPanel } from "@/components/quality/quality-panel";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>گزارش کیفیت</button>
      <QualityPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}

describe("QualityPanel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns focus to the invoking control after closing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "گزارش کیفیت" });

    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "به‌روزرسانی گزارش" })));
    fireEvent.click(screen.getAllByRole("button", { name: "بستن گزارش کیفیت" }).at(-1)!);

    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
