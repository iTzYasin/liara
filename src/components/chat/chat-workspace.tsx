"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChatAttachment,
  Conversation,
  SourceDocument,
  StoredMessage,
} from "@/modules/chat/types";
import { consumeChatStream } from "@/modules/chat/chat-client";
import { getConversationStore } from "@/modules/conversations/conversation-store";
import { redactSensitiveText } from "@/modules/security/secret-redactor";
import { ConversationSidebar } from "@/components/chat/conversation-sidebar";
import { ChatComposer } from "@/components/chat/chat-composer";
import { MessageList } from "@/components/chat/message-list";
import { EmptyState } from "@/components/chat/empty-state";
import { SourcePanel } from "@/components/chat/source-panel";
import { Menu, PanelLeftClose, Plus, ShieldCheck } from "lucide-react";
import { QualityPanel } from "@/components/quality/quality-panel";
import { downloadConversation } from "@/modules/conversations/conversation-exporter";

function now() {
  return new Date().toISOString();
}

function createConversation(message: string): Conversation {
  const timestamp = now();
  return {
    id: crypto.randomUUID(),
    title: message.replace(/\s+/g, " ").trim().slice(0, 48) || "گفتگوی جدید",
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: [],
  };
}

function clientSafeAttachments(attachments: ChatAttachment[]) {
  let redactionCount = 0;
  const safe = attachments.map((attachment) => {
    if (attachment.kind !== "text") return attachment;
    const result = redactSensitiveText(attachment.content);
    redactionCount += result.count;
    return { ...attachment, content: result.text, redactionCount: result.count };
  });
  return { safe, redactionCount };
}

export function ChatWorkspace() {
  const store = useMemo(() => getConversationStore(), []);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<Conversation>();
  const [selectedSource, setSelectedSource] = useState<SourceDocument>();
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [status, setStatus] = useState<string>();
  const [sending, setSending] = useState(false);
  const [scrollToLatestSignal, setScrollToLatestSignal] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const visibleConversationIdRef = useRef<string | null>(null);
  const lastCheckpointAtRef = useRef(0);

  const refreshList = useCallback(async () => {
    setConversations(await store.list());
  }, [store]);

  useEffect(() => {
    void (async () => {
      const items = await store.list();
      setConversations(items);
      // A fast user can submit while IndexedDB hydration is still pending.
      // Never let the older hydration snapshot replace that newly created turn.
      if (visibleConversationIdRef.current === null) {
        setActiveConversation(items[0]);
        visibleConversationIdRef.current = items[0]?.id ?? null;
      }
      setHydrated(true);
    })();
  }, [store]);

  const persist = useCallback(
    (conversation: Conversation) => {
      if (visibleConversationIdRef.current === conversation.id) setActiveConversation(conversation);
      void store.save(conversation).then(refreshList);
    },
    [refreshList, store],
  );

  const newConversation = useCallback(() => {
    abortRef.current?.abort();
    visibleConversationIdRef.current = null;
    setActiveConversation(undefined);
    setSelectedSource(undefined);
    setSourcePanelOpen(false);
    setSidebarOpen(false);
    setStatus(undefined);
    setSending(false);
  }, []);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        newConversation();
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [newConversation]);

  const selectConversation = useCallback(
    async (id: string) => {
      const conversation = await store.get(id);
      if (!conversation) return;
      visibleConversationIdRef.current = conversation.id;
      setActiveConversation(conversation);
      setSidebarOpen(false);
      setSelectedSource(undefined);
      setSourcePanelOpen(false);
    },
    [store],
  );

  const removeConversation = useCallback(
    async (id: string) => {
      await store.remove(id);
      if (activeConversation?.id === id) {
        visibleConversationIdRef.current = null;
        setActiveConversation(undefined);
      }
      await refreshList();
    },
    [activeConversation?.id, refreshList, store],
  );

  const renameConversation = useCallback(
    async (id: string, title: string) => {
      const conversation = await store.get(id);
      if (!conversation) return;
      const renamed = { ...conversation, title, updatedAt: now() };
      await store.save(renamed);
      if (activeConversation?.id === id) setActiveConversation(renamed);
      await refreshList();
    },
    [activeConversation?.id, refreshList, store],
  );

  const updateMessage = useCallback(
    (conversation: Conversation, messageId: string, updater: (message: StoredMessage) => StoredMessage) => {
      const next = {
        ...conversation,
        updatedAt: now(),
        messages: conversation.messages.map((message) =>
          message.id === messageId ? updater(message) : message,
        ),
      };
      if (visibleConversationIdRef.current === next.id) setActiveConversation(next);
      return next;
    },
    [],
  );

  const sendMessage = useCallback(
    async (
      rawMessage: string,
      attachments: ChatAttachment[] = [],
      retryAssistantId?: string,
    ) => {
      if (sending || (!rawMessage.trim() && !attachments.length)) return;
      const messageResult = redactSensitiveText(rawMessage.trim());
      const attachmentResult = clientSafeAttachments(attachments);
      const redactionCount = messageResult.count + attachmentResult.redactionCount;
      const base = activeConversation ?? createConversation(messageResult.text);
      const retryAssistantIndex = retryAssistantId
        ? base.messages.findIndex((message) => message.id === retryAssistantId)
        : -1;
      const retryUserIndex = retryAssistantIndex > 0 && base.messages[retryAssistantIndex - 1]?.role === "user"
        ? retryAssistantIndex - 1
        : -1;
      const userMessage: StoredMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: messageResult.text,
        createdAt: now(),
        attachments: attachmentResult.safe.map((attachment) => ({
          id: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
          size: attachment.size,
          kind: attachment.kind,
          redactionCount: attachment.redactionCount,
        })),
        meta: { redactionCount },
      };
      const assistantId = retryAssistantIndex >= 0 ? retryAssistantId! : crypto.randomUUID();
      const assistantMessage: StoredMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        createdAt: now(),
        status: "streaming",
        sources: [],
      };
      let current: Conversation = {
        ...base,
        updatedAt: now(),
        messages: retryAssistantIndex >= 0
          ? base.messages.map((message, index) => index === retryAssistantIndex ? assistantMessage : message)
          : [...base.messages, userMessage, assistantMessage],
      };
      visibleConversationIdRef.current = current.id;
      persist(current);
      lastCheckpointAtRef.current = Date.now();
      setScrollToLatestSignal((value) => value + 1);
      setSending(true);
      setStatus(redactionCount ? `${redactionCount} مورد حساس ماسک شد` : "در حال دریافت پیام");
      setSelectedSource(undefined);

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        await consumeChatStream(
          {
            message: messageResult.text,
            conversationId: current.id,
            history: (retryUserIndex >= 0 ? base.messages.slice(0, retryUserIndex) : base.messages)
              .slice(-12)
              .map((message) => ({
              role: message.role,
              content: message.content,
              })),
            attachments: attachmentResult.safe,
          },
          (event) => {
            if (event.type === "status") {
              setStatus(event.message);
              return;
            }
            if (event.type === "sources") {
              current = updateMessage(current, assistantId, (message) => ({
                ...message,
                sources: event.sources,
              }));
              return;
            }
            if (event.type === "delta") {
              current = updateMessage(current, assistantId, (message) => ({
                ...message,
                content: message.content + event.text,
              }));
              if (Date.now() - lastCheckpointAtRef.current >= 750) {
                lastCheckpointAtRef.current = Date.now();
                void store.save(current);
              }
              return;
            }
            if (event.type === "meta") {
              current = updateMessage(current, assistantId, (message) => ({
                ...message,
                meta: {
                  confidence: event.confidence,
                  intent: event.intent,
                  requestId: event.requestId,
                  redactionCount: event.redactionCount,
                },
              }));
              return;
            }
            if (event.type === "error") {
              current = updateMessage(current, assistantId, (message) => ({
                ...message,
                content: message.content || event.message,
                status: "error",
              }));
            }
          },
          controller.signal,
        );
        current = updateMessage(current, assistantId, (message) => ({
          ...message,
          status: message.status === "error" ? "error" : "complete",
        }));
        persist(current);
      } catch (error) {
        if (controller.signal.aborted) {
          current = updateMessage(current, assistantId, (message) => ({
            ...message,
            content: message.content || "تولید پاسخ متوقف شد.",
            status: "complete",
          }));
        } else {
          current = updateMessage(current, assistantId, (message) => ({
            ...message,
            content: message.content || (error instanceof Error ? error.message : "پاسخ کامل نشد."),
            status: "error",
          }));
        }
        persist(current);
      } finally {
        setSending(false);
        setStatus(undefined);
        abortRef.current = null;
      }
    },
    [activeConversation, persist, sending, store, updateMessage],
  );

  const retryMessage = useCallback(
    (assistantId: string) => {
      if (!activeConversation || sending) return;
      const assistantIndex = activeConversation.messages.findIndex((message) => message.id === assistantId);
      const userMessage = assistantIndex > 0 ? activeConversation.messages[assistantIndex - 1] : undefined;
      if (userMessage?.role !== "user") return;
      void sendMessage(userMessage.content, [], assistantId);
    },
    [activeConversation, sendMessage, sending],
  );

  const openSource = useCallback((source: SourceDocument) => {
    setSelectedSource(source);
    setSourcePanelOpen(true);
  }, []);

  const activeSources = activeConversation?.messages
    .flatMap((message) => message.sources ?? [])
    .filter((source, index, items) => items.findIndex((item) => item.id === source.id) === index) ?? [];

  return (
    <main className="workspace-shell">
      <ConversationSidebar
        open={sidebarOpen}
        conversations={conversations}
        activeId={activeConversation?.id}
        onClose={() => setSidebarOpen(false)}
        onNew={newConversation}
        onSelect={selectConversation}
        onRemove={removeConversation}
        onRename={renameConversation}
        canExport={Boolean(activeConversation?.messages.length)}
        onExport={() => {
          if (activeConversation) downloadConversation(activeConversation);
        }}
        onOpenQuality={() => {
          setSidebarOpen(false);
          setSourcePanelOpen(false);
          setQualityOpen(true);
        }}
      />

      <section className="chat-column" aria-label="گفتگو با دستیار لیارا">
        <header className="mobile-header">
          <button className="icon-button" onClick={() => setSidebarOpen(true)} aria-label="بازکردن تاریخچه">
            <Menu size={20} />
          </button>
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
          <button className="icon-button" onClick={newConversation} aria-label="گفتگوی جدید">
            <Plus size={20} />
          </button>
        </header>

        <div className="trust-strip">
          <span className="trust-dot" />
          <span>پاسخ مستند به داک رسمی لیارا</span>
          <span className="trust-separator" />
          <ShieldCheck size={15} />
          <span>ورودی حساس ماسک می‌شود</span>
          {activeSources.length > 0 && (
            <button className="sources-compact" onClick={() => setSourcePanelOpen(true)}>
              {activeSources.length} منبع
              <PanelLeftClose size={15} />
            </button>
          )}
        </div>

        {!hydrated ? (
          <div className="loading-state">در حال بازیابی گفتگوها…</div>
        ) : !activeConversation?.messages.length ? (
          <EmptyState onPrompt={(prompt) => void sendMessage(prompt)} />
        ) : (
          <MessageList
            messages={activeConversation.messages}
            status={status}
            onSourceOpen={openSource}
            onRetry={retryMessage}
            scrollToLatestSignal={scrollToLatestSignal}
          />
        )}

        <ChatComposer
          disabled={sending}
          onSubmit={(message, attachments) => void sendMessage(message, attachments)}
          onStop={() => abortRef.current?.abort()}
        />
      </section>

      <SourcePanel
        open={sourcePanelOpen}
        sources={activeSources}
        selected={selectedSource}
        onSelect={setSelectedSource}
        onClose={() => setSourcePanelOpen(false)}
      />
      <QualityPanel open={qualityOpen} onClose={() => setQualityOpen(false)} />
    </main>
  );
}
