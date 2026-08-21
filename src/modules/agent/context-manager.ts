import type { ChatHistoryMessage } from "@/modules/chat/types";

interface ContextOptions {
  recentMessageCount?: number;
  summaryMaxCharacters?: number;
}

function compact(value: string) {
  return value
    .replace(/\[\[\d+\]\]/g, "")
    .replace(/#{1,6}\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(value: string, limit: number) {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

/**
 * Builds a compact, sanitized-on-input rolling memory. It deliberately keeps
 * concrete errors, commands and user-confirmed actions instead of asking a
 * second model to summarize every turn.
 */
export function summarizeConversationHistory(
  history: ChatHistoryMessage[],
  previousSummary = "",
  maxCharacters = 2_400,
) {
  const previous = compact(previousSummary);
  const entries = history
    .map((message) => {
      const content = compact(message.content);
      if (!content) return "";
      return `${message.role === "user" ? "کاربر" : "نتیجه دستیار"}: ${clip(content, 520)}`;
    })
    .filter(Boolean);
  const previousBudget = previous ? Math.min(Math.ceil(maxCharacters * 0.35), previous.length) : 0;
  const prefix = previousBudget ? `خلاصه قبلی: ${clip(previous, previousBudget)}` : "";
  const availableForEntries = Math.max(0, maxCharacters - prefix.length - (prefix ? 3 : 0));
  const selected: string[] = [];
  let used = 0;
  for (const entry of entries.reverse()) {
    const separator = selected.length ? 3 : 0;
    if (used + separator + entry.length > availableForEntries) {
      const remaining = availableForEntries - used - separator;
      if (remaining >= 48) selected.push(clip(entry, remaining));
      break;
    }
    selected.push(entry);
    used += separator + entry.length;
  }
  const body = selected.reverse().join(" | ");
  return [prefix, body].filter(Boolean).join(" | ").slice(0, maxCharacters);
}

export function buildConversationContext(
  history: ChatHistoryMessage[],
  previousSummary = "",
  options: ContextOptions = {},
) {
  const recentMessageCount = options.recentMessageCount ?? 6;
  const summaryMaxCharacters = options.summaryMaxCharacters ?? 2_400;
  const recent = history.slice(-recentMessageCount);
  const older = history.slice(0, Math.max(0, history.length - recent.length));
  return {
    summary: summarizeConversationHistory(older, previousSummary, summaryMaxCharacters),
    recent,
  };
}
