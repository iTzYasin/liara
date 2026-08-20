"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SourceDocument, StoredMessage } from "@/modules/chat/types";
import { AssistantMessage } from "@/components/chat/assistant-message";
import { ArrowDown, FileText, ShieldCheck } from "lucide-react";

interface MessageListProps {
  messages: StoredMessage[];
  status?: string;
  onSourceOpen: (source: SourceDocument) => void;
  onRetry: (messageId: string) => void;
  scrollToLatestSignal: number;
}

export function MessageList({ messages, status, onSourceOpen, onRetry, scrollToLatestSignal }: MessageListProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const [nearBottom, setNearBottom] = useState(true);
  const lastContent = messages.at(-1)?.content;

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const element = viewport.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior });
    setNearBottom(true);
  }, []);

  useEffect(() => {
    if (nearBottom) scrollToBottom(lastContent ? "auto" : "smooth");
  }, [lastContent, messages.length, nearBottom, scrollToBottom]);

  useEffect(() => {
    if (scrollToLatestSignal > 0) scrollToBottom("auto");
  }, [scrollToLatestSignal, scrollToBottom]);

  return (
    <div
      className="message-viewport"
      ref={viewport}
      onScroll={(event) => {
        const element = event.currentTarget;
        setNearBottom(element.scrollHeight - element.scrollTop - element.clientHeight < 140);
      }}
    >
      <div className="message-thread">
        {messages.map((message, index) => {
          if (message.role === "user") {
            return (
              <article className="user-turn" key={message.id}>
                <div className="user-bubble">{message.content}</div>
                {message.attachments && message.attachments.length > 0 && (
                  <div className="user-attachments">
                    {message.attachments.map((attachment) => (
                      <span key={attachment.id}><FileText size={14} />{attachment.name}</span>
                    ))}
                  </div>
                )}
                {Boolean(message.meta?.redactionCount) && (
                  <div className="redaction-note">
                    <ShieldCheck size={14} />
                    {message.meta?.redactionCount?.toLocaleString("fa-IR")} مورد حساس پیش از ارسال ماسک شد
                  </div>
                )}
              </article>
            );
          }
          const isLast = index === messages.length - 1;
          return (
            <AssistantMessage
              key={message.id}
              message={message}
              status={isLast ? status : undefined}
              onSourceOpen={onSourceOpen}
              onRetry={onRetry}
            />
          );
        })}
      </div>

      {!nearBottom && (
        <button className="jump-to-latest" onClick={() => scrollToBottom()}>
          <ArrowDown size={16} />
          رفتن به جدیدترین پیام
        </button>
      )}
    </div>
  );
}
