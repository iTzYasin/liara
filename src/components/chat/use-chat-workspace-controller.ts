"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { summarizeConversationHistory } from "@/modules/agent/context-manager";
import {
  ChatRateLimitError,
  consumeChatStream,
} from "@/modules/chat/chat-client";
import type {
  ChatAttachment,
  Conversation,
  SourceDocument,
  StoredMessage,
} from "@/modules/chat/types";
import { getConversationStore } from "@/modules/conversations/conversation-store";
import { redactSensitiveText } from "@/modules/security/secret-redactor";

function now() {
  return new Date().toISOString();
}

function limitStorageKey(userId: string) {
  return `liara-assistant-limit:${userId}`;
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

interface ChatWorkspaceControllerOptions {
  userId: string;
  startOnNewConversation: boolean;
}

export function useChatWorkspaceController({
  userId,
  startOnNewConversation,
}: ChatWorkspaceControllerOptions) {
  const store = useMemo(() => getConversationStore(userId), [userId]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<Conversation>();
  const [selectedSource, setSelectedSource] = useState<SourceDocument>();
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [conversationStatuses, setConversationStatuses] = useState<Record<string, string>>({});
  const [pendingConversationIds, setPendingConversationIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [scrollToLatestSignal, setScrollToLatestSignal] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [dark, setDark] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<number>();
  const [limitClock, setLimitClock] = useState(() => Date.now());
  const controllersRef = useRef(new Map<string, AbortController>());
  const removedConversationIdsRef = useRef(new Set<string>());
  const sourceToggleRef = useRef<HTMLButtonElement>(null);
  const visibleConversationIdRef = useRef<string | null>(null);

  useEffect(() => () => {
    controllersRef.current.forEach((controller) => controller.abort());
    controllersRef.current.clear();
  }, []);

  const applyChatLock = useCallback((until: number) => {
    if (!Number.isFinite(until) || until <= Date.now()) return;
    setLockedUntil(until);
    localStorage.setItem(limitStorageKey(userId), String(until));
  }, [userId]);

  useEffect(() => {
    const stored = Number(localStorage.getItem(limitStorageKey(userId)));
    if (Number.isFinite(stored) && stored > Date.now()) setLockedUntil(stored);
    else localStorage.removeItem(limitStorageKey(userId));
  }, [userId]);

  useEffect(() => {
    if (!lockedUntil) return;
    const tick = () => {
      const current = Date.now();
      setLimitClock(current);
      if (current >= lockedUntil) {
        setLockedUntil(undefined);
        localStorage.removeItem(limitStorageKey(userId));
      }
    };
    tick();
    const interval = window.setInterval(tick, 1_000);
    return () => window.clearInterval(interval);
  }, [lockedUntil, userId]);

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
        const initialConversation = startOnNewConversation ? undefined : items[0];
        setActiveConversation(initialConversation);
        visibleConversationIdRef.current = initialConversation?.id ?? null;
      }
      setHydrated(true);
    })();
  }, [startOnNewConversation, store]);

  useEffect(() => {
    const saved = localStorage.getItem("liara-assistant-theme");
    const shouldUseDark = saved
      ? saved === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = shouldUseDark ? "dark" : "light";
    const frame = window.requestAnimationFrame(() => setDark(shouldUseDark));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const toggleTheme = useCallback(() => {
    setDark((current) => {
      const next = !current;
      document.documentElement.dataset.theme = next ? "dark" : "light";
      localStorage.setItem("liara-assistant-theme", next ? "dark" : "light");
      return next;
    });
  }, []);

  const persist = useCallback(
    (conversation: Conversation) => {
      if (removedConversationIdsRef.current.has(conversation.id)) return;
      if (visibleConversationIdRef.current === conversation.id) setActiveConversation(conversation);
      void store.save(conversation).then(refreshList);
    },
    [refreshList, store],
  );

  const newConversation = useCallback(() => {
    visibleConversationIdRef.current = null;
    setActiveConversation(undefined);
    setSelectedSource(undefined);
    setSourcePanelOpen(false);
    setSidebarOpen(false);
  }, []);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === "KeyN") {
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
      setSelectedSource(undefined);
      setSourcePanelOpen(false);
      setSidebarOpen(false);
    },
    [store],
  );

  const removeConversation = useCallback(
    async (id: string) => {
      removedConversationIdsRef.current.add(id);
      controllersRef.current.get(id)?.abort();
      await store.remove(id);
      if (activeConversation?.id === id) {
        visibleConversationIdRef.current = null;
        setActiveConversation(undefined);
        setSelectedSource(undefined);
        setSourcePanelOpen(false);
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
      if (
        (lockedUntil && lockedUntil > Date.now())
        || (activeConversation?.id && controllersRef.current.has(activeConversation.id))
        || (!rawMessage.trim() && !attachments.length)
      ) return;
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
      const controller = new AbortController();
      controllersRef.current.set(current.id, controller);
      removedConversationIdsRef.current.delete(current.id);
      setPendingConversationIds((ids) => {
        const next = new Set(ids);
        next.add(current.id);
        return next;
      });
      visibleConversationIdRef.current = current.id;
      persist(current);
      let lastCheckpointAt = Date.now();
      setScrollToLatestSignal((value) => value + 1);
      setSelectedSource(undefined);
      setSourcePanelOpen(false);
      setConversationStatuses((statuses) => ({
        ...statuses,
        [current.id]: redactionCount
          ? `${redactionCount} مورد حساس ماسک شد`
          : "در حال دریافت پیام",
      }));
      try {
        const priorMessages = retryUserIndex >= 0
          ? base.messages.slice(0, retryUserIndex)
          : base.messages;
        await consumeChatStream(
          {
            message: messageResult.text,
            conversationId: current.id,
            contextSummary: summarizeConversationHistory(
              priorMessages.slice(0, -12).map((message) => ({
                role: message.role,
                content: message.content,
              })),
            ),
            workflowState: base.agentState,
            history: priorMessages.slice(-12).map((message) => ({
              role: message.role,
              content: message.content,
            })),
            attachments: attachmentResult.safe,
          },
          (event) => {
            if (event.type === "status") {
              setConversationStatuses((statuses) => ({
                ...statuses,
                [current.id]: event.message,
              }));
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
              if (Date.now() - lastCheckpointAt >= 750) {
                lastCheckpointAt = Date.now();
                if (!removedConversationIdsRef.current.has(current.id)) {
                  void store.save(current);
                }
              }
              return;
            }
            if (event.type === "quota") {
              const reset = Date.parse(event.resetsAt);
              if (event.remaining === 0 && Number.isFinite(reset)) applyChatLock(reset);
              return;
            }
            if (event.type === "ticket") {
              current = updateMessage(current, assistantId, (message) => ({
                ...message,
                ticket: { draft: event.draft, status: "ready" },
              }));
              return;
            }
            if (event.type === "workflow") {
              current = updateMessage(
                { ...current, agentState: event.state },
                assistantId,
                (message) => ({ ...message, workflow: event.state }),
              );
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
        if (error instanceof ChatRateLimitError) applyChatLock(error.lockedUntil);
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
        if (controllersRef.current.get(current.id) === controller) {
          controllersRef.current.delete(current.id);
          setPendingConversationIds((ids) => {
            const next = new Set(ids);
            next.delete(current.id);
            return next;
          });
          setConversationStatuses((statuses) => {
            const next = { ...statuses };
            delete next[current.id];
            return next;
          });
        }
      }
    },
    [activeConversation, applyChatLock, lockedUntil, persist, store, updateMessage],
  );

  const retryMessage = useCallback(
    (assistantId: string) => {
      if (!activeConversation || controllersRef.current.has(activeConversation.id)) return;
      const assistantIndex = activeConversation.messages.findIndex((message) => message.id === assistantId);
      const userMessage = assistantIndex > 0 ? activeConversation.messages[assistantIndex - 1] : undefined;
      if (userMessage?.role !== "user") return;
      void sendMessage(userMessage.content, [], assistantId);
    },
    [activeConversation, sendMessage],
  );

  const activeConversationId = activeConversation?.id;
  const activeConversationPending = Boolean(
    activeConversationId && pendingConversationIds.has(activeConversationId),
  );
  const activeStatus = activeConversationId
    ? conversationStatuses[activeConversationId]
    : undefined;
  const activeSources = useMemo(() => {
    const sources = activeConversation?.messages.flatMap((message) => message.sources ?? []) ?? [];
    return sources.filter(
      (source, index, items) => items.findIndex((item) => item.id === source.id) === index,
    );
  }, [activeConversation]);

  const closeSourcePanel = useCallback(() => {
    setSourcePanelOpen(false);
    window.requestAnimationFrame(() => sourceToggleRef.current?.focus());
  }, []);

  const openSourcePanel = useCallback((source: SourceDocument) => {
    setSelectedSource(source);
    setSourcePanelOpen(true);
  }, []);

  const stopActiveResponse = useCallback(() => {
    if (activeConversationId) controllersRef.current.get(activeConversationId)?.abort();
  }, [activeConversationId]);

  return {
    conversation: {
      items: conversations,
      active: activeConversation,
      pendingIds: pendingConversationIds,
      activePending: activeConversationPending,
      activeStatus,
      hydrated,
      scrollToLatestSignal,
      newConversation,
      selectConversation,
      removeConversation,
      renameConversation,
      retryMessage,
      sendMessage,
      stopActiveResponse,
    },
    sidebar: {
      open: sidebarOpen,
      setOpen: setSidebarOpen,
    },
    sources: {
      items: activeSources,
      selected: selectedSource,
      setSelected: setSelectedSource,
      panelOpen: sourcePanelOpen,
      setPanelOpen: setSourcePanelOpen,
      openPanel: openSourcePanel,
      closePanel: closeSourcePanel,
    },
    sourceToggleRef,
    theme: {
      dark,
      toggle: toggleTheme,
    },
    lockRemainingSeconds: lockedUntil && lockedUntil > limitClock
      ? Math.ceil((lockedUntil - limitClock) / 1_000)
      : undefined,
  };
}
