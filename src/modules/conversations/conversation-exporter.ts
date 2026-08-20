import type { Conversation, StoredMessage } from "@/modules/chat/types";

function messageMarkdown(message: StoredMessage) {
  const heading = message.role === "user" ? "کاربر" : "دستیار لیارا";
  const attachments = message.attachments?.length
    ? `\n\nفایل‌ها: ${message.attachments.map((item) => item.name).join("، ")}`
    : "";
  const sources = message.sources?.length
    ? `\n\nمنابع:\n${message.sources.map((source) =>
        `- [${source.citationIndex}] [${source.title} — ${source.heading}](${source.url})`,
      ).join("\n")}`
    : "";
  return `## ${heading}\n\n${message.content}${attachments}${sources}`;
}

export function conversationToMarkdown(conversation: Conversation) {
  return [
    `# ${conversation.title}`,
    "",
    `تاریخ خروجی: ${new Date().toISOString()}`,
    "",
    "> این خروجی فقط شامل نسخه پاک‌سازی‌شده گفتگو و منابع رسمی است.",
    "",
    conversation.messages.map(messageMarkdown).join("\n\n---\n\n"),
    "",
  ].join("\n");
}

export function safeExportFilename(title: string) {
  const slug = title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 64)
    .replace(/^-|-$/g, "");
  return `${slug || "liara-conversation"}.md`;
}

export function downloadConversation(conversation: Conversation) {
  const blob = new Blob([conversationToMarkdown(conversation)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeExportFilename(conversation.title);
  link.click();
  URL.revokeObjectURL(url);
}
