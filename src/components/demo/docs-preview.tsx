"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowLeft,
  Bot,
  Box,
  Boxes,
  Cloud,
  Code2,
  CheckCircle2,
  Database,
  FileCode2,
  Github,
  Globe2,
  Home,
  Menu,
  Moon,
  Rocket,
  Search,
  Server,
  Sparkles,
  Sun,
  TerminalSquare,
  X,
} from "lucide-react";

const sidebarGroups = [
  {
    label: "شروع",
    items: [
      { label: "خانه", icon: Home, href: "#docs-home" },
      { label: "لیارا در یک نگاه", icon: Sparkles, href: "#docs-products" },
    ],
  },
  {
    label: "محصولات",
    items: [
      { label: "پلتفرم", icon: Boxes, href: "#docs-start" },
      { label: "هوش مصنوعی", icon: Bot, href: "#docs-products" },
      { label: "سرور مجازی ابری", icon: Cloud, href: "#docs-products" },
      { label: "دیتابیس", icon: Database, href: "#docs-products" },
      { label: "برنامه‌های آماده", icon: Rocket, href: "#docs-products" },
      { label: "سامانه مدیریت دامنه", icon: Globe2, href: "#docs-products" },
    ],
  },
  {
    label: "ارجاعات",
    items: [
      { label: "Liara CLI", icon: TerminalSquare, href: "#docs-references" },
      { label: "Liara API", icon: Code2, href: "#docs-references" },
    ],
  },
] as const;

const gettingStarted = [
  { title: "شروع به کار با Next.js", icon: FileCode2 },
  { title: "شروع به کار با Node.js", icon: Server },
  { title: "شروع به کار با Docker", icon: Box },
  { title: "شروع به کار با React", icon: Code2 },
] as const;

const products = [
  {
    title: "پلتفرم (PaaS)",
    icon: Boxes,
    description: "آموزش گام‌به‌گام آماده‌سازی و استقرار برنامه‌ها روی پلتفرم لیارا.",
  },
  {
    title: "هوش مصنوعی (AI API)",
    icon: Sparkles,
    description: "معرفی مدل‌ها، APIها و روش استفاده از سرویس هوش مصنوعی در پروژه‌ها.",
  },
  {
    title: "دیتابیس (DBaaS)",
    icon: Database,
    description: "راه‌اندازی دیتابیس و اتصال امن برنامه‌ها به سرویس‌های داده لیارا.",
  },
] as const;

export function DocsPreview() {
  const [query, setQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dark, setDark] = useState(false);

  return (
    <div className={`docs-demo-shell ${dark ? "is-dark" : ""}`}>
      {sidebarOpen && (
        <button
          type="button"
          className="docs-demo-scrim"
          aria-label="بستن فهرست مستندات"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={`docs-demo-sidebar ${sidebarOpen ? "is-open" : ""}`} aria-label="فهرست مستندات">
        <div className="docs-demo-sidebar-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/liara-logo.svg" alt="لیارا" width={61} height={27} />
          <span>مستندات</span>
          <button type="button" aria-label="بستن فهرست" onClick={() => setSidebarOpen(false)}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <nav aria-label="بخش‌های مستندات">
          {sidebarGroups.map((group) => (
            <section key={group.label} className="docs-demo-sidebar-group">
              <h2>{group.label}</h2>
              {group.items.map(({ label, href, icon: Icon }) => (
                <a key={label} href={href} onClick={() => setSidebarOpen(false)}>
                  <Icon size={17} aria-hidden="true" />
                  {label}
                </a>
              ))}
            </section>
          ))}
        </nav>
        <a
          className="docs-demo-source-link"
          href="https://github.com/liara-cloud/docs"
          target="_blank"
          rel="noreferrer"
        >
          <Github size={17} aria-hidden="true" />
          مشاهده مخزن مستندات
        </a>
      </aside>

      <div className="docs-demo-page">
        <header className="docs-demo-header">
          <button type="button" className="docs-demo-menu" aria-label="بازکردن فهرست مستندات" onClick={() => setSidebarOpen(true)}>
            <Menu size={20} aria-hidden="true" />
          </button>
          <label className="docs-demo-search">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="جستجو در مستندات"
              placeholder="جستجو کنید"
            />
            <kbd>⌘ K</kbd>
          </label>
          <div className="docs-demo-header-actions">
            <Link className="docs-demo-ask-button" href="/assistant?source=docs">
              <Bot size={17} aria-hidden="true" />
              از دستیار بپرس
            </Link>
            <Link className="docs-demo-panel-button" href="/panel">ورود به پنل کاربری</Link>
            <button type="button" className="docs-demo-theme" onClick={() => setDark((value) => !value)} aria-label={dark ? "فعال‌کردن حالت روشن" : "فعال‌کردن حالت تاریک"}>
              {dark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
            </button>
          </div>
        </header>

        <main id="main-content" className="docs-demo-content">
          {query && (
            <div className="docs-demo-search-notice" role="status">
              جستجوی زنده در این شبیه‌سازی فعال نیست؛ می‌توانید همین سؤال را از دستیار بپرسید یا در مخزن رسمی بررسی کنید.
              <Link href="/assistant?source=docs">پرسیدن «{query}» از دستیار</Link>
            </div>
          )}

          <section id="docs-home" className="docs-demo-hero">
            <div>
              <span>مستندات سرویس‌های ابری</span>
              <h1>به مستندات لیارا خوش آمدید</h1>
              <p>اینجا خانه‌ی توسعه‌دهندگان است؛ مسیر راه‌اندازی، استقرار و مدیریت سرویس‌ها را پیدا کنید.</p>
            </div>
          </section>

          <section className="docs-assistant-promo" aria-labelledby="docs-assistant-promo-title">
            <div className="docs-assistant-promo-copy">
              <div className="docs-assistant-promo-kicker">
                <span>
                  <Sparkles size={15} aria-hidden="true" />
                  دستیار مستندات لیارا
                </span>
                <span className="docs-assistant-promo-status">
                  <i aria-hidden="true" />
                  آماده‌ی پاسخ‌گویی
                </span>
              </div>
              <h2 id="docs-assistant-promo-title">
                دنبال جواب نگردید؛{" "}
                <strong>از دستیار بپرسید.</strong>
              </h2>
              <p>
                سؤال فنی‌تان را به فارسی بنویسید؛ دستیار لیارا مستندات مرتبط را پیدا می‌کند و مسیر بعدی را مرحله‌به‌مرحله نشان می‌دهد.
              </p>
              <ul aria-label="امکانات دستیار مستندات">
                <li><CheckCircle2 size={16} aria-hidden="true" /> پاسخ بر اساس مستندات</li>
                <li><CheckCircle2 size={16} aria-hidden="true" /> لینک مستقیم به منبع</li>
                <li><CheckCircle2 size={16} aria-hidden="true" /> راهنمای قدم‌به‌قدم</li>
              </ul>
              <div className="docs-assistant-promo-actions">
                <Link className="docs-assistant-promo-primary" href="/assistant?source=docs">
                  <Bot size={18} aria-hidden="true" />
                  شروع گفتگو با دستیار لیارا
                  <ArrowLeft size={17} aria-hidden="true" />
                </Link>
                <a className="docs-assistant-promo-secondary" href="#docs-start">
                  فعلاً راهنماها را می‌بینم
                </a>
              </div>
            </div>

            <div className="docs-assistant-promo-art" aria-hidden="true">
              <Image
                src={dark ? "/demo/liara-assistant-banner-dark.png" : "/demo/liara-assistant-banner-light.png"}
                alt=""
                width={1536}
                height={1024}
                sizes="(max-width: 800px) calc(100vw - 28px), 520px"
              />
            </div>
          </section>

          <section id="docs-start" className="docs-demo-section">
            <div className="docs-demo-section-title">
              <div>
                <span>شروع سریع</span>
                <h2>همین حالا استقرار را شروع کنید</h2>
              </div>
              <p>فناوری پروژه را انتخاب کنید و پیش‌نیازهای استقرار را ببینید.</p>
            </div>
            <div className="docs-demo-start-grid">
              {gettingStarted.map(({ title, icon: Icon }) => (
                <article key={title}>
                  <span><Icon size={21} aria-hidden="true" /></span>
                  <h3>{title}</h3>
                  <ArrowLeft size={17} aria-hidden="true" />
                </article>
              ))}
            </div>
          </section>

          <section id="docs-products" className="docs-demo-section">
            <div className="docs-demo-section-title">
              <div>
                <span>راهنمای سرویس‌ها</span>
                <h2>محصولات لیارا</h2>
              </div>
              <p>مفاهیم و مراحل اصلی هر سرویس را در یک نقطه مرور کنید.</p>
            </div>
            <div className="docs-demo-product-grid">
              {products.map(({ title, icon: Icon, description }) => (
                <article key={title}>
                  <span><Icon size={20} aria-hidden="true" /></span>
                  <h3>{title}</h3>
                  <p>{description}</p>
                  <small>راهنمای نمایشی</small>
                </article>
              ))}
            </div>
          </section>

          <section id="docs-references" className="docs-demo-source-banner">
            <div>
              <Github size={22} aria-hidden="true" />
              <div>
                <h2>محتوای این شبیه‌سازی از مستندات اوپن‌سورس لیارا الهام گرفته است</h2>
                <p>برای مشاهده‌ی همه‌ی صفحات و آخرین تغییرات، مخزن رسمی را باز کنید.</p>
              </div>
            </div>
            <a href="https://github.com/liara-cloud/docs" target="_blank" rel="noreferrer">
              مشاهده در GitHub
              <ArrowLeft size={16} aria-hidden="true" />
            </a>
          </section>
        </main>
      </div>
    </div>
  );
}
