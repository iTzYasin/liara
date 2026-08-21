import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextStreamingSlice, useStreamingReveal } from "@/components/chat/use-streaming-reveal";

function mockReducedMotion(matches: boolean) {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

describe("useStreamingReveal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockReducedMotion(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reveals a newly streamed answer progressively", () => {
    const { result, rerender } = renderHook(
      ({ text, streaming }) => useStreamingReveal(text, streaming),
      { initialProps: { text: "", streaming: true } },
    );

    const answer = "این پاسخ باید با یک ریتم آرام و خوانا نمایش داده شود.";
    rerender({ text: answer, streaming: false });

    expect(result.current.visibleText).toBe("");
    act(() => vi.advanceTimersByTime(30));
    expect(result.current.visibleText.length).toBeGreaterThan(0);
    expect(result.current.visibleText.length).toBeLessThan(answer.length);

    for (let step = 0; step < 40 && result.current.isRevealing; step += 1) {
      act(() => vi.advanceTimersByTime(100));
    }
    expect(result.current.visibleText).toBe(answer);
    expect(result.current.isRevealing).toBe(false);
  });

  it("shows saved answers immediately", () => {
    const { result } = renderHook(() => useStreamingReveal("پاسخ ذخیره‌شده", false));
    expect(result.current.visibleText).toBe("پاسخ ذخیره‌شده");
    expect(result.current.isRevealing).toBe(false);
  });

  it("catches up quickly after the network stream has completed", () => {
    const { result, rerender } = renderHook(
      ({ text, streaming }) => useStreamingReveal(text, streaming),
      { initialProps: { text: "", streaming: true } },
    );
    const answer = "پاسخ مستند و کامل. ".repeat(140);

    rerender({ text: answer, streaming: false });
    for (let step = 0; step < 60 && result.current.isRevealing; step += 1) {
      act(() => vi.advanceTimersByTime(20));
    }

    expect(result.current.visibleText).toBe(answer);
    expect(result.current.isRevealing).toBe(false);
  });

  it("skips the animation when reduced motion is preferred", () => {
    mockReducedMotion(true);
    const { result, rerender } = renderHook(
      ({ text, streaming }) => useStreamingReveal(text, streaming),
      { initialProps: { text: "", streaming: true } },
    );

    rerender({ text: "پاسخ کامل", streaming: false });
    act(() => vi.runAllTimers());
    expect(result.current.visibleText).toBe("پاسخ کامل");
  });
});

describe("nextStreamingSlice", () => {
  it("never splits a unicode character", () => {
    expect(nextStreamingSlice("💙 پاسخ", 0)).toMatch(/^💙/);
  });
});
