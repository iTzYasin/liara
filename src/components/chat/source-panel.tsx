"use client";

import { useEffect } from "react";
import type { SourceDocument } from "@/modules/chat/types";
import { ArrowUpLeft, BookOpenText, ExternalLink, Layers3, X } from "lucide-react";

interface SourcePanelProps {
  open: boolean;
  sources: SourceDocument[];
  selected?: SourceDocument;
  onSelect: (source: SourceDocument) => void;
  onClose: () => void;
}

const serviceNames: Record<string, string> = {
  paas: "پلتفرم ابری",
  dbaas: "دیتابیس",
  iaas: "سرور ابری",
  ai: "هوش مصنوعی",
  "one-click-apps": "برنامه‌های آماده",
  "email-server": "ایمیل",
  "object-storage": "فضای ذخیره‌سازی",
  "dns-management-system": "DNS",
  references: "راهنمای عمومی",
};

export function SourcePanel({ open, sources, selected, onSelect, onClose }: SourcePanelProps) {
  useEffect(() => {
    if (open && !selected && sources[0]) onSelect(sources[0]);
  }, [onSelect, open, selected, sources]);

  const active = selected ?? sources[0];
  return (
    <>
      {open && <button className="source-scrim" onClick={onClose} aria-label="بستن منابع" />}
      <aside className={`source-panel ${open ? "is-open" : ""}`} aria-label="منابع پاسخ">
        <header className="source-panel-header">
          <div>
            <BookOpenText size={18} />
            <strong>ردپای پاسخ</strong>
            <span>{sources.length.toLocaleString("fa-IR")} منبع</span>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="بستن پنل منابع"><X size={18} /></button>
        </header>

        {active ? (
          <div className="source-panel-content">
            <section className="source-preview">
              <div className="source-breadcrumb">
                <Layers3 size={14} />
                {serviceNames[active.service] ?? active.service}
                <ArrowUpLeft size={12} />
                {active.heading}
              </div>
              <span className="source-index">منبع {active.citationIndex.toLocaleString("fa-IR")}</span>
              <h2>{active.title}</h2>
              <p>{active.snippet.slice(0, 520)}{active.snippet.length > 520 ? "…" : ""}</p>
              <a href={active.url} target="_blank" rel="noreferrer" className="open-doc-link">
                بازکردن همین بخش در داک لیارا
                <ExternalLink size={15} />
              </a>
            </section>

            <div className="source-list-label">منابع این گفتگو</div>
            <div className="source-list">
              {sources.map((source) => (
                <button
                  key={source.id}
                  className={active.id === source.id ? "is-active" : ""}
                  onClick={() => onSelect(source)}
                >
                  <span className="source-list-index">{source.citationIndex.toLocaleString("fa-IR")}</span>
                  <span>
                    <strong>{source.title}</strong>
                    <small>{source.heading}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="source-panel-empty">
            <BookOpenText size={26} />
            <strong>هنوز منبعی استفاده نشده است</strong>
            <span>بعد از اولین پاسخ مستند، صفحات مرتبط اینجا دیده می‌شوند.</span>
          </div>
        )}
      </aside>
    </>
  );
}
