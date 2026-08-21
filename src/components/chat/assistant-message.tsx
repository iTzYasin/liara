"use client";

import { Children, isValidElement, ReactNode, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { SourceDocument, StoredMessage } from "@/modules/chat/types";
import {
  Check,
  Clipboard,
  ExternalLink,
  FileSearch,
  RotateCcw,
  Send,
  Ticket,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import type { FeedbackReason } from "@/modules/observability/metrics";
import { SourceReference } from "@/components/chat/source-reference";
import { useStreamingReveal } from "@/components/chat/use-streaming-reveal";

interface AssistantMessageProps {
  message: StoredMessage;
  status?: string;
  onRetry: (messageId: string) => void;
  onOpenSources?: (source: SourceDocument) => void;
  sourcePanelOpen?: boolean;
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

function confidenceCopy(confidence: string | undefined, intent: string | undefined, sourceCount: number) {
  if (intent === "social" || intent === "out-of-scope") return undefined;
  if (confidence === "high" && sourceCount === 0) return undefined;
  if (confidence === "high") return "شواهد مستند قوی";
  if (confidence === "medium") return "پاسخ با فرض محدود";
  if (confidence === "low") return "شواهد ناکافی";
  return undefined;
}

function TicketDraftCard({ message }: { message: StoredMessage }) {
  const [copied, setCopied] = useState(false);
  const ticket = message.ticket;
  if (!ticket) return null;
  const integrationNoteId = `ticket-integration-${message.id}`;

  return (
    <section className="ticket-draft" aria-label="پیش‌نویس تیکت پشتیبانی">
      <div className="ticket-draft-heading">
        <span><Ticket size={17} aria-hidden="true" /></span>
        <div>
          <strong>پیش‌نویس تیکت آماده است</strong>
          <small>موضوع و متن براساس همین گفتگو آماده شده است.</small>
        </div>
      </div>
      <div className="ticket-draft-content">
        <span>موضوع</span>
        <strong>{ticket.draft.subject}</strong>
        <span>متن تیکت</span>
        <p>{ticket.draft.body}</p>
      </div>
      <div className="ticket-draft-actions">
        <button
          type="button"
          className="ticket-copy"
          onClick={() => {
            void navigator.clipboard.writeText(`${ticket.draft.subject}\n\n${ticket.draft.body}`);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1_500);
          }}
        >
          {copied ? <Check size={15} /> : <Clipboard size={15} />}
          {copied ? "کپی شد" : "کپی تیکت"}
        </button>
        <button
          type="button"
          className="ticket-submit"
          disabled
          aria-describedby={integrationNoteId}
        >
          <Send size={16} />
          ارسال تیکت
        </button>
      </div>
      <div className="ticket-state is-pending" id={integrationNoteId} role="note">
        <span>
          اتصال دکمه به سامانه تیکت در مرحله بعد انجام می‌شود؛ فعلاً هیچ درخواستی ارسال نمی‌شود.
        </span>
      </div>
    </section>
  );
}

export function AssistantMessage({
  message,
  status,
  onRetry,
  onOpenSources,
  sourcePanelOpen = false,
}: AssistantMessageProps) {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<"up" | "down">();
  const [feedbackReasonOpen, setFeedbackReasonOpen] = useState(false);
  const sources = message.sources ?? [];
  const confidenceLabel = confidenceCopy(
    message.meta?.confidence,
    message.meta?.intent,
    sources.length,
  );
  const { visibleText, isRevealing } = useStreamingReveal(
    message.content,
    message.status === "streaming",
  );
  const content = withCitationLinks(visibleText, sources);

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
    <article
      className={`assistant-turn ${message.status === "error" ? "has-error" : ""}`}
      role={message.status === "error" ? "alert" : undefined}
    >
      <div className="evidence-spine" aria-hidden="true">
        <span>{sources.length ? sources.length.toLocaleString("fa-IR") : "•"}</span>
      </div>

      <div className="assistant-body">
        <div className="assistant-kicker">
          <span className="assistant-mark">L</span>
          <strong>دستیار لیارا</strong>
          {confidenceLabel && <small>{confidenceLabel}</small>}
        </div>

        {message.content ? (
          <div className="markdown-body" dir="auto" aria-busy={isRevealing}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                pre: ({ children }) => <CodeFrame>{children}</CodeFrame>,
                a: ({ href, children }) => {
                  const source = sources.find((item) => item.url === href);
                  if (source) {
                    return (
                      <SourceReference source={source}>
                        <button
                          type="button"
                          className="inline-citation"
                          aria-label={`مشاهده منبع ${source.citationIndex.toLocaleString("fa-IR")}: ${source.title}`}
                        >
                          {children}
                        </button>
                      </SourceReference>
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
            {isRevealing && <span className="stream-caret" aria-hidden="true" />}
          </div>
        ) : (
          <div className="answer-skeleton">
            <i /><i /><i />
          </div>
        )}

        {status && message.status === "streaming" && (
          <div className="agent-status">
            <span className="status-pulse" aria-hidden="true" />
            {status}
          </div>
        )}

        <span className="sr-only" role="status" aria-live="polite">
          {isRevealing ? "دستیار در حال نوشتن پاسخ است" : ""}
        </span>

        {sources.length > 0 && !isRevealing && (
          <div className="message-sources">
            <div className="message-sources-title"><FileSearch size={16} />منابع استفاده‌شده</div>
            <div className="source-chip-row">
              {sources.slice(0, 4).map((source) => (
                <SourceReference source={source} key={source.id}>
                  <button
                    type="button"
                    aria-label={`مشاهده منبع ${source.citationIndex.toLocaleString("fa-IR")}: ${source.title}`}
                  >
                    <span>{source.citationIndex.toLocaleString("fa-IR")}</span>
                    <span>{source.title}</span>
                  </button>
                </SourceReference>
              ))}
              {sources.length > 4 && (
                <button
                  type="button"
                  className="more-sources"
                  aria-label={`مشاهده هر ${sources.length.toLocaleString("fa-IR")} منبع در پنل منابع`}
                  aria-controls="source-panel"
                  aria-expanded={sourcePanelOpen}
                  onClick={() => onOpenSources?.(sources[4])}
                >
                  +{(sources.length - 4).toLocaleString("fa-IR")}
                </button>
              )}
            </div>
          </div>
        )}

        {!isRevealing && (
      <TicketDraftCard message={message} />
        )}

        {!isRevealing && (
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
