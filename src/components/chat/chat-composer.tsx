"use client";

import { ChangeEvent, DragEvent, KeyboardEvent, useRef, useState } from "react";
import type { ChatAttachment, AttachmentKind } from "@/modules/chat/types";
import { redactSensitiveText } from "@/modules/security/secret-redactor";
import { FileCode2, FileText, Image as ImageIcon, Paperclip, Send, ShieldCheck, Square, X } from "lucide-react";

interface ChatComposerProps {
  disabled: boolean;
  onSubmit: (message: string, attachments: ChatAttachment[]) => void;
  onStop: () => void;
}

const maxFiles = 3;
const maxTotalBytes = 10 * 1024 * 1024;
const textExtensions = new Set([
  "txt", "log", "md", "json", "yaml", "yml", "env", "toml", "ini", "conf", "js", "jsx", "ts", "tsx",
  "py", "php", "go", "java", "cs", "rb", "sh", "dockerfile",
]);

function extension(name: string) {
  return name.toLowerCase().split(".").pop() ?? "";
}

function kindFor(file: File): AttachmentKind | undefined {
  if (file.type.startsWith("image/")) return "image";
  if (file.type === "application/pdf") return "pdf";
  if (file.type.startsWith("text/") || textExtensions.has(extension(file.name))) return "text";
  return undefined;
}

function readDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function ChatComposer({ disabled, onSubmit, onStop }: ChatComposerProps) {
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [notice, setNotice] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const addFiles = async (files: File[]) => {
    setNotice(undefined);
    const remaining = maxFiles - attachments.length;
    if (remaining <= 0) {
      setNotice("حداکثر سه فایل برای هر پیام قابل افزودن است.");
      return;
    }
    const selected = files.slice(0, remaining);
    const currentBytes = attachments.reduce((sum, item) => sum + item.size, 0);
    if (currentBytes + selected.reduce((sum, file) => sum + file.size, 0) > maxTotalBytes) {
      setNotice("مجموع حجم فایل‌ها باید کمتر از ۱۰ مگابایت باشد.");
      return;
    }

    const next: ChatAttachment[] = [];
    let redactions = 0;
    for (const file of selected) {
      const kind = kindFor(file);
      if (!kind) {
        setNotice(`نوع فایل «${file.name}» پشتیبانی نمی‌شود.`);
        continue;
      }
      if (kind === "text") {
        const result = redactSensitiveText(await file.text());
        redactions += result.count;
        next.push({
          id: crypto.randomUUID(),
          name: file.name,
          mimeType: file.type || "text/plain",
          size: file.size,
          kind,
          content: result.text,
          redactionCount: result.count,
        });
      } else {
        next.push({
          id: crypto.randomUUID(),
          name: file.name,
          mimeType: file.type,
          size: file.size,
          kind,
          content: await readDataUrl(file),
        });
      }
    }
    setAttachments((items) => [...items, ...next]);
    if (redactions) setNotice(`${redactions.toLocaleString("fa-IR")} مورد حساس داخل فایل ماسک شد.`);
    else if (next.some((item) => item.kind !== "text")) {
      setNotice("متن داخل تصویر و PDF خودکار ماسک نمی‌شود؛ پیش از ارسال اطلاعات حساس را حذف کنید.");
    }
  };

  const submit = () => {
    if (disabled || (!message.trim() && !attachments.length)) return;
    onSubmit(message, attachments);
    setMessage("");
    setAttachments([]);
    setNotice(undefined);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    void addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void addFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <div className="composer-dock">
      <div
        className={`composer ${dragging ? "is-dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {attachments.length > 0 && (
          <div className="attachment-list">
            {attachments.map((attachment) => {
              const Icon = attachment.kind === "image" ? ImageIcon : attachment.kind === "pdf" ? FileText : FileCode2;
              return (
                <div className="attachment-chip" key={attachment.id}>
                  <Icon size={16} />
                  <span>{attachment.name}</span>
                  {Boolean(attachment.redactionCount) && <ShieldCheck size={14} className="safe-icon" />}
                  <button
                    onClick={() => setAttachments((items) => items.filter((item) => item.id !== attachment.id))}
                    aria-label={`حذف ${attachment.name}`}
                  >
                    <X size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="سؤال، خطا یا کاری که می‌خواهی انجام دهی را بنویس…"
          aria-label="پیام به دستیار لیارا"
        />

        <div className="composer-actions">
          <div className="composer-tools">
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              accept="text/*,.log,.md,.json,.yaml,.yml,.env,.toml,.ini,.conf,.js,.jsx,.ts,.tsx,.py,.php,.go,.java,.cs,.rb,.sh,.pdf,image/png,image/jpeg,image/webp"
              onChange={onFileChange}
            />
            <button className="attach-button" onClick={() => fileInput.current?.click()} title="افزودن فایل">
              <Paperclip size={18} />
              <span>فایل</span>
            </button>
            <span className="composer-hint">Enter برای ارسال · Shift+Enter خط جدید</span>
          </div>
          {disabled ? (
            <button className="send-button stop" onClick={onStop} aria-label="توقف پاسخ">
              <Square size={15} fill="currentColor" />
            </button>
          ) : (
            <button
              className="send-button"
              onClick={submit}
              disabled={!message.trim() && !attachments.length}
              aria-label="ارسال پیام"
            >
              <Send size={17} />
            </button>
          )}
        </div>
        {dragging && <div className="drop-overlay">فایل را همین‌جا رها کن</div>}
      </div>
      <div className="composer-meta">
        {notice ? <span className="composer-notice"><ShieldCheck size={13} />{notice}</span> : <span>پاسخ‌ها ممکن است خطا داشته باشند؛ منبع را بررسی کنید.</span>}
      </div>
    </div>
  );
}
