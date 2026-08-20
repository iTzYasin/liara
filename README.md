# دستیار مستندات لیارا

دستیار فارسی مبتنی بر RAG برای پاسخ‌گویی مستند به پرسش‌های لیارا. پاسخ‌ها Streaming هستند، هر ادعای مرتبط با لیارا به صفحه و Heading داک ارجاع می‌دهد و ورودی‌های حساس پیش از ارسال در مرورگر و دوباره روی سرور ماسک می‌شوند.

## اجرای محلی

نیازمندی: Node.js 22 یا جدیدتر.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

برنامه در `http://localhost:3000` اجرا می‌شود. با `DEMO_MODE=true` بدون کلید مدل هم می‌توان مسیر کامل UI و RAG را بررسی کرد. برای پاسخ واقعی:

```dotenv
DEMO_MODE=false
GEMINI_API_KEY=your-key
GEMINI_MODEL=gemini-3.5-flash-lite
```

Secret را داخل Git، Docker image یا متغیر عمومی `NEXT_PUBLIC_*` قرار ندهید.

## مستندات و ایندکس

نسخه رسمی داک در `liara-docs/public/llms` خوانده می‌شود و یک ایندکس نسخه‌بندی‌شده در `data/liara-docs-index.json` می‌سازد:

```bash
npm run docs:index
```

برای دریافت آخرین نسخه رسمی و جایگزینی atomic ایندکس:

```bash
npm run docs:sync
```

Workflow روزانه `.github/workflows/sync-docs.yml` فقط پس از پاس‌شدن Golden Set ایندکس جدید را commit می‌کند؛ اگر pull، indexing یا تست شکست بخورد، آخرین ایندکس سالم دست‌نخورده باقی می‌ماند.

اگر clone داک روی محیط build وجود نداشته باشد، اسکریپت از آخرین ایندکس سالم موجود استفاده می‌کند. وضعیت corpus از `/api/docs/status` قابل مشاهده است.

## معماری

- `src/modules/retrieval`: قرارداد Retriever و Adapter ایندکس فایل؛ قابل جایگزینی با Meilisearch بدون تغییر Agent
- `src/modules/agent`: Orchestrator، Adapter مستقل Gemini، Retry/Timeout/Circuit breaker و سیاست Citation
- `src/modules/observability`: تجمیع Metricهای بدون محتوا، Feedback و هزینه تخمینی
- `src/modules/infra/lru-ttl-cache.ts`: Cache محدود و TTLدار برای Retrieval و پاسخ عمومی
- `src/modules/security`: ماسک قطعی Secret در Client و Server
- `src/modules/conversations`: قرارداد ذخیره‌سازی و Adapter محلی IndexedDB
- `src/app/api/chat`: اعتبارسنجی، Rate limit و SSE
- `src/components/chat`: رابط RTL، تاریخچه، فایل، Scroll تطبیقی و پنل ردپای منابع

هیچ اتصال یا دسترسی به حساب، سرویس یا لاگ کاربران لیارا وجود ندارد؛ فقط داک رسمی و داده‌ای که خود کاربر وارد می‌کند در دامنه محصول است.

## کنترل کیفیت

```bash
npm run check       # lint + typecheck + unit/integration tests
npm run test:e2e    # desktop + mobile
npm run build       # index + production build
```

Health endpointها:

- `/healthz`: زنده بودن Process
- `/readyz`: آماده بودن ایندکس و Provider/حالت دمو
- `/api/docs/status`: تعداد اسناد، Chunkها و commit منبع
- `/api/metrics`: کیفیت، latency، cache، token و هزینه تخمینی بدون Prompt یا PII

## قابلیت‌های نگهداشت و هزینه

- جستجو در عنوان و متن تاریخچه فقط داخل مرورگر انجام می‌شود.
- خروجی Markdown فقط از نسخه ماسک‌شده IndexedDB ساخته می‌شود.
- Response cache فقط برای سؤال عمومی بدون history، فایل، Secret، خطا یا شناسه شخصی فعال است.
- Context قدیمی خلاصه و فقط چهار Turn اخیر با جزئیات کامل به مدل داده می‌شود.
- Dashboard «صورت‌وضعیت اجرا» از منوی تاریخچه قابل مشاهده است و پس از restart از صفر شروع می‌شود.
- هزینه با نرخ استاندارد Gemini 3.5 Flash-Lite محاسبه می‌شود و نرخ‌ها از `GEMINI_INPUT_USD_PER_MILLION` و `GEMINI_OUTPUT_USD_PER_MILLION` قابل تنظیم‌اند.

## Docker

```bash
docker build -t liara-docs-assistant .
docker run --rm -p 3000:3000 --env-file .env.local liara-docs-assistant
```

Image چندمرحله‌ای است و Process نهایی با کاربر non-root اجرا می‌شود. استقرار مستقیم Next.js نیز با `liara.json` موجود قابل انجام است.

جزئیات محصول، معیارهای پذیرش، مسیر دمو و اولویت‌ها در [PRD](./PRD-liara-assistant.md) آمده است.
