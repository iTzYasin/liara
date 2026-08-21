# دستیار مستندات لیارا

دستیار فارسی مبتنی بر RAG برای پاسخ‌گویی مستند به پرسش‌های لیارا. پاسخ‌ها Streaming هستند، هر ادعای مرتبط با لیارا به صفحه و Heading داک ارجاع می‌دهد و ورودی‌های حساس پیش از ارسال در مرورگر و دوباره روی سرور ماسک می‌شوند.

## اجرای محلی

نیازمندی: Node.js 22 یا جدیدتر.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

برنامه در `http://localhost:3000` اجرا می‌شود. `DEMO_MODE` به‌صورت پیش‌فرض خاموش است و نبود کلید Provider باعث fail-closed شدن تنظیمات می‌شود. تنظیم پاسخ واقعی با AvalAI و مدل فعلی پروژه:

```dotenv
DEMO_MODE=false
MODEL_PROVIDER=avalai
AVALAI_API_KEY=your-key
AVALAI_BASE_URL=https://api.avalai.ir/v1
AVALAI_MODEL=deepseek-v4-flash
```

برای Gemini مقدار `MODEL_PROVIDER=gemini` و متغیرهای `GEMINI_API_KEY`، `GEMINI_MODEL` و `GEMINI_FALLBACK_MODEL` را تنظیم کنید. حالت قطعی UI/RAG فقط برای تست با `DEMO_MODE=true` فعال می‌شود. Secret را داخل Git، Docker image یا متغیر عمومی `NEXT_PUBLIC_*` قرار ندهید.

سقف مصرف چت با `CHAT_MESSAGE_LIMIT` (پیش‌فرض ۲۰ پیام) در بازه `CHAT_MESSAGE_WINDOW_MINUTES` (پیش‌فرض ۳۰ دقیقه) تنظیم می‌شود. پس از مصرف سهمیه، Composer تا پایان بازه قفل و شمارش معکوس نمایش داده می‌شود؛ محدودیت‌های سریع دقیقه‌ای/ساعتی همچنان به‌عنوان محافظ سوءاستفاده فعال‌اند.

در بن‌بست مستنداتی، Agent صادقانه نبود پاسخ قابل‌اتکا را اعلام می‌کند و LLM براساس مکالمه یک موضوع و متن تیکت آماده می‌سازد. کارت پیش‌نویس، کپی متن و دکمه «ارسال تیکت» را نمایش می‌دهد؛ اتصال واقعی دکمه به سامانه پشتیبانی خارج از محدوده این مرحله است و دکمه تا آن زمان غیرفعال می‌ماند.

## مستندات و ایندکس

نسخه رسمی داک در `liara-docs/public/llms` خوانده می‌شود و یک ایندکس نسخه‌بندی‌شده در `data/liara-docs-index.json` می‌سازد:

```bash
npm run docs:index
```

برای دریافت آخرین نسخه رسمی و جایگزینی atomic ایندکس:

```bash
npm run docs:sync
```

Workflow `.github/workflows/sync-docs.yml` هر ۱۵ دقیقه commit داک رسمی را با یک `git ls-remote` سبک و timeout ده‌ثانیه‌ای بررسی می‌کند. تا وقتی commit تغییر نکرده باشد، نصب وابستگی، clone، indexing و تست اجرا نمی‌شوند؛ بنابراین polling هیچ باری روی سرور برنامه ندارد. با تغییر داک، ایندکس پس از پاس‌شدن Golden Set و—در صورت تنظیم بودن—convergence اتمیک Meilisearch commit می‌شود؛ سپس push آن deploy متصل به branch پیش‌فرض را فعال می‌کند. در اجرای Meilisearch، index قبلی تا موفق‌شدن push به‌عنوان rollback candidate نگه داشته می‌شود؛ اگر pull یا push شکست بخورد swap برگردانده می‌شود و دو backend روی corpus قبلی می‌مانند.

برای اجرای سریع‌تر از polling، workflow رویداد `repository_dispatch` با نوع `liara-docs-updated` را نیز می‌پذیرد. این trigger اختیاری است و باید از repository داک یا یک GitHub App ارسال شود؛ زمان‌بندی ۱۵ دقیقه‌ای بدون آن نیز کامل کار می‌کند.

هر chunk دارای `content_hash` پایدار و breadcrumb واقعی سند است. این hash مبنای sync افزایشی موتور جستجو است و breadcrumb نیز عیناً در کارت منبع نمایش داده می‌شود.

اگر clone داک روی محیط build وجود نداشته باشد، اسکریپت از آخرین ایندکس سالم موجود استفاده می‌کند. وضعیت corpus از `/api/docs/status` قابل مشاهده است.

## معماری

- `src/modules/retrieval`: قرارداد Retriever، جستجوی محلی commit‌شده و Adapter عملیاتی Meilisearch با fallback خودکار
- `src/modules/agent/agent.ts`: Orchestrator اصلی با interface کوچک `streamAgentTurn`
- `src/modules/agent/model-adapter.ts`: seam مشترک Providerها؛ پیاده‌سازی‌های Gemini، AvalAI و Demo از Orchestrator جدا هستند
- `src/modules/agent/agent-prompt.ts` و `sanitize-agent-request.ts`: ساخت Prompt و پاک‌سازی ورودی، دور از جریان اصلی Agent
- `src/modules/agent`: router ساختاریافته LLM-first، حافظه فشرده، Workflow چندمرحله‌ای، Retry/Timeout/Circuit breaker و سیاست Citation پیش از نمایش
- `src/modules/observability`: تجمیع Metricهای بدون محتوا، Feedback و هزینه تخمینی
- `src/modules/infra/lru-ttl-cache.ts`: Cache محدود و TTLدار برای Retrieval و پاسخ عمومی
- `src/modules/security`: ماسک قطعی Secret در Client و Server
- `src/modules/conversations`: قرارداد ذخیره‌سازی و Adapter محلی IndexedDB
- `src/app/api/chat`: اعتبارسنجی، Rate limit و SSE
- `src/components/chat`: رابط RTL، تاریخچه، فایل، Scroll تطبیقی و پنل ردپای منابع؛ state و lifecycle گفتگو در hook داخلی `use-chat-workspace-controller.ts` متمرکز است

هیچ دسترسی مستقیمی به حساب، سرویس، لاگ یا سامانه تیکت کاربران لیارا وجود ندارد؛ فقط داک رسمی و داده‌ای که خود کاربر وارد می‌کند در دامنه محصول است.

### انتخاب موتور جستجو

در محیط بدون سرویس بیرونی، Retriever محلی بهبودیافته از ایندکس commit‌شده استفاده می‌کند و بدون وابستگی شبکه قابل دمو است. در محیط اصلی، با تنظیم `MEILI_URL` همان قرارداد به Meilisearch متصل می‌شود؛ خطا یا timeout آن به‌صورت خودکار به آخرین ایندکس محلی سالم برمی‌گردد. این انتخاب، کیفیت ranking و sync افزایشی Meilisearch را می‌دهد بدون اینکه availability پاسخ‌گویی را به یک سرویس جدید گره بزند.

```bash
# پس از تنظیم MEILI_URL و MEILI_API_KEY
npm run search:sync
```

`search:sync` ابتدا marker commit، fingerprint تنظیمات و تنظیمات واقعی index زنده و staging را با چند GET کوچک بررسی می‌کند. اگر هر دو به‌روز باشند هیچ writeای انجام نمی‌دهد؛ در غیر این صورت hashهای staging را صفحه‌بندی‌شده می‌خواند، فقط chunkهای تغییرکرده را upsert و chunkهای حذف‌شده را پاک می‌کند و در پایان staging را به‌صورت اتمیک با index زنده swap می‌کند. اجرای دستی پس از swap همان delta را روی staging قدیمی mirror می‌کند. Workflow این mirror را تا موفق‌شدن Git publication عقب می‌اندازد: بعد از push baseline را نهایی می‌کند و در صورت شکست publication با swap-back به index قبلی برمی‌گردد. اگر خود rollback موقتاً شکست بخورد، اجرای بعدی marker واقعی live و staging را با commit منتشرشده مقایسه و rollback window را دوباره می‌سازد؛ شکست mirror نیز در اجرای ۱۵ دقیقه‌ای بعدی بدون دست‌زدن به index زنده repair می‌شود.

برای فعال‌شدن این مرحله در GitHub Actions، Secretهای repository با نام `MEILI_URL` و در صورت نیاز `MEILI_API_KEY` را تعریف کنید. کلید باید مجوز خواندن/نوشتن سند و تنظیمات، ساخت index، خواندن task و `indexes.swap` را برای index زنده و staging داشته باشد. متغیرهای اختیاری `MEILI_INDEX_UID` و `MEILI_STAGING_INDEX_UID` نام این دو index را تغییر می‌دهند. بدون این Secretها، workflow فقط ایندکس محلی commit‌شده را منتشر می‌کند. وضعیت backend فعال در «گزارش کیفیت» و `/api/docs/status` دیده می‌شود.

## کنترل کیفیت

```bash
npm run check       # lint + typecheck + unit/integration tests
npm run golden:eval # ارزیابی مستقل ۱۳۰ سناریوی PRD
npm run golden:model-eval # اجرای همان ۱۳۰ سناریو روی Gemini با داور معنایی مستقل
npm run test:e2e    # build مستقل + desktop/tablet/mobile روی پورت ۳۱۰۰
npm run build       # production build + آماده‌سازی خروجی standalone
```

اجرای `golden:model-eval` فقط در محیط امن و با `GEMINI_API_KEY` انجام می‌شود، نتیجه را در
`artifacts/evaluation/gemini-golden-report.json` می‌نویسد و خود کلید را چاپ یا ذخیره نمی‌کند.

Health endpointها:

- `/healthz`: زنده بودن Process
- `/readyz`: آماده بودن ایندکس و Provider/حالت دمو
- `/api/docs/status`: تعداد اسناد، Chunkها و commit منبع
- `/api/metrics`: کیفیت، latency، cache، token و هزینه تخمینی بدون Prompt یا PII

## قابلیت‌های نگهداشت و هزینه

- جستجو در عنوان و متن تاریخچه فقط داخل مرورگر انجام می‌شود.
- خروجی Markdown فقط از نسخه ماسک‌شده IndexedDB ساخته می‌شود.
- Response cache فقط برای سؤال عمومی بدون history، فایل، Secret، خطا یا شناسه شخصی فعال است.
- هر پیام پس از ماسک Secret ابتدا به router مدل می‌رود؛ پاسخ اجتماعی، سؤال تکمیلی، escalation یا فعال‌کردن RAG از تصمیم JSON مدل می‌آید و متن ثابت policy وارد پاسخ موفق نمی‌شود.
- خروجی router و پاسخ مستند پیش از نمایش با JSON Schema کنترل می‌شوند؛ هرکدام یک repair محدود دارند و در خرابی مجدد fail-closed می‌شوند.
- در Provider Gemini، اگر مدل اصلی پیش از تولید خروجی با خطای موقت متوقف شود، درخواست یک‌بار به `GEMINI_FALLBACK_MODEL` منتقل می‌شود؛ مدل واقعاً استفاده‌شده در metric هر Turn ثبت می‌شود.
- Citation ناشناخته یا ادعای مخصوص لیارا بدون citation از پاسخ حذف و confidence کاهش داده می‌شود.
- Rate limit بر cookie امضاشده اعمال می‌شود؛ با تنظیم Upstash بودجه دقیقه‌ای، ساعتی و سهمیه پیامِ بازه ۳۰ دقیقه‌ای بین همه Replicaها مشترک است و در نبود آن fallback محلی دارد. IP فقط با `TRUSTED_PROXY_HOPS` صریح و از سمت مورد اعتماد زنجیره proxy خوانده می‌شود.
- CSP برای هر درخواست nonce تازه دارد و `unsafe-inline` در script/style مجاز نیست.
- Context قدیمی به حافظه فشرده و قطعی تبدیل می‌شود؛ ۱۲ پیام اخیر از Client ارسال و شش پیام آخر با جزئیات کامل در Prompt نگه داشته می‌شوند. هدف و مراحل Workflow جداگانه ذخیره می‌شوند تا Follow-upهای مبهم قابل ادامه باشند.
- Workflow فقط با تأیید صریح کاربر مرحله‌ای را انجام‌شده می‌داند و در صورت بهبود Retrieval، مرحله‌های تأییدنشدهٔ قدیمی را با برنامه مستند جدید جایگزین می‌کند.
- فایل ورودی علاوه بر MIME اعلام‌شده با Magic Byte بررسی می‌شود؛ فایل باینریِ تغییرنام‌داده‌شده به متن قبل از مدل رد می‌شود.
- Dashboard «صورت‌وضعیت اجرا» از منوی تاریخچه قابل مشاهده است و پس از restart از صفر شروع می‌شود.
- هزینه با نرخ استاندارد Gemini 3.5 Flash-Lite محاسبه می‌شود و نرخ‌ها از `GEMINI_INPUT_USD_PER_MILLION` و `GEMINI_OUTPUT_USD_PER_MILLION` قابل تنظیم‌اند.

در استقرار پشت reverse proxy، `TRUSTED_PROXY_HOPS` باید دقیقاً برابر تعداد proxyهای مورد اعتماد تا برنامه تنظیم شود. مقدار پیش‌فرض `0` عمداً تمام headerهای IP قابل‌جعل را نادیده می‌گیرد؛ با مقدار درست، بودجه هم‌زمان روی visitor و IP اعمال می‌شود.

## Golden Set و اثبات کیفیت

`data/retrieval-golden-set.json` شامل دقیقاً ۱۳۰ سناریوی نسخه‌بندی‌شده بر اساس §23 PRD است: ۳۵ سؤال مستقیم، ۲۵ چندمرحله‌ای، ۲۰ عیب‌یابی، ۱۵ نیازمند clarification، ۱۰ خارج از پوشش، ۱۰ escalation، ۵ تعارض نسخه و ۱۰ prompt-injection/Secret. قرارداد هر سناریو intent، منابع و headingهای مورد انتظار، factهای لازم، ادعاهای ممنوع، confidence، clarification و escalation را ثبت می‌کند.

ارزیابی ماشینی Recall@8، رسمی‌بودن URL، precision و coverage ارجاع، عدم نشت citation نامعتبر، کیفیت سؤال تکمیلی، fail-closed برای موضوع خارج از داک و محافظت end-to-end از Secret را کنترل می‌کند. Workflow همگام‌سازی داک بدون پاس‌شدن این مجموعه اجازه commit ایندکس جدید را نمی‌دهد.

روی corpus فعلی (`31f2ef7`)، Recall@8 سندی ۱۰۰٪ است: هر ۱۲۳ سند مورد انتظار در ۹۵ سناریوی دارای منبع بازیابی شده و complete-scenario rate نیز ۱۰۰٪ است. Citation precision و coverage هر دو ۱۰۰٪ و invalid-citation leakage صفر ثبت شده‌اند.

## Docker

```bash
docker build -t liara-docs-assistant .
docker run --rm -p 3000:3000 --env-file .env.local liara-docs-assistant
```

Image چندمرحله‌ای است و Process نهایی با کاربر non-root اجرا می‌شود. استقرار مستقیم Next.js نیز با `liara.json` موجود قابل انجام است.

فایل `.dockerignore`، Secretهای محلی، `node_modules`، خروجی تست، artifactهای ارزیابی و اسناد توسعه را از build context حذف می‌کند. Image دارای health check داخلی روی `/healthz` است و برنامه روی پورت `3000` گوش می‌دهد.

## استقرار روی لیارا

پروژه از هر دو مسیر رسمی لیارا آماده است:

1. **پلتفرم NextJS:** نسخه Node.js را روی `20` قرار دهید (حداقل `20.19`). این نسخه از خطای شناخته‌شده `npm ci` در runtimeهای Node 22/24 جلوگیری می‌کند. لیارا وابستگی‌ها را نصب و اسکریپت‌های `build` و `start` موجود در `package.json` را اجرا می‌کند.
2. **پلتفرم Docker:** همین `Dockerfile` را با پورت `3000` مستقر کنید. خروجی نهایی standalone و non-root است.

Secretها را فقط در بخش متغیرهای محیطی برنامه تنظیم کنید؛ `.env.local` نباید آپلود یا commit شود. حداقل یکی از تنظیمات Provider زیر لازم است:

```dotenv
MODEL_PROVIDER=avalai
AVALAI_API_KEY=...
```

یا:

```dotenv
MODEL_PROVIDER=gemini
GEMINI_API_KEY=...
```

پس از استقرار، این smoke testها باید موفق باشند:

```bash
curl --fail https://<app-id>.liara.run/healthz
curl --fail https://<app-id>.liara.run/readyz
curl --fail https://<app-id>.liara.run/api/docs/status
```

- مخزن GitHub: https://github.com/iTzYasin/liara
- URL نهایی Liara: پس از ساخت برنامه، مقدار `<app-id>` بالا را با شناسه واقعی جایگزین کنید.

راهنمای رسمی: [استقرار NextJS در لیارا](https://docs.liara.ir/paas/nextjs/how-tos/deploy-app/) و [استقرار Docker در لیارا](https://docs.liara.ir/paas/docker/how-tos/deploy-app/).

جزئیات محصول، معیارهای پذیرش، مسیر دمو و اولویت‌ها در [PRD](./PRD-liara-assistant.md) آمده است.
