"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MetricsSnapshot } from "@/modules/observability/metrics";
import { Activity, BookOpenText, Clock3, Coins, Database, RefreshCw, ShieldCheck, ThumbsUp, X } from "lucide-react";

interface DocsStatus {
  ready: boolean;
  documents: number;
  chunks: number;
  sourceCommit: string;
  generatedAt?: string;
  backend?: "local" | "meilisearch" | "local-fallback";
}

interface QualityPanelProps {
  open: boolean;
  onClose: () => void;
}

function fa(value: number, maximumFractionDigits = 1) {
  return value.toLocaleString("fa-IR", { maximumFractionDigits });
}

function duration(value: number) {
  if (!value) return "—";
  return value < 1_000 ? `${fa(value, 0)} ms` : `${fa(value / 1_000)} s`;
}

function MetricRail({ label, value, percent }: { label: string; value: string; percent: number }) {
  return (
    <div className="metric-rail">
      <div><span>{label}</span><strong>{value}</strong></div>
      <progress
        max={100}
        value={Math.max(0, Math.min(100, percent))}
        aria-label={`${label}: ${value}`}
      />
    </div>
  );
}

export function QualityPanel({ open, onClose }: QualityPanelProps) {
  const [metrics, setMetrics] = useState<MetricsSnapshot>();
  const [docs, setDocs] = useState<DocsStatus>();
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    }
    if (!open && wasOpenRef.current) {
      const previous = returnFocusRef.current;
      const fallback = document.querySelector<HTMLElement>('button[aria-label="بازکردن تاریخچه"]');
      const target = previous?.isConnected && !previous.closest("[inert]") ? previous : fallback;
      const frame = window.requestAnimationFrame(() => target?.focus());
      wasOpenRef.current = open;
      return () => window.cancelAnimationFrame(frame);
    }
    wasOpenRef.current = open;
  }, [open]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [metricResponse, docsResponse] = await Promise.all([
        fetch("/api/metrics", { cache: "no-store" }),
        fetch("/api/docs/status", { cache: "no-store" }),
      ]);
      if (metricResponse.ok) setMetrics(await metricResponse.json());
      if (docsResponse.ok) setDocs(await docsResponse.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => void load());
    return () => window.cancelAnimationFrame(frame);
  }, [load, open]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const focusable = () => [...(panel?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ) ?? [])];
    const frame = window.requestAnimationFrame(() => focusable()[0]?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open]);

  return (
    <>
      {open && <button className="quality-scrim" onClick={onClose} aria-label="بستن گزارش کیفیت" />}
      <aside
        ref={panelRef}
        className={`quality-panel ${open ? "is-open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="گزارش کیفیت محصول"
        aria-hidden={!open}
        inert={!open}
      >
        <header className="quality-header">
          <div>
            <Activity size={19} />
            <span><strong>صورت‌وضعیت اجرا</strong><small>Metric بدون متن گفتگو یا اطلاعات شخصی</small></span>
          </div>
          <div className="quality-header-actions">
            <button className="icon-button" onClick={() => void load()} aria-label="به‌روزرسانی گزارش">
              <RefreshCw size={17} className={loading ? "is-spinning" : ""} />
            </button>
            <button className="icon-button" onClick={onClose} aria-label="بستن گزارش کیفیت"><X size={18} /></button>
          </div>
        </header>

        <div className="quality-content">
          <section className="quality-hero">
            <div className="quality-hero-label"><span className="trust-dot" />از زمان شروع این نسخه</div>
            <div className="quality-hero-number">
              <strong>{fa(metrics?.requests.successRate ?? 0)}٪</strong>
              <span>Turn موفق از {fa(metrics?.requests.total ?? 0, 0)} درخواست</span>
            </div>
            <MetricRail label="نرخ موفقیت" value={`${fa(metrics?.requests.successRate ?? 0)}٪`} percent={metrics?.requests.successRate ?? 0} />
            <MetricRail label="پاسخ با Confidence بالا" value={`${fa(metrics?.quality.highConfidenceRate ?? 0)}٪`} percent={metrics?.quality.highConfidenceRate ?? 0} />
            <MetricRail label="اعتبار Citation" value={`${fa(metrics?.quality.citationValidityRate ?? 100)}٪`} percent={metrics?.quality.citationValidityRate ?? 100} />
            <MetricRail label="Cache hit" value={`${fa(metrics?.cache.hitRate ?? 0)}٪`} percent={metrics?.cache.hitRate ?? 0} />
          </section>

          {metrics?.alerts.length ? (
            <section className="quality-alerts" aria-label="هشدارها">
              {metrics.alerts.map((alert) => <p key={alert}>{alert}</p>)}
            </section>
          ) : (
            <div className="quality-clear"><ShieldCheck size={16} />هشدار فعالی ثبت نشده است</div>
          )}

          <section className="quality-section">
            <h3><Clock3 size={16} />زمان پاسخ</h3>
            <div className="quality-facts">
              <div><span>اولین Token، p50</span><strong dir="ltr">{duration(metrics?.latency.firstTokenP50Ms ?? 0)}</strong></div>
              <div><span>اولین Token، p95</span><strong dir="ltr">{duration(metrics?.latency.firstTokenP95Ms ?? 0)}</strong></div>
              <div><span>پاسخ کامل، p50</span><strong dir="ltr">{duration(metrics?.latency.totalP50Ms ?? 0)}</strong></div>
              <div><span>پاسخ کامل، p95</span><strong dir="ltr">{duration(metrics?.latency.totalP95Ms ?? 0)}</strong></div>
            </div>
          </section>

          <section className="quality-section">
            <h3><Coins size={16} />مصرف و هزینه تخمینی</h3>
            <div className="quality-facts">
              <div><span>Input token</span><strong>{fa(metrics?.usage.inputTokens ?? 0, 0)}</strong></div>
              <div><span>Output token</span><strong>{fa(metrics?.usage.outputTokens ?? 0, 0)}</strong></div>
              <div><span>میانگین هر Turn</span><strong>{fa(metrics?.usage.averageTokensPerTurn ?? 0, 0)}</strong></div>
              <div><span>هزینه استاندارد</span><strong dir="ltr">${(metrics?.usage.estimatedCostUsd ?? 0).toFixed(6)}</strong></div>
            </div>
            <p className="quality-caption">
              نرخ محاسبه: ${metrics?.usage.pricePerMillion.inputUsd ?? 0}/M ورودی و ${metrics?.usage.pricePerMillion.outputUsd ?? 0}/M خروجی؛ قابل تنظیم از Environment.
            </p>
          </section>

          <section className="quality-section">
            <h3><ThumbsUp size={16} />کیفیت پاسخ</h3>
            <div className="quality-facts">
              <div><span>میانگین منابع</span><strong>{fa(metrics?.quality.averageSources ?? 0)}</strong></div>
              <div><span>Escalation</span><strong>{fa(metrics?.quality.escalationRate ?? 0)}٪</strong></div>
              <div><span>Clarification</span><strong>{fa(metrics?.quality.clarificationRate ?? 0)}٪</strong></div>
              <div><span>بازخورد مثبت</span><strong>{fa(metrics?.feedback.positiveRate ?? 0)}٪</strong></div>
            </div>
          </section>

          <section className="quality-section docs-ledger">
            <h3><BookOpenText size={16} />نسخه مستندات</h3>
            <div className="docs-ledger-row"><Database size={17} /><span><strong>{fa(docs?.documents ?? 0, 0)} سند · {fa(docs?.chunks ?? 0, 0)} بخش</strong><small>commit {docs?.sourceCommit ?? "—"} · جستجو: {docs?.backend === "meilisearch" ? "Meilisearch" : docs?.backend === "local-fallback" ? "ایندکس محلی پشتیبان" : "ایندکس محلی"}</small></span></div>
            <div className="docs-ledger-time">
              آخرین ساخت ایندکس: {docs?.generatedAt ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(docs.generatedAt)) : "نامشخص"}
            </div>
          </section>

          <p className="quality-footnote">این گزارش درون حافظه Process نگهداری می‌شود و با استقرار مجدد از صفر آغاز می‌شود.</p>
        </div>
      </aside>
    </>
  );
}
