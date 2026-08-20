"use client";

import { ArrowLeft, Braces, Database, Globe2, ScrollText } from "lucide-react";

const prompts = [
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

export function EmptyState({ onPrompt }: { onPrompt: (prompt: string) => void }) {
  return (
    <div className="empty-state">
      <div className="empty-document-mark" aria-hidden="true">
        <span>داک</span>
        <i />
        <i />
        <i />
      </div>
      <div className="empty-copy">
        <span className="eyebrow">پاسخ، همراه با مسیر رسیدن به آن</span>
        <h1>چه مشکلی در لیارا داری؟</h1>
        <p>
          سؤال، لاگ یا تصویر خطا را بفرست. من از میان مستندات رسمی، مسیر مرتبط را پیدا می‌کنم و قدم بعدی را روشن می‌گویم.
        </p>
      </div>

      <div className="prompt-grid">
        {prompts.map((prompt) => {
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

      <div className="empty-footnote">
        <span className="evidence-swatch" />
        هر ادعای مربوط به لیارا با صفحه و بخش دقیق داک نمایش داده می‌شود.
      </div>
    </div>
  );
}
