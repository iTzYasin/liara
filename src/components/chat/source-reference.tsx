"use client";

import { type ReactElement, useEffect, useState } from "react";
import type { SourceDocument } from "@/modules/chat/types";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ArrowUpLeft, ExternalLink, Layers3, X } from "lucide-react";

interface SourceReferenceProps {
  source: SourceDocument;
  children: ReactElement;
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

function sourceSummary(snippet: string) {
  const plainText = snippet
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[`>#*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return plainText.length > 240 ? `${plainText.slice(0, 240).trim()}…` : plainText;
}

function SourceDetails({ source, onClose }: { source: SourceDocument; onClose: () => void }) {
  const breadcrumb = source.breadcrumb?.length
    ? source.breadcrumb
    : [serviceNames[source.service] ?? source.service, source.heading];
  const citationLabel = source.citationIndex.toLocaleString("fa-IR");

  return (
    <article className="source-detail-card" dir="rtl">
      <div className="source-detail-accent" aria-hidden="true" />
      <div className="source-detail-topline">
        <span className="source-detail-index">منبع رسمی {citationLabel}</span>
        <button type="button" className="source-detail-close" onClick={onClose} aria-label="بستن جزئیات منبع">
          <X size={17} aria-hidden="true" />
        </button>
      </div>

      <div className="source-detail-breadcrumb" aria-label={`مسیر مستندات: ${breadcrumb.join("، ")}`}>
        <Layers3 size={14} aria-hidden="true" />
        {breadcrumb.map((item, index) => (
          <span key={`${item}-${index}`}>
            {item}
            {index < breadcrumb.length - 1 && <ArrowUpLeft size={12} aria-hidden="true" />}
          </span>
        ))}
      </div>

      <h2>{source.title}</h2>
      <p>{sourceSummary(source.snippet)}</p>

      <Button asChild className="source-doc-link">
        <a href={source.url} target="_blank" rel="noreferrer">
          مشاهده در مستندات لیارا
          <ExternalLink size={16} aria-hidden="true" />
          <span className="sr-only">در برگه جدید باز می‌شود</span>
        </a>
      </Button>
    </article>
  );
}

function useMobileSourceSurface() {
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 840px)");
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return mobile;
}

export function SourceReference({ source, children }: SourceReferenceProps) {
  const [open, setOpen] = useState(false);
  const mobile = useMobileSourceSurface();
  const citationLabel = source.citationIndex.toLocaleString("fa-IR");

  if (mobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>{children}</DrawerTrigger>
        <DrawerContent className="source-drawer-content" dir="rtl">
          <DrawerTitle className="sr-only">
            جزئیات منبع {citationLabel}: {source.title}
          </DrawerTitle>
          <DrawerDescription className="sr-only">
            خلاصه منبع رسمی شماره {citationLabel} و پیوند مشاهده در مستندات لیارا
          </DrawerDescription>
          <SourceDetails source={source} onClose={() => setOpen(false)} />
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="source-popover-content"
        align="start"
        sideOffset={10}
        collisionPadding={12}
        dir="rtl"
        role="dialog"
        aria-label={`جزئیات منبع ${citationLabel}: ${source.title}`}
      >
        <SourceDetails source={source} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
