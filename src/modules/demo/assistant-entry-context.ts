export type AssistantEntryContext =
  | { source: "panel"; returnHref: "/panel" }
  | { source: "docs"; returnHref: "/docs" }
  | { source: "direct"; returnHref: "/" };

export function parseAssistantEntryContext(
  source: string | null | undefined,
): AssistantEntryContext {
  if (source === "panel") return { source: "panel", returnHref: "/panel" };
  if (source === "docs") return { source: "docs", returnHref: "/docs" };
  return { source: "direct", returnHref: "/" };
}
