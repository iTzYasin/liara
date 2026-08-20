"use client";

import { useEffect, useMemo, useState } from "react";
import type { Conversation } from "@/modules/chat/types";
import { Activity, BookOpenText, Check, Download, MessageSquareText, Moon, Pencil, Plus, Search, Sun, Trash2, X } from "lucide-react";

interface ConversationSidebarProps {
  open: boolean;
  conversations: Conversation[];
  activeId?: string;
  onClose: () => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onExport: () => void;
  canExport: boolean;
  onOpenQuality: () => void;
}

interface DocsStatus {
  ready: boolean;
  documents: number;
  chunks: number;
  sourceCommit: string;
  generatedAt?: string;
}

function relativeDate(value: string) {
  const timestamp = new Date(value).getTime();
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "همین حالا";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000).toLocaleString("fa-IR")} دقیقه پیش`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000).toLocaleString("fa-IR")} ساعت پیش`;
  return new Intl.DateTimeFormat("fa-IR", { month: "short", day: "numeric" }).format(timestamp);
}

export function ConversationSidebar({
  open,
  conversations,
  activeId,
  onClose,
  onNew,
  onSelect,
  onRemove,
  onRename,
  onExport,
  canExport,
  onOpenQuality,
}: ConversationSidebarProps) {
  const [docs, setDocs] = useState<DocsStatus>();
  const [renamingId, setRenamingId] = useState<string>();
  const [draftTitle, setDraftTitle] = useState("");
  const [query, setQuery] = useState("");
  const [dark, setDark] = useState(false);

  const filteredConversations = useMemo(() => {
    const normalized = query
      .toLowerCase()
      .replace(/[يى]/g, "ی")
      .replace(/ك/g, "ک")
      .replace(/\s+/g, " ")
      .trim();
    if (!normalized) return conversations;
    return conversations.filter((conversation) =>
      `${conversation.title} ${conversation.messages.map((message) => message.content).join(" ")}`
        .toLowerCase()
        .replace(/[يى]/g, "ی")
        .replace(/ك/g, "ک")
        .includes(normalized),
    );
  }, [conversations, query]);

  const commitRename = (id: string) => {
    const title = draftTitle.replace(/\s+/g, " ").trim().slice(0, 64);
    if (title) onRename(id, title);
    setRenamingId(undefined);
  };

  useEffect(() => {
    fetch("/api/docs/status")
      .then((response) => response.json())
      .then(setDocs)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("liara-assistant-theme");
    const shouldUseDark = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = shouldUseDark ? "dark" : "light";
    const frame = window.requestAnimationFrame(() => setDark(shouldUseDark));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    localStorage.setItem("liara-assistant-theme", next ? "dark" : "light");
  };

  return (
    <>
      {open && <button className="sidebar-scrim" onClick={onClose} aria-label="بستن تاریخچه" />}
      <aside className={`conversation-sidebar ${open ? "is-open" : ""}`} aria-label="تاریخچه گفتگوها">
        <div className="brand-lockup">
          {/* SVG محلی و کوچک است؛ بهینه‌سازی تصویری Next برای آن ارزش افزوده‌ای ندارد. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/liara-logo.svg"
            alt="لیارا"
            width={56}
            height={25}
          />
          <div>
            <strong>دستیار لیارا</strong>
            <span>راهنمای مستند سرویس‌ها</span>
          </div>
          <button className="sidebar-close icon-button" onClick={onClose} aria-label="بستن">
            <X size={18} />
          </button>
        </div>

        <button className="new-chat-button" onClick={onNew}>
          <Plus size={18} />
          گفتگوی جدید
          <kbd>Ctrl N</kbd>
        </button>

        <div className="conversation-search">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="جستجو در گفتگوها" aria-label="جستجو در گفتگوها" />
          {query && <button onClick={() => setQuery("")} aria-label="پاک‌کردن جستجو"><X size={14} /></button>}
        </div>

        <div className="sidebar-section-label">
          <span>گفتگوهای این دستگاه</span>
          <span>{filteredConversations.length.toLocaleString("fa-IR")}{query ? ` از ${conversations.length.toLocaleString("fa-IR")}` : ""}</span>
        </div>

        <nav className="conversation-list">
          {filteredConversations.length === 0 ? (
            <div className="conversation-empty">
              <MessageSquareText size={20} />
              <span>{query ? "گفتگویی با این عبارت پیدا نشد." : "اولین سؤال، اینجا ذخیره می‌شود."}</span>
            </div>
          ) : (
            filteredConversations.map((conversation) => (
              <div
                key={conversation.id}
                className={`conversation-row ${activeId === conversation.id ? "is-active" : ""}`}
              >
                {renamingId === conversation.id ? (
                  <form
                    className="conversation-rename"
                    onSubmit={(event) => {
                      event.preventDefault();
                      commitRename(conversation.id);
                    }}
                  >
                    <input
                      autoFocus
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                      onBlur={() => commitRename(conversation.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setRenamingId(undefined);
                      }}
                      aria-label="نام گفتگو"
                    />
                    <button type="submit" aria-label="ذخیره نام"><Check size={14} /></button>
                  </form>
                ) : (
                  <button className="conversation-select" onClick={() => onSelect(conversation.id)}>
                    <span>{conversation.title}</span>
                    <small>{relativeDate(conversation.updatedAt)}</small>
                  </button>
                )}
                <div className="conversation-actions">
                  <button
                    className="conversation-edit"
                    onClick={() => {
                      setDraftTitle(conversation.title);
                      setRenamingId(conversation.id);
                    }}
                    aria-label={`تغییر نام ${conversation.title}`}
                    title="تغییر نام"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className="conversation-delete"
                    onClick={() => {
                      if (window.confirm(`گفتگوی «${conversation.title}» حذف شود؟`)) onRemove(conversation.id);
                    }}
                    aria-label={`حذف ${conversation.title}`}
                    title="حذف گفتگو"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-utility-row">
            <button onClick={onOpenQuality}><Activity size={15} />گزارش کیفیت</button>
            <button onClick={onExport} disabled={!canExport}><Download size={15} />خروجی گفتگو</button>
            <button onClick={toggleTheme} aria-label={dark ? "فعال‌کردن تم روشن" : "فعال‌کردن تم تاریک"} title={dark ? "تم روشن" : "تم تاریک"}>
              {dark ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>
          <div className="index-status">
            <BookOpenText size={17} />
            <div>
              <span>{docs?.ready ? "ایندکس داک آماده است" : "در حال بررسی ایندکس"}</span>
              <small>
                {docs?.documents
                  ? `${docs.documents.toLocaleString("fa-IR")} سند · نسخه ${docs.sourceCommit}`
                  : "منبع: مستندات رسمی لیارا"}
              </small>
            </div>
          </div>
          <p>گفتگوها فقط روی همین دستگاه و پس از پاک‌سازی ذخیره می‌شوند.</p>
        </div>
      </aside>
    </>
  );
}
