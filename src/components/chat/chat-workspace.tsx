"use client";

import { Menu, Moon, PanelLeftClose, PanelLeftOpen, Plus, Sun } from "lucide-react";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ConversationSidebar } from "@/components/chat/conversation-sidebar";
import { EmptyState } from "@/components/chat/empty-state";
import { MessageList } from "@/components/chat/message-list";
import { SourcePanel } from "@/components/chat/source-panel";
import { useChatWorkspaceController } from "@/components/chat/use-chat-workspace-controller";
import { downloadConversation } from "@/modules/conversations/conversation-exporter";
import type { AssistantEntryContext } from "@/modules/demo/assistant-entry-context";
import type { WorkspaceUser } from "@/modules/chat/types";

interface ChatWorkspaceProps {
  user: WorkspaceUser;
  onLogout: () => void;
  entryContext?: AssistantEntryContext;
  accountActionLabel?: string;
  startOnNewConversation?: boolean;
}

export function ChatWorkspace({
  user,
  onLogout,
  entryContext,
  accountActionLabel = "خروج از حساب",
  startOnNewConversation = false,
}: ChatWorkspaceProps) {
  const {
    conversation,
    sidebar,
    sources,
    sourceToggleRef,
    theme,
    lockRemainingSeconds,
  } = useChatWorkspaceController({ userId: user.id, startOnNewConversation });

  return (
    <main className="workspace-shell">
      <ConversationSidebar
        open={sidebar.open}
        conversations={conversation.items}
        activeId={conversation.active?.id}
        pendingConversationIds={conversation.pendingIds}
        onClose={() => sidebar.setOpen(false)}
        onNew={conversation.newConversation}
        onSelect={conversation.selectConversation}
        onRemove={conversation.removeConversation}
        onRename={conversation.renameConversation}
        onExport={downloadConversation}
        user={user}
        onLogout={onLogout}
        accountActionLabel={accountActionLabel}
      />

      <section id="main-content" tabIndex={-1} className="chat-column" aria-label="گفتگو با دستیار لیارا">
        <h1 className="sr-only">دستیار هوشمند مستندات لیارا</h1>
        <header className="mobile-header">
          <div className="mobile-header-slot mobile-header-slot-history">
            <button className="icon-button" onClick={() => sidebar.setOpen(true)} aria-label="بازکردن تاریخچه">
              <Menu size={20} />
            </button>
          </div>
          <div className="mobile-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/liara-logo.svg"
              alt="لیارا"
              width={46}
              height={20}
            />
            <span>دستیار مستندات</span>
          </div>
          <div className="mobile-header-slot mobile-header-actions">
            <button
              className="icon-button top-theme-toggle"
              onClick={theme.toggle}
              aria-label={theme.dark ? "فعال‌کردن تم روشن" : "فعال‌کردن تم تاریک"}
              title={theme.dark ? "تم روشن" : "تم تاریک"}
            >
              {theme.dark ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            <button className="icon-button" onClick={conversation.newConversation} aria-label="گفتگوی جدید">
              <Plus size={20} />
            </button>
          </div>
        </header>

        <div className="trust-strip">
          <div className="trust-strip-actions">
            {sources.items.length > 0 && (
              <button
                ref={sourceToggleRef}
                type="button"
                className="sources-compact"
                aria-expanded={sources.panelOpen}
                aria-controls="source-panel"
                aria-label={`${sources.panelOpen ? "بستن" : "بازکردن"} پنل ${sources.items.length.toLocaleString("fa-IR")} منبع`}
                onClick={() => sources.setPanelOpen((open) => !open)}
              >
                {sources.items.length.toLocaleString("fa-IR")} منبع
                {sources.panelOpen
                  ? <PanelLeftClose size={15} aria-hidden="true" />
                  : <PanelLeftOpen size={15} aria-hidden="true" />}
              </button>
            )}
            <button
              className="top-theme-toggle theme-toggle-desktop"
              onClick={theme.toggle}
              aria-label={theme.dark ? "فعال‌کردن تم روشن" : "فعال‌کردن تم تاریک"}
              title={theme.dark ? "تم روشن" : "تم تاریک"}
            >
              {theme.dark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          </div>
        </div>

        {!conversation.hydrated ? (
          <div className="loading-state">در حال بازیابی گفتگوها…</div>
        ) : !conversation.active?.messages.length ? (
          <EmptyState
            entryContext={entryContext}
            onPrompt={(prompt) => void conversation.sendMessage(prompt)}
          />
        ) : (
          <MessageList
            messages={conversation.active.messages}
            status={conversation.activeStatus}
            onRetry={conversation.retryMessage}
            onOpenSources={sources.openPanel}
            sourcePanelOpen={sources.panelOpen}
            scrollToLatestSignal={conversation.scrollToLatestSignal}
          />
        )}

        <ChatComposer
          disabled={conversation.activePending}
          lockRemainingSeconds={lockRemainingSeconds}
          onSubmit={(message, attachments) => void conversation.sendMessage(message, attachments)}
          onStop={conversation.stopActiveResponse}
        />
      </section>

      <SourcePanel
        open={sources.panelOpen}
        sources={sources.items}
        selected={sources.selected}
        onSelect={sources.setSelected}
        onClose={sources.closePanel}
      />
    </main>
  );
}
