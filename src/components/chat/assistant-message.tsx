"use client";

import { Children, isValidElement, ReactNode, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { SourceDocument, StoredMessage } from "@/modules/chat/types";
import { Check, Clipboard, ExternalLink, FileSearch, RotateCcw, ThumbsDown, ThumbsUp } from "lucide-react";
import type { FeedbackReason } from "@/modules/observability/metrics";

interface AssistantMessageProps {
  message: StoredMessage;
  status?: string;
  onSourceOpen: (source: SourceDocument) => void;
  onRetry: (messageId: string) => void;
}

function withCitationLinks(content: string, sources: SourceDocument[]) {
  return content.replace(/\[\[(\d+)\]\]/g, (_match, rawIndex: string) => {
    const index = Number(rawIndex);
    const source = sources.find((item) => item.citationIndex === index);
    return source ? `[${index}](${source.url})` : "";
  });
}

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
  return "";
}

function CodeFrame({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = nodeText(children).replace(/\n$/, "");
  return (
    <div className="code-frame" dir="ltr">
      <div className="code-toolbar">
        <span>کد</span>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1_500);
          }}
        >
          {copied ? <Check size={14} /> : <Clipboard size={14} />}
          {copied ? "کپی شد" : "کپی"}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

function confidenceCopy(confidence?: string) {
  if (confidence === "high") return "شواهد مستند قوی";
  if (confidence === "medium") return "پاسخ با فرض محدود";
  if (confidence === "low") return "شواهد ناکافی";
  return undefined;
}

export function AssistantMessage({ message, status, onSourceOpen, onRetry }: AssistantMessageProps) {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<"up" | "down">();
  const [feedbackReasonOpen, setFeedbackReasonOpen] = useState(false);
  const sources = message.sources ?? [];
  const content = withCitationLinks(message.content, sources);

  const sendFeedback = (rating: "up" | "down", reason?: FeedbackReason) => {
    setFeedback(rating);
    setFeedbackReasonOpen(false);
    if (!message.meta?.requestId) return;
    void fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: message.meta.requestId, rating, reason }),
    });
  };

  return (
    <article className={`assistant-turn ${message.status === "error" ? "has-error" : ""}`}>
      <div className="evidence-spine" aria-hidden="true">
        <span>{sources.length ? sources.length.toLocaleString("fa-IR") : "•"}</span>
      </div>

      <div className="assistant-body">
        <div className="assistant-kicker">
          <span className="assistant-mark">L</span>
          <strong>دستیار لیارا</strong>
          {confidenceCopy(message.meta?.confidence) && (
            <small>{confidenceCopy(message.meta?.confidence)}</small>
          )}
        </div>

        {message.content ? (
          <div className="markdown-body">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                pre: ({ children }) => <CodeFrame>{children}</CodeFrame>,
                a: ({ href, children }) => {
                  const source = sources.find((item) => item.url === href);
                  if (source) {
                    return (
                      <button className="inline-citation" onClick={() => onSourceOpen(source)} title={source.title}>
                        {children}
                      </button>
                    );
                  }
                  return (
                    <a href={href} target="_blank" rel="noreferrer">
                      {children}<ExternalLink size={13} />
                    </a>
                  );
                },
                code: ({ className, children }) => (
                  <code className={className} dir="ltr">{Children.toArray(children)}</code>
                ),
              }}
            >
              {content}
            </ReactMarkdown>
            {message.status === "streaming" && <span className="stream-caret" aria-label="در حال نوشتن" />}
          </div>
        ) : (
          <div className="answer-skeleton">
            <i /><i /><i />
          </div>
        )}

        {status && message.status === "streaming" && (
          <div className="agent-status">
            <span className="status-pulse" />
            {status}
          </div>
        )}

        {sources.length > 0 && message.status !== "streaming" && (
          <div className="message-sources">
            <div className="message-sources-title"><FileSearch size={16} />منابع استفاده‌شده</div>
            <div className="source-chip-row">
              {sources.slice(0, 4).map((source) => (
                <button key={source.id} onClick={() => onSourceOpen(source)}>
                  <span>{source.citationIndex.toLocaleString("fa-IR")}</span>
                  <span>{source.title}</span>
                </button>
              ))}
              {sources.length > 4 && <span className="more-sources">+{(sources.length - 4).toLocaleString("fa-IR")}</span>}
            </div>
          </div>
        )}

        {message.status !== "streaming" && (
          <div className="message-actions">
            <button
              onClick={() => {
                void navigator.clipboard.writeText(message.content);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1_500);
              }}
              title="کپی پاسخ"
            >
              {copied ? <Check size={15} /> : <Clipboard size={15} />}
            </button>
            <button className={feedback === "up" ? "is-selected" : ""} onClick={() => sendFeedback("up")} title="پاسخ مفید بود">
              <ThumbsUp size={15} />
            </button>
            <button
              className={feedback === "down" ? "is-selected" : ""}
              onClick={() => {
                setFeedback("down");
                setFeedbackReasonOpen(true);
              }}
              title="پاسخ مفید نبود"
            >
              <ThumbsDown size={15} />
            </button>
            {message.status === "error" && (
              <button title="تلاش مجدد" onClick={() => onRetry(message.id)}>
                <RotateCcw size={15} />
              </button>
            )}
          </div>
        )}
        {feedbackReasonOpen && (
          <div className="feedback-reasons" role="group" aria-label="دلیل مفید نبودن پاسخ">
            <span>کدام بخش نیاز به بهبود داشت؟</span>
            <button onClick={() => sendFeedback("down", "incomplete")}>پاسخ ناقص بود</button>
            <button onClick={() => sendFeedback("down", "irrelevant-source")}>منبع مرتبط نبود</button>
            <button onClick={() => sendFeedback("down", "not-resolved")}>مشکل حل نشد</button>
            <button onClick={() => sendFeedback("down", "unclear")}>توضیح روشن نبود</button>
            <button onClick={() => sendFeedback("down", "no-reason")}>بدون توضیح</button>
          </div>
        )}
      </div>
    </article>
  );
}
