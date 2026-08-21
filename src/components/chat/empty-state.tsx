"use client";

import Link from "next/link";
import { ArrowLeft, Braces, Database, Globe2, ScrollText } from "lucide-react";
import type { AssistantEntryContext } from "@/modules/demo/assistant-entry-context";

const directPrompts = [
  {
    icon: ScrollText,
    title: "خطای استقرار را بررسی کن",
    detail: "لاگ را بفرست و قدم‌به‌قدم جلو برو",
    prompt: "برنامه‌ام روی لیارا Deploy نمی‌شود. برای پیدا کردن علت چه اطلاعاتی لازم داری؟",
  },
  {
    icon: Globe2,
    title: "اتصال دامنه",
    detail: "رکوردها و ترتیب تنظیم را پیدا کن",
    prompt: "برای اتصال دامنه به برنامه لیارا باید چه مراحلی را انجام بدهم؟",
  },
  {
    icon: Database,
    title: "اتصال به دیتابیس",
    detail: "تنظیمات امن و مستند دریافت کن",
    prompt: "روش اتصال برنامه Next.js به PostgreSQL لیارا را با نمونه متغیرهای محیطی توضیح بده.",
  },
  {
    icon: Braces,
    title: "ساخت تنظیمات",
    detail: "کد و فایل آماده کپی بگیر",
    prompt: "یک چک‌لیست مستند برای آماده‌کردن پروژه Next.js جهت استقرار در لیارا بساز.",
  },
];

const panelPrompts = [
  {
    icon: Braces,
    title: "انتخاب سرویس مناسب",
    detail: "برنامه، دیتابیس یا سرور مجازی؟",
    prompt: "برای پروژه‌ام چطور سرویس مناسب لیارا را انتخاب کنم؟",
  },
  {
    icon: ScrollText,
    title: "آماده‌کردن پروژه Next.js",
    detail: "پیش‌نیازهای اولین استقرار",
    prompt: "برای اولین استقرار پروژه Next.js روی لیارا چه کارهایی باید انجام بدهم؟",
  },
  {
    icon: Globe2,
    title: "اتصال دامنه",
    detail: "مراحل تنظیم DNS و دامنه",
    prompt: "مراحل اتصال دامنه به برنامه لیارا را قدم‌به‌قدم توضیح بده.",
  },
  {
    icon: Database,
    title: "برنامه یا سرور مجازی",
    detail: "انتخاب متناسب با نیاز پروژه",
    prompt: "برای پروژه من برنامه ابری بهتر است یا سرور مجازی لیارا؟",
  },
];

const docsPrompts = [
  {
    icon: ScrollText,
    title: "پیداکردن صفحه مرتبط",
    detail: "موضوع را بگو تا مسیرش را پیدا کنم",
    prompt: "برای موضوعی که توضیح می‌دهم صفحه مرتبط در مستندات لیارا را پیدا کن.",
  },
  {
    icon: Braces,
    title: "ساده‌تر توضیح بده",
    detail: "مفهوم فنی را با مثال مرور کنیم",
    prompt: "می‌توانی یکی از مفاهیم مستندات لیارا را ساده و با مثال توضیح بدهی؟",
  },
  {
    icon: Globe2,
    title: "اولین استقرار",
    detail: "از آماده‌سازی تا اجرای برنامه",
    prompt: "راهنمای اولین استقرار برنامه روی لیارا را خلاصه و مرحله‌ای بگو.",
  },
  {
    icon: Database,
    title: "خطاهای رایج",
    detail: "نشانه‌ها و راه‌حل‌های مستند",
    prompt: "خطاهای رایج هنگام استقرار روی لیارا و راه بررسی آن‌ها چیست؟",
  },
];

const variants = {
  direct: {
    eyebrow: undefined,
    title: "چه مشکلی در لیارا داری؟",
    description: "سؤال، لاگ یا تصویر خطا را بفرست. من از میان مستندات رسمی، مسیر مرتبط را پیدا می‌کنم و قدم بعدی را روشن می‌گویم.",
    returnLabel: undefined,
    prompts: directPrompts,
  },
  panel: {
    eyebrow: "ورود از پیشخوان لیارا",
    title: "برای شروع روی لیارا چه کمکی می‌خواهی؟",
    description: "نیازت را بگو تا برای انتخاب سرویس، آماده‌سازی پروژه یا اولین استقرار مسیر روشن‌تری پیدا کنیم.",
    returnLabel: "بازگشت به پیشخوان",
    prompts: panelPrompts,
  },
  docs: {
    eyebrow: "ورود از مستندات لیارا",
    title: "در مستندات دنبال چه چیزی هستی؟",
    description: "سؤالت را با زبان خودت بپرس تا صفحه مرتبط و قدم بعدی را از میان مستندات رسمی پیدا کنم.",
    returnLabel: "بازگشت به مستندات",
    prompts: docsPrompts,
  },
} as const;

interface EmptyStateProps {
  entryContext?: AssistantEntryContext;
  onPrompt: (prompt: string) => void;
}

export function EmptyState({ entryContext, onPrompt }: EmptyStateProps) {
  const context = entryContext ?? { source: "direct" as const, returnHref: "/" as const };
  const variant = variants[context.source];

  return (
    <div className="empty-state">
      {context.source !== "direct" && (
        <div className="empty-entry-bar">
          <span className="empty-entry-eyebrow">{variant.eyebrow}</span>
          <Link className="empty-entry-return" href={context.returnHref}>
            {variant.returnLabel}
            <ArrowLeft size={15} aria-hidden="true" />
          </Link>
        </div>
      )}
      <div className="empty-document-mark" aria-hidden="true">
        <span>داک</span>
        <i />
        <i />
        <i />
      </div>
      <div className="empty-copy">
        <h1>{variant.title}</h1>
        <p>{variant.description}</p>
      </div>

      <div className="prompt-grid">
        {variant.prompts.map((prompt) => {
          const Icon = prompt.icon;
          return (
            <button key={prompt.title} className="prompt-card" onClick={() => onPrompt(prompt.prompt)}>
              <span className="prompt-icon"><Icon size={19} /></span>
              <span className="prompt-text">
                <strong>{prompt.title}</strong>
                <small>{prompt.detail}</small>
              </span>
              <ArrowLeft size={17} className="prompt-arrow" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
