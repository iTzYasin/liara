import type { AgentEvent, ChatRequest } from "@/modules/chat/types";

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
    const body = (await response.json().catch(() => ({}))) as { message?: string };
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
