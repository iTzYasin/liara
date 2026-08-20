import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SourceDocument } from "@/modules/chat/types";
import { LruTtlCache } from "@/modules/infra/lru-ttl-cache";

export interface RetrievalResult {
  sources: SourceDocument[];
  /** Full retrieved chunks stay server-side; the client only receives short source snippets. */
  context: Array<{ sourceId: string; text: string }>;
  topScore: number;
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
  }>;
}

interface DocsChunk {
  id: string;
  title: string;
  heading: string;
  service: string;
  url: string;
  path: string;
  text: string;
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
  "من",
  "ما",
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
};

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
      tokens: new Set(tokenize(`${chunk.title} ${chunk.heading} ${chunk.text}`)),
    }));
  }

  async retrieve(query: string, limit = 8): Promise<RetrievalResult> {
    const normalizedQuery = normalizePersian(query);
    const queryTokens = tokenize(query);
    const scored = this.prepared
      .map((chunk) => {
        let score = 0;
        if (normalizedQuery.length > 3) {
          if (chunk.normalizedTitle.includes(normalizedQuery)) score += 44;
          if (chunk.normalizedHeading.includes(normalizedQuery)) score += 36;
          if (chunk.normalizedText.includes(normalizedQuery)) score += 18;
        }
        for (const token of queryTokens) {
          if (chunk.normalizedTitle.includes(token)) score += 12;
          if (chunk.normalizedHeading.includes(token)) score += 9;
          if (chunk.tokens.has(token)) score += 4;
          score += Math.min(occurrenceCount(chunk.normalizedText, token), 3) * 1.5;
        }
        return { chunk, score };
      })
      .filter((item) => item.score > 2)
      .sort((a, b) => b.score - a.score);

    const seen = new Set<string>();
    const sources: SourceDocument[] = [];
    const context: RetrievalResult["context"] = [];
    for (const item of scored) {
      const identity = `${item.chunk.url}|${item.chunk.heading}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      sources.push({
        id: item.chunk.id,
        citationIndex: sources.length + 1,
        title: item.chunk.title,
        heading: item.chunk.heading,
        service: item.chunk.service,
        url: item.chunk.url,
        snippet: item.chunk.text.replace(/\s+/g, " ").slice(0, 360),
        score: Number(item.score.toFixed(2)),
      });
      context.push({ sourceId: item.chunk.id, text: item.chunk.text.slice(0, 3_400) });
      if (sources.length >= limit) break;
    }
    return { sources, context, topScore: sources[0]?.score ?? 0 };
  }

  async status() {
    return { ready: true, ...this.metadata };
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
      return { ready: false, documents: 0, chunks: 0, sourceCommit: "unknown", generatedAt: undefined };
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
  singleton ??= new CachedDocsRetriever(new FileDocsRetriever());
  return singleton;
}
