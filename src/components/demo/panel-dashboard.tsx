"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import {
  Archive,
  Bell,
  Bot,
  Box,
  Boxes,
  ChevronDown,
  Cloud,
  Cpu,
  Database,
  Globe2,
  Headphones,
  Mail,
  Plus,
  Search,
  Sparkles,
  Zap,
} from "lucide-react";

const services = [
  { label: "پلتفرم", icon: Boxes, active: true },
  { label: "دیتابیس", icon: Database, active: false },
  { label: "سرور مجازی ابری", icon: Cloud, active: false },
  { label: "وردپرس اختصاصی", icon: Globe2, active: false },
  { label: "برنامه‌های آماده", icon: Box, active: false },
  { label: "ذخیره‌سازی ابری", icon: Archive, active: false },
  { label: "DNS", icon: Globe2, active: false },
  { label: "ایمیل", icon: Mail, active: false },
  { label: "هوش مصنوعی", icon: Sparkles, active: false },
] as const;

export function PanelDashboard() {
  const [notice, setNotice] = useState<string>();

  return (
    <div className="panel-demo-shell">
      <header className="panel-demo-topbar">
        <div className="panel-demo-brand-area">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/liara-logo.svg" alt="لیارا" width={82} height={35} />
          <span className="panel-demo-divider" aria-hidden="true" />
          <button type="button" className="panel-demo-workspace" aria-label="فضای کاری نمایشی">
            <span className="panel-demo-status-dot" aria-hidden="true" />
            لیارا
            <ChevronDown size={15} aria-hidden="true" />
          </button>
        </div>

        <nav className="panel-demo-primary-nav" aria-label="ناوبری اصلی پیشخوان">
          <span>پشتیبانی <Headphones size={15} aria-hidden="true" /></span>
          <span>راهنما</span>
          <Link href="/docs">مستندات</Link>
          <span>آموزش</span>
          <span dir="ltr">CI/CD</span>
          <span dir="ltr">API</span>
        </nav>

        <div className="panel-demo-account-area">
          <button type="button" className="panel-demo-search" aria-label="جستجو در پیشخوان">
            <Search size={18} aria-hidden="true" />
            <kbd>⌘K</kbd>
          </button>
          <span className="panel-demo-operation"><i aria-hidden="true" /> عملیاتی</span>
          <Zap className="panel-demo-zap" size={18} aria-hidden="true" />
          <button type="button" className="panel-demo-icon-button" aria-label="اعلان‌ها">
            <Bell size={19} aria-hidden="true" />
          </button>
          <span className="panel-demo-credit">اعتبار نمایشی</span>
          <span className="panel-demo-user-avatar" aria-hidden="true">ک</span>
          <span className="panel-demo-team">تیم نمونه <ChevronDown size={15} aria-hidden="true" /></span>
        </div>
      </header>

      <nav className="panel-demo-services" aria-label="سرویس‌های لیارا">
        {services.map(({ label, icon: Icon, active }) => (
          <span key={label} className={active ? "is-active" : undefined}>
            <span className="panel-demo-service-icon"><Icon size={18} aria-hidden="true" /></span>
            {label}
          </span>
        ))}
      </nav>

      <main id="main-content" className="panel-demo-content">
        <Link className="panel-demo-assistant-pill" href="/assistant?source=panel">
          <Bot size={18} aria-hidden="true" />
          دستیار لیارا
          <span>برای انتخاب و راه‌اندازی سرویس</span>
        </Link>

        <section className="panel-demo-empty" aria-labelledby="panel-empty-title">
          <Image
            className="panel-demo-empty-image"
            src="/demo/panel-empty-state.png"
            alt="سه کارت سرویس ابری متصل به یکدیگر"
            width={768}
            height={512}
            priority
          />
          <div className="panel-demo-empty-copy">
            <h1 id="panel-empty-title">هنوز برنامه‌ای نساخته‌اید</h1>
            <p>با ایجاد اولین برنامه، پروژه‌تان را روی زیرساخت ابری لیارا اجرا کنید.</p>
          </div>
          <div className="panel-demo-empty-actions">
            <button type="button" className="panel-demo-create" onClick={() => setNotice("ساخت سرویس در این نمونه فعال نیست. برای انتخاب سرویس مناسب از دستیار کمک بگیرید.")}>
              <Plus size={20} aria-hidden="true" />
              ایجاد برنامه
            </button>
            <Link className="panel-demo-ask" href="/assistant?source=panel">
              <Bot size={18} aria-hidden="true" />
              شروع با دستیار لیارا
            </Link>
          </div>
          {notice && (
            <div className="panel-demo-notice" role="status">
              <Cpu size={16} aria-hidden="true" />
              {notice}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
