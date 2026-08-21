"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Conversation } from "@/modules/chat/types";
import type { WorkspaceUser } from "@/modules/chat/types";
import { Check, Download, Ellipsis, LoaderCircle, LogOut, MessageSquareText, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ConversationSidebarProps {
  open: boolean;
  conversations: Conversation[];
  activeId?: string;
  pendingConversationIds: ReadonlySet<string>;
  onClose: () => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onExport: (conversation: Conversation) => void;
  user: WorkspaceUser;
  onLogout: () => void;
  accountActionLabel?: string;
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
  pendingConversationIds,
  onClose,
  onNew,
  onSelect,
  onRemove,
  onRename,
  onExport,
  user,
  onLogout,
  accountActionLabel = "خروج از حساب",
}: ConversationSidebarProps) {
  const [renamingId, setRenamingId] = useState<string>();
  const [draftTitle, setDraftTitle] = useState("");
  const [query, setQuery] = useState("");
  const [overlayMode, setOverlayMode] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Conversation>();
  const actionTriggerRef = useRef<HTMLButtonElement | null>(null);

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
    const query = window.matchMedia("(max-width: 840px)");
    const update = () => setOverlayMode(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return (
    <>
      {open && <button className="sidebar-scrim" onClick={onClose} aria-label="بستن تاریخچه" />}
      <aside
        className={`conversation-sidebar ${open ? "is-open" : ""}`}
        aria-label="تاریخچه گفتگوها"
        aria-hidden={overlayMode && !open}
        inert={overlayMode && !open}
      >
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

        <button className="new-chat-button" onClick={onNew} aria-keyshortcuts="Alt+N">
          <Plus size={18} />
          گفتگوی جدید
          <kbd>Alt N</kbd>
        </button>

        <div className="conversation-search">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="جستجو در گفتگوها" aria-label="جستجو در گفتگوها" />
          {query && <button onClick={() => setQuery("")} aria-label="پاک‌کردن جستجو"><X size={14} /></button>}
        </div>

        <div className="sidebar-section-label">
          <span>گفتگوها</span>
        </div>

        <nav className="conversation-list" aria-label="فهرست گفتگوهای ذخیره‌شده">
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
                  <button
                    className="conversation-select"
                    onClick={() => onSelect(conversation.id)}
                    aria-current={activeId === conversation.id ? "page" : undefined}
                    aria-label={conversation.title}
                  >
                    <span className="conversation-title">
                      {pendingConversationIds.has(conversation.id) && (
                        <span
                          className="conversation-progress"
                          role="status"
                          aria-label={`گفتگوی «${conversation.title}» در حال دریافت پاسخ است`}
                          title="در حال دریافت پاسخ"
                        >
                          <LoaderCircle size={13} aria-hidden="true" />
                        </span>
                      )}
                      <span className="conversation-title-text">{conversation.title}</span>
                    </span>
                    <small>{relativeDate(conversation.updatedAt)}</small>
                  </button>
                )}
                <div className="conversation-actions">
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="conversation-menu-trigger"
                        aria-label={`گزینه‌های گفتگوی ${conversation.title}`}
                        title="گزینه‌های گفتگو"
                        onFocus={(event) => { actionTriggerRef.current = event.currentTarget; }}
                        onPointerDown={(event) => { actionTriggerRef.current = event.currentTarget; }}
                      >
                        <Ellipsis size={17} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" sideOffset={6} className="w-44 p-1.5 font-sans">
                      <DropdownMenuItem
                        className="px-2.5 py-2 text-xs"
                        onSelect={() => {
                          setDraftTitle(conversation.title);
                          setRenamingId(conversation.id);
                        }}
                      >
                        <Pencil />
                        تغییر نام
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="px-2.5 py-2 text-xs"
                        disabled={conversation.messages.length === 0}
                        onSelect={() => onExport(conversation)}
                      >
                        <Download />
                        دریافت خروجی
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        className="px-2.5 py-2 text-xs"
                        onSelect={() => setPendingDelete(conversation)}
                      >
                        <Trash2 />
                        حذف گفتگو
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))
          )}
        </nav>

        <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => { if (!open) setPendingDelete(undefined); }}>
          <AlertDialogContent
            className="w-[calc(100%-2rem)] border border-border shadow-2xl"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              window.requestAnimationFrame(() => actionTriggerRef.current?.focus());
            }}
          >
            <AlertDialogHeader>
              <AlertDialogMedia className="bg-destructive/10 text-destructive ring-1 ring-destructive/15">
                <Trash2 aria-hidden="true" />
              </AlertDialogMedia>
              <AlertDialogTitle>حذف گفتگو؟</AlertDialogTitle>
              <AlertDialogDescription>
                گفتگوی «{pendingDelete?.title}» برای همیشه از این دستگاه پاک می‌شود و امکان بازگرداندن آن وجود ندارد.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>انصراف</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                className="bg-destructive font-semibold text-white hover:bg-destructive/90"
                onClick={() => { if (pendingDelete) onRemove(pendingDelete.id); }}
              >
                <Trash2 aria-hidden="true" />
                حذف گفتگو
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div className="sidebar-footer">
          <div className="sidebar-account">
            <span className="sidebar-account-avatar" aria-hidden="true">{user.name.trim().charAt(0) || "ک"}</span>
            <div className="sidebar-account-copy">
              <strong>{user.name}</strong>
              <small dir="ltr">{user.email}</small>
            </div>
            <button className="sidebar-account-logout" type="button" onClick={onLogout} aria-label={accountActionLabel} title={accountActionLabel}>
              <LogOut size={17} aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
