import type { SourceDocument } from "@/modules/chat/types";
import type { DocsRetriever, RetrievalResult } from "@/modules/retrieval/docs-retriever";

interface MeilisearchHit {
  id: string;
  title: string;
  heading: string;
  breadcrumb?: string[];
  service: string;
  url: string;
  path: string;
  text: string;
  _rankingScore?: number;
}

interface MeilisearchOptions {
  url: string;
  apiKey?: string;
  indexUid: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

export class MeilisearchDocsRetriever implements DocsRetriever {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: MeilisearchOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.baseUrl = options.url.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 2_500;
  }

  private headers() {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (this.options.apiKey) headers.set("Authorization", `Bearer ${this.options.apiKey}`);
    return headers;
  }

  async retrieve(query: string, limit = 8): Promise<RetrievalResult> {
    const response = await this.fetcher(
      `${this.baseUrl}/indexes/${encodeURIComponent(this.options.indexUid)}/search`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          q: query,
          limit,
          showRankingScore: true,
          attributesToRetrieve: [
            "id", "title", "heading", "breadcrumb", "service", "url", "path", "text",
          ],
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );
    if (!response.ok) throw new Error(`Meilisearch search failed with status ${response.status}`);
    const payload = await response.json() as { hits?: MeilisearchHit[] };
    const seenPaths = new Set<string>();
    const hits = (payload.hits ?? []).filter((hit) => {
      if (seenPaths.has(hit.path)) return false;
      seenPaths.add(hit.path);
      return true;
    }).slice(0, limit);
    const sources: SourceDocument[] = hits.map((hit, index) => ({
      id: hit.id,
      citationIndex: index + 1,
      title: hit.title,
      heading: hit.heading,
      breadcrumb: hit.breadcrumb?.length ? hit.breadcrumb : [hit.service, hit.title, hit.heading],
      service: hit.service,
      path: hit.path,
      url: hit.url,
      snippet: hit.text.replace(/\s+/g, " ").slice(0, 360),
      score: Number(((hit._rankingScore ?? 0) * 100).toFixed(2)),
    }));
    const topRankingScore = hits[0]?._rankingScore ?? 0;
    return {
      sources,
      context: hits.map((hit) => ({ sourceId: hit.id, text: hit.text.slice(0, 3_400) })),
      topScore: Number((topRankingScore * 100).toFixed(2)),
      queryCoverage: topRankingScore,
      domainMatched: topRankingScore >= 0.35,
    };
  }

  async status() {
    const response = await this.fetcher(`${this.baseUrl}/health`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Meilisearch health failed with status ${response.status}`);
    return { ready: true, documents: 0, chunks: 0, sourceCommit: "meilisearch", backend: "meilisearch" as const };
  }
}

/** Keeps the committed index as the last-known-good search path. */
export class ResilientDocsRetriever implements DocsRetriever {
  constructor(
    private readonly primary: DocsRetriever,
    private readonly fallback: DocsRetriever,
  ) {}

  async retrieve(query: string, limit?: number) {
    try {
      return await this.primary.retrieve(query, limit);
    } catch {
      return this.fallback.retrieve(query, limit);
    }
  }

  async status() {
    try {
      const primary = await this.primary.status();
      if (primary.ready) {
        const corpus = await this.fallback.status();
        return corpus.ready
          ? { ...corpus, backend: "meilisearch" as const }
          : primary;
      }
    } catch {
      // A healthy local index is sufficient for readiness in degraded mode.
    }
    const fallback = await this.fallback.status();
    return { ...fallback, backend: "local-fallback" as const };
  }
}
