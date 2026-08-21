import type { AgentEvent, ChatRequest } from "@/modules/chat/types";

export class ChatRateLimitError extends Error {
  constructor(
    message: string,
    public readonly lockedUntil: number,
  ) {
    super(message);
    this.name = "ChatRateLimitError";
  }
}

function parseEventBlock(block: string): AgentEvent | undefined {
  const dataLine = block
    .split("\n")
    .find((line) => line.startsWith("data:"));
  if (!dataLine) return undefined;
  try {
    return JSON.parse(dataLine.slice(5).trim()) as AgentEvent;
  } catch {
    return undefined;
  }
}

export async function consumeChatStream(
  request: ChatRequest,
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal,
) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      code?: string;
      message?: string;
      retryAfterSeconds?: number;
      lockedUntil?: string;
    };
    if (response.status === 429 || body.code === "RATE_LIMITED") {
      const parsedLock = body.lockedUntil ? Date.parse(body.lockedUntil) : Number.NaN;
      const retrySeconds = Number(
        body.retryAfterSeconds ?? response.headers.get("Retry-After") ?? 60,
      );
      throw new ChatRateLimitError(
        body.message ?? "سقف استفاده شما تکمیل شده است.",
        Number.isFinite(parsedLock)
          ? parsedLock
          : Date.now() + Math.max(1, retrySeconds) * 1_000,
      );
    }
    throw new Error(body.message ?? "ارسال پیام با خطا روبه‌رو شد.");
  }
  if (!response.body) throw new Error("پاسخ استریم در دسترس نیست.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const event = parseEventBlock(block);
      if (event) onEvent(event);
    }
    if (done) break;
  }
  if (buffer.trim()) {
    const event = parseEventBlock(buffer);
    if (event) onEvent(event);
  }
}
