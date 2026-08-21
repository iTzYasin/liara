import { describe, expect, it } from "vitest";
import {
  MeilisearchDocsRetriever,
  ResilientDocsRetriever,
} from "@/modules/retrieval/meilisearch-retriever";
import { InMemoryDocsRetriever } from "@/modules/retrieval/docs-retriever";

describe("MeilisearchDocsRetriever", () => {
  it("maps ranked Meilisearch hits to the shared retrieval interface", async () => {
    const fetcher: typeof fetch = async () => Response.json({
      hits: [{
        id: "domain",
        title: "اتصال دامنه",
        heading: "تنظیم DNS",
        breadcrumb: ["پلتفرم ابری", "دامنه", "تنظیم DNS"],
        service: "paas",
        url: "https://docs.liara.ir/paas/domains",
        path: "paas/domains.md",
        text: "رکورد DNS را تنظیم کنید.",
        _rankingScore: 0.91,
      }],
    }) as Response;
    const retriever = new MeilisearchDocsRetriever({
      url: "http://search.internal",
      apiKey: "test-only",
      indexUid: "liara_docs",
      fetcher,
    });

    const result = await retriever.retrieve("اتصال دامنه", 8);
    expect(result.sources[0]).toMatchObject({
      id: "domain",
      path: "paas/domains.md",
      breadcrumb: ["پلتفرم ابری", "دامنه", "تنظیم DNS"],
    });
    expect(result.topScore).toBe(91);
    expect(result.domainMatched).toBe(true);
  });

  it("falls back to the committed local index when Meilisearch is unavailable", async () => {
    const primary = new MeilisearchDocsRetriever({
      url: "http://search.internal",
      indexUid: "liara_docs",
      fetcher: async () => new Response("unavailable", { status: 503 }),
    });
    const fallback = new InMemoryDocsRetriever([{
      id: "fallback",
      title: "دامنه",
      heading: "اتصال دامنه",
      breadcrumb: ["پلتفرم ابری", "دامنه"],
      service: "paas",
      url: "https://docs.liara.ir/paas/domains",
      path: "paas/domains.md",
      text: "اتصال دامنه با تنظیم رکورد انجام می‌شود.",
    }]);

    const result = await new ResilientDocsRetriever(primary, fallback).retrieve("اتصال دامنه");
    expect(result.sources[0].id).toBe("fallback");
  });
});
