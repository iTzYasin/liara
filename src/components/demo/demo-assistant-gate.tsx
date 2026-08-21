"use client";

import { useRouter } from "next/navigation";
import { ChatWorkspace } from "@/components/chat/chat-workspace";
import { parseAssistantEntryContext } from "@/modules/demo/assistant-entry-context";
import type { WorkspaceUser } from "@/modules/chat/types";

const demoUser: WorkspaceUser = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "کاربر لیارا",
  email: "demo@liara.local",
  createdAt: "2026-08-21T00:00:00.000Z",
};

export function DemoAssistantGate({ source }: { source?: string }) {
  const router = useRouter();
  const entryContext = parseAssistantEntryContext(source);

  return (
    <ChatWorkspace
      user={demoUser}
      entryContext={entryContext}
      accountActionLabel="بازگشت به مبدأ"
      onLogout={() => router.push(entryContext.returnHref)}
    />
  );
}
