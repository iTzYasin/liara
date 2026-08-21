import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SourceDocument } from "@/modules/chat/types";
import { LruTtlCache } from "@/modules/infra/lru-ttl-cache";
import { MeilisearchDocsRetriever, ResilientDocsRetriever } from "@/modules/retrieval/meilisearch-retriever";

export interface RetrievalResult {
  sources: SourceDocument[];
  /** Full retrieved chunks stay server-side; the client only receives short source snippets. */
  context: Array<{ sourceId: string; text: string }>;
  topScore: number;
  queryCoverage: number;
  domainMatched: boolean;
  cacheHit?: boolean;
}

export interface DocsRetriever {
  retrieve(query: string, limit?: number): Promise<RetrievalResult>;
  status(): Promise<{
    ready: boolean;
    documents: number;
    chunks: number;
    sourceCommit: string;
    generatedAt?: string;
    backend?: "local" | "meilisearch" | "local-fallback";
  }>;
}

interface DocsChunk {
  id: string;
  title: string;
  heading: string;
  breadcrumb?: string[];
  service: string;
  url: string;
  path: string;
  text: string;
  content_hash?: string;
}

interface DocsIndex {
  generatedAt?: string;
  documentCount: number;
  chunkCount: number;
  sourceCommit: string;
  chunks: DocsChunk[];
}

interface PreparedChunk extends DocsChunk {
  normalizedTitle: string;
  normalizedHeading: string;
  normalizedText: string;
  normalizedPath: string;
  titleTokens: Set<string>;
  headingTokens: Set<string>;
  pathTokens: Set<string>;
  tokens: Set<string>;
}

interface DocsMetadata {
  documents: number;
  chunks: number;
  sourceCommit: string;
  generatedAt?: string;
}

const stopWords = new Set([
  "از",
  "به",
  "در",
  "با",
  "برای",
  "که",
  "را",
  "این",
  "آن",
  "یک",
  "می",
  "شود",
  "شده",
  "است",
  "هست",
  "چطور",
  "چگونه",
  "چیست",
  "کجاست",
  "کدام",
  "روش",
  "راهنما",
  "مستند",
  "مرتبط",
  "مراحل",
  "لیارا",
  "سرویس",
  "برنامه",
  "پروژه",
  "من",
  "ما",
  "باید",
  "چه",
  "کار",
  "کنم",
  "کنید",
  "بکنم",
  "بگو",
  "بده",
  "توضیح",
  "ده",
  "لطفا",
  "خواهم",
  "میخواهم",
  "فقط",
  "طبق",
  "براساس",
  "the",
  "a",
  "an",
  "to",
  "of",
  "and",
  "is",
  "in",
  "on",
  "for",
]);

const synonyms: Record<string, string[]> = {
  env: ["environment", "متغیر", "محیطی"],
  deploy: ["deployment", "استقرار"],
  domain: ["دامنه", "dns"],
  database: ["دیتابیس", "پایگاه", "داده"],
  log: ["لاگ", "گزارش"],
  error: ["خطا", "ارور", "مشکل"],
  bucket: ["باکت", "فضای", "ذخیره"],
  email: ["ایمیل", "mail", "smtp"],
  nextjs: ["next", "next.js", "نکست"],
  nodejs: ["node", "node.js", "نود"],
  wordpress: ["وردپرس"],
  postgresql: ["postgres", "پستگرس"],
  meilisearch: ["میلی", "میلی‌سرچ"],
  health: ["سلامت", "healthcheck"],
  shell: ["کنسول", "terminal", "ترمینال"],
  downtime: ["قطعی"],
  static: ["ثابت"],
  ip: ["آیپی", "آی‌پی"],
  disk: ["disks", "دیسک"],
  create: ["ساخت", "بسازم", "ایجاد", "اضافه"],
  backup: ["بکاپ", "پشتیبان"],
  restore: ["بازیابی", "برگردانم"],
  key: ["keys", "کلید"],
  monitoring: ["monitorings", "مانیتورینگ", "گزارشات", "پایش"],
  embedding: ["embeddings", "بردارسازی"],
  compose: ["کامپوز"],
  permission: ["دسترسی", "مجوز"],
  spam: ["هرزنامه"],
  connection: ["اتصال"],
  pool: ["استخر"],
  version: ["نسخه"],
  record: ["رکورد"],
  user: ["کاربر"],
  add: ["افزودن", "اضافه", "بسازم", "ساخت"],
  port: ["ports", "پورت"],
  supported: ["پشتیبانی", "پشتیبانی‌شده"],
  common: ["رایج"],
};

function inferServiceHints(query: string) {
  const normalized = normalizePersian(query);
  const hints = new Set<string>();
  if (/هوش مصنوعی|\bai\b|ai sdk|مدل/.test(normalized)) hints.add("ai");
  if (/ایمیل|smtp|imap|pop3|dmarc|spam/.test(normalized)) hints.add("email-server");
  if (/object storage|باکت|ذخیره سازی/.test(normalized)) hints.add("object-storage");
  if (/\bpaas\b|پلتفرم ابری|برنامه پلتفرمی|استقرار برنامه/.test(normalized)) hints.add("paas");
  if (/wordpress|وردپرس|liara.compose|برنامه آماده|meilisearch|n8n|headless chrome/.test(normalized)) hints.add("one-click-apps");
  if (/سرور (?:مجازی|ابری)|\bvps\b|\bssh\b|ubuntu|debian/.test(normalized)) hints.add("iaas");
  if (/سامانه dns|رکورد dns|wildcard dns/.test(normalized)) hints.add("dns-management-system");
  if (/\bcli\b|رابط خط فرمان/.test(normalized)) hints.add("references");
  if (
    /دیتابیس|database|postgres|mysql|mongodb|redis|rabbitmq|connection pool|بکاپ.*(?:postgres|redis|دیتابیس)|(?:postgres|redis|دیتابیس).*بکاپ/.test(normalized)
  ) hints.add("dbaas");
  return hints;
}

const pathIntentRules: Array<{ query: RegExp; path: RegExp; weight?: number }> = [
  {
    query: /(?=.*(?:اضافه|افزودن))(?=.*دامنه)(?=.*(?:\bssl\b|گواهی))/,
    path: /^paas domains add domain md$/,
    weight: 700,
  },
  {
    query: /(?=.*(?:اضافه|افزودن))(?=.*دامنه)(?=.*(?:\bssl\b|گواهی))/,
    path: /^paas domains enable ssl md$/,
    weight: 700,
  },
  { query: /بکاپ|پشتیبان|backup/, path: /\bcreate backup\b/ },
  { query: /بکاپ کامل|full backup/, path: /\btake full backup\b/ },
  { query: /بازیابی|restore|برگردان/, path: /\brestore\b/ },
  { query: /\bssl\b|گواهی/, path: /\benable ssl\b/ },
  { query: /\benv\b|envها|متغیر.{0,8}محیطی/, path: /\bset envs?\b|\benvs md\b/ },
  { query: /registry|رجیستری|image خصوصی/, path: /\bprivate registry\b/ },
  { query: /مانیتورینگ|monitoring|گزارشات/, path: /\bmonitorings?\b/ },
  { query: /liara[ .-]?compose|کامپوز/, path: /\bliara compose\b/ },
  { query: /connection pool|اتصال.{0,16}پر|ارتباط.{0,16}پر/, path: /\bconnection pool\b/, weight: 700 },
  { query: /رشته اتصال|لینک.{0,8}اتصال|connection string/, path: /\bconnection links\b/, weight: 700 },
  { query: /مدل.{0,20}پشتیبانی|supported models?/, path: /^ai about md$/ },
  { query: /(?:password|رمز).{0,80}smtp|smtp.{0,80}(?:password|رمز)/, path: /\badd smtp user\b/ },
  { query: /کلید|api key/, path: /\b(?:keys?|create key|generate new key)\b/ },
  { query: /اولین درخواست|نخستین درخواست|شروع سریع|quick start/, path: /\bquick start\b/ },
  { query: /streaming|استریم/, path: /\bfoundations streaming\b/ },
  { query: /php.{0,24}(?:محدودیت|تنظیم)|(?:محدودیت|تنظیم).{0,24}php/, path: /\bcustomize php ini\b/ },
  { query: /node\.?js|نود/, path: /\bconnect via platform nodejs\b/ },
  { query: /cron|کران/, path: /\bset cron job\b/ },
  { query: /کاربر.{0,24}(?:بساز|جدید|ایجاد)|(?:ساخت|ایجاد).{0,24}کاربر/, path: /\bcreate user\b/ },
  { query: /postgresql|postgres|پستگرس/, path: /\bpostgresql\b/ },
  { query: /mongodb|مونگو/, path: /\bmongodb\b/ },
  { query: /\bredis\b|ردیس/, path: /\bredis\b/ },
  { query: /\bssh\b/, path: /\bconnect to server using ssh\b/ },
  { query: /ubuntu|اوبونتو/, path: /\bubuntu\b/ },
  { query: /دسترسی بده|اعطای دسترسی|privilege/, path: /\bgrant privileges to user\b/ },
  { query: /آپلود|upload/, path: /\bupload file\b/ },
  { query: /محدودیت|limitation/, path: /\bmanage limitations\b/ },
  { query: /ویرایش.{0,40}رکورد|رکورد.{0,40}ویرایش|مدیریت.{0,24}رکورد/, path: /\bmanage records\b/ },
  { query: /accessdenied|دسترسی.{0,16}دانلود|\b403\b/, path: /\bchange access level\b/ },
];

function pathIntentBoost(normalizedQuery: string, normalizedPath: string) {
  return pathIntentRules.reduce(
    (score, rule) => score + (rule.query.test(normalizedQuery) && rule.path.test(normalizedPath) ? rule.weight ?? 280 : 0),
    0,
  );
}

export function normalizePersian(value: string) {
  return value
    .toLowerCase()
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[ۀة]/g, "ه")
    .replace(/[ؤ]/g, "و")
    .replace(/[إأٱ]/g, "ا")
    .replace(/[\u064b-\u065f\u0670]/g, "")
    .replace(/\u200c/g, " ")
    .replace(/[^\p{L}\p{N}._+/#-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(value: string) {
  const normalized = normalizePersian(value);
  const base = normalized
    .split(" ")
    .filter((token) => token.length > 1 && !stopWords.has(token));
  const expanded = new Set(base);
  for (const token of base) {
    const tokenSynonyms = Object.hasOwn(synonyms, token) ? synonyms[token] : [];
    for (const synonym of tokenSynonyms) expanded.add(synonym);
    for (const [key, values] of Object.entries(synonyms)) {
      if (values.includes(token)) expanded.add(key);
    }
  }
  return [...expanded];
}

function occurrenceCount(haystack: string, needle: string) {
  if (!needle) return 0;
  let count = 0;
  let position = 0;
  while ((position = haystack.indexOf(needle, position)) !== -1 && count < 4) {
    count += 1;
    position += needle.length;
  }
  return count;
}

export class InMemoryDocsRetriever implements DocsRetriever {
  private readonly prepared: PreparedChunk[];

  constructor(
    chunks: DocsChunk[],
    private readonly metadata: DocsMetadata = {
      documents: chunks.length,
      chunks: chunks.length,
      sourceCommit: "test",
    },
  ) {
    this.prepared = chunks.map((chunk) => ({
      ...chunk,
      normalizedTitle: normalizePersian(chunk.title),
      normalizedHeading: normalizePersian(chunk.heading),
      normalizedText: normalizePersian(chunk.text),
      normalizedPath: normalizePersian(chunk.path.replace(/[\\/_.-]+/g, " ")),
      titleTokens: new Set(tokenize(chunk.title)),
      headingTokens: new Set(tokenize(chunk.heading)),
      pathTokens: new Set(tokenize(chunk.path.replace(/[\\/_.-]+/g, " "))),
      tokens: new Set(tokenize(`${chunk.title} ${chunk.heading} ${chunk.text}`)),
    }));
  }

  async retrieve(query: string, limit = 8): Promise<RetrievalResult> {
    const normalizedQuery = normalizePersian(query);
    const baseQueryTokens = normalizedQuery
      .split(" ")
      .filter((token) => token.length > 1 && !stopWords.has(token));
    const queryTokens = tokenize(query);
    const serviceHints = inferServiceHints(query);
    const scored = this.prepared
      .map((chunk) => {
        let score = 0;
        // An explicit service name is a routing constraint, not a weak keyword.
        // Strong separation prevents similarly worded domain/backup pages from
        // leaking across PaaS, VPS, database, and object-storage products.
        if (serviceHints.has(chunk.service)) score += 80;
        else if (serviceHints.size === 1) score -= 220;
        score += pathIntentBoost(normalizedQuery, chunk.normalizedPath);
        if (normalizedQuery.length > 3) {
          if (chunk.normalizedTitle.includes(normalizedQuery)) score += 44;
          if (chunk.normalizedHeading.includes(normalizedQuery)) score += 36;
          if (chunk.normalizedText.includes(normalizedQuery)) score += 18;
        }
        for (const token of queryTokens) {
          if (chunk.titleTokens.has(token)) score += 16;
          if (chunk.headingTokens.has(token)) score += 13;
          if (chunk.pathTokens.has(token)) score += 28;
          else if (token.length >= 4 && chunk.normalizedPath.includes(token)) score += 7;
          if (chunk.tokens.has(token)) score += 4;
          if (token.length >= 3) {
            score += Math.min(occurrenceCount(chunk.normalizedText, token), 3) * 1.25;
          }
        }
        const titleCoverage = queryTokens.filter((token) => chunk.titleTokens.has(token)).length;
        const headingCoverage = queryTokens.filter((token) => chunk.headingTokens.has(token)).length;
        score += titleCoverage * titleCoverage * 2;
        score += headingCoverage * headingCoverage * 3;
        return { chunk, score };
      })
      .filter((item) => item.score > 2)
      .sort((a, b) => b.score - a.score);

    const seen = new Set<string>();
    const sources: SourceDocument[] = [];
    const context: RetrievalResult["context"] = [];
    const selectedChunks: PreparedChunk[] = [];
    for (const item of scored) {
      // One best section per canonical document prevents a long page from
      // occupying most of top-k and satisfies the PRD's source deduplication rule.
      const identity = item.chunk.path;
      if (seen.has(identity)) continue;
      seen.add(identity);
      sources.push({
        id: item.chunk.id,
        citationIndex: sources.length + 1,
        title: item.chunk.title,
        heading: item.chunk.heading,
        breadcrumb: item.chunk.breadcrumb?.length
          ? item.chunk.breadcrumb
          : [item.chunk.service, item.chunk.title, item.chunk.heading],
        service: item.chunk.service,
        path: item.chunk.path,
        url: item.chunk.url,
        snippet: item.chunk.text.replace(/\s+/g, " ").slice(0, 360),
        score: Number(item.score.toFixed(2)),
      });
      context.push({ sourceId: item.chunk.id, text: item.chunk.text.slice(0, 3_400) });
      selectedChunks.push(item.chunk);
      if (sources.length >= limit) break;
    }
    const coveredQueryTokens = baseQueryTokens.filter((token) => {
      const variants = tokenize(token);
      return selectedChunks.slice(0, 3).some((chunk) => variants.some((variant) =>
        chunk.titleTokens.has(variant) ||
        chunk.headingTokens.has(variant) ||
        chunk.pathTokens.has(variant) ||
        chunk.tokens.has(variant),
      ));
    }).length;
    const queryCoverage = baseQueryTokens.length
      ? coveredQueryTokens / baseQueryTokens.length
      : 0;
    const domainMatched = serviceHints.size > 0 ||
      /دامنه|deploy|استقرار|env|دیسک|بکاپ|api|ssl|cron|docker|next|node|لاراول|django|flask/.test(normalizedQuery);
    return { sources, context, topScore: sources[0]?.score ?? 0, queryCoverage, domainMatched };
  }

  async status() {
    return { ready: true, ...this.metadata, backend: "local" as const };
  }
}

export class FileDocsRetriever implements DocsRetriever {
  private adapter?: InMemoryDocsRetriever;
  private loading?: Promise<InMemoryDocsRetriever>;

  private async load() {
    if (this.adapter) return this.adapter;
    if (!this.loading) {
      this.loading = (async () => {
        const indexPath = path.join(process.cwd(), "data", "liara-docs-index.json");
        const raw = await readFile(indexPath, "utf8");
        const index = JSON.parse(raw) as DocsIndex;
        this.adapter = new InMemoryDocsRetriever(index.chunks, {
          documents: index.documentCount,
          chunks: index.chunkCount,
          sourceCommit: index.sourceCommit,
          generatedAt: index.generatedAt,
        });
        return this.adapter;
      })();
    }
    return this.loading;
  }

  async retrieve(query: string, limit?: number) {
    return (await this.load()).retrieve(query, limit);
  }

  async status() {
    try {
      return await (await this.load()).status();
    } catch {
      return { ready: false, documents: 0, chunks: 0, sourceCommit: "unknown", generatedAt: undefined, backend: "local" as const };
    }
  }
}

export class CachedDocsRetriever implements DocsRetriever {
  private readonly cache: LruTtlCache<string, RetrievalResult>;

  constructor(
    private readonly inner: DocsRetriever,
    maxEntries = 300,
    ttlMs = 10 * 60_000,
  ) {
    this.cache = new LruTtlCache(maxEntries, ttlMs);
  }

  async retrieve(query: string, limit = 8) {
    const key = `${limit}:${normalizePersian(query)}`;
    const cached = this.cache.get(key);
    if (cached) return { ...structuredClone(cached), cacheHit: true };
    const result = await this.inner.retrieve(query, limit);
    this.cache.set(key, structuredClone(result));
    return { ...result, cacheHit: false };
  }

  status() {
    return this.inner.status();
  }
}

let singleton: DocsRetriever | undefined;

export function getDocsRetriever() {
  if (!singleton) {
    const local = new FileDocsRetriever();
    const meiliUrl = process.env.MEILI_URL;
    const selected = meiliUrl
      ? new ResilientDocsRetriever(
          new MeilisearchDocsRetriever({
            url: meiliUrl,
            apiKey: process.env.MEILI_API_KEY,
            indexUid: process.env.MEILI_INDEX_UID ?? "liara_docs",
            timeoutMs: Number(process.env.MEILI_SEARCH_TIMEOUT_MS ?? 2_500),
          }),
          local,
        )
      : local;
    singleton = new CachedDocsRetriever(selected);
  }
  return singleton;
}
