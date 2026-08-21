"use client";

import { useEffect, useState } from "react";

const FRAME_DELAY_MS = 28;

function revealSize(remaining: number, streaming: boolean) {
  // The server streams validated chunks. Once it sends the completion event,
  // the client must not keep the user waiting for a second, artificial stream.
  if (!streaming) {
    if (remaining > 1_200) return 260;
    if (remaining > 600) return 180;
    if (remaining > 240) return 120;
    if (remaining > 80) return 56;
    return 20;
  }
  if (remaining > 1_200) return 18;
  if (remaining > 600) return 12;
  if (remaining > 240) return 8;
  if (remaining > 80) return 5;
  return 2;
}

export function nextStreamingSlice(target: string, visibleLength: number, streaming = true) {
  const remaining = Array.from(target.slice(visibleLength));
  const chunk = remaining.slice(0, revealSize(remaining.length, streaming)).join("");
  return target.slice(0, visibleLength) + chunk;
}

function nextFrameDelay(visibleText: string) {
  if (/\n$/.test(visibleText)) return 58;
  if (/[.!؟!]\s*$/.test(visibleText)) return 72;
  if (/[,،؛:]\s*$/.test(visibleText)) return 44;
  return FRAME_DELAY_MS;
}

export function useStreamingReveal(target: string, streaming: boolean) {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [visibleText, setVisibleText] = useState(() => (streaming ? "" : target));

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (visibleText === target) return;

    const timer = window.setTimeout(() => {
      setVisibleText((current) => {
        if (reducedMotion) return target;
        // Retrying keeps the same message id. Reset the visual buffer when the
        // replacement stream starts instead of briefly showing the previous answer.
        if (!target.startsWith(current)) return streaming ? "" : target;
        return nextStreamingSlice(target, current.length, streaming);
      });
    }, reducedMotion ? 0 : streaming ? nextFrameDelay(visibleText) : 16);

    return () => window.clearTimeout(timer);
  }, [reducedMotion, streaming, target, visibleText]);

  const isRevealing = streaming || visibleText !== target;
  return { visibleText, isRevealing };
}
