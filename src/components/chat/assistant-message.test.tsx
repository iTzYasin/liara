import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { AssistantMessage } from "@/components/chat/assistant-message";

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
});

describe("AssistantMessage", () => {
  it("lets the browser derive answer direction from the model-generated language", () => {
    render(<AssistantMessage
      message={{
        id: "assistant-russian",
        role: "assistant",
        content: "Подключитесь к PostgreSQL через PDO.",
        createdAt: "2026-08-21T00:00:00.000Z",
        status: "complete",
      }}
      onRetry={() => undefined}
    />);

    const answer = screen
      .getByText("Подключитесь к PostgreSQL через PDO.")
      .closest(".markdown-body");

    expect(answer?.getAttribute("dir")).toBe("auto");
  });

  it("keeps internal workflow state out of the user-facing answer", () => {
    render(<AssistantMessage
      message={{
        id: "assistant-with-workflow",
        role: "assistant",
        content: "Connection instructions are ready.",
        createdAt: "2026-08-21T00:00:00.000Z",
        status: "complete",
        workflow: {
          goal: "Connect PHP to PostgreSQL",
          phase: "active",
          turnCount: 1,
          steps: [{
            id: "step-1",
            label: "Enable the PDO extension",
            status: "current",
          }],
        },
      }}
      onRetry={() => undefined}
    />);

    expect(screen.getByText("Connection instructions are ready.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "مسیر حل مسئله" })).toBeNull();
  });

  it("shows the generated ticket draft and keeps transport disabled for the next phase", () => {
    render(<AssistantMessage
      message={{
        id: "assistant-ticket",
        role: "assistant",
        content: "برای این مورد پاسخ قابل اتکایی در مستندات پیدا نکردم.",
        createdAt: "2026-08-21T00:00:00.000Z",
        status: "complete",
        ticket: {
          status: "ready",
          draft: {
            subject: "خطای ناشناخته استقرار",
            body: "برنامه در مرحله build با خطای ناشناخته متوقف می‌شود.",
          },
        },
      }}
      onRetry={() => undefined}
    />);

    expect(screen.getByRole("region", { name: "پیش‌نویس تیکت پشتیبانی" })).toBeTruthy();
    expect(screen.getByText("خطای ناشناخته استقرار")).toBeTruthy();
    expect(screen.getByText("برنامه در مرحله build با خطای ناشناخته متوقف می‌شود.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "ارسال تیکت" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("note").textContent).toContain("فعلاً هیچ درخواستی ارسال نمی‌شود");
  });

  it("opens the full sources panel from the remaining sources button", () => {
    const onOpenSources = vi.fn();
    const sources = Array.from({ length: 5 }, (_, index) => ({
      id: `source-${index + 1}`,
      citationIndex: index + 1,
      title: `منبع ${index + 1}`,
      heading: `بخش ${index + 1}`,
      service: "paas",
      url: `https://docs.liara.ir/source-${index + 1}`,
      snippet: `توضیح منبع ${index + 1}`,
      score: 1,
    }));

    render(<AssistantMessage
      message={{
        id: "assistant-with-many-sources",
        role: "assistant",
        content: "پاسخ مستند آماده است.",
        createdAt: "2026-08-21T00:00:00.000Z",
        status: "complete",
        sources,
      }}
      onRetry={() => undefined}
      onOpenSources={onOpenSources}
    />);

    fireEvent.click(screen.getByRole("button", { name: "مشاهده هر ۵ منبع در پنل منابع" }));

    expect(onOpenSources).toHaveBeenCalledWith(sources[4]);
  });
});
