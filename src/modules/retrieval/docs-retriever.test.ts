import { describe, expect, it } from "vitest";
import { CachedDocsRetriever, InMemoryDocsRetriever, normalizePersian, tokenize } from "@/modules/retrieval/docs-retriever";

const chunks = [
  {
    id: "domain",
    title: "اتصال دامنه به برنامه",
    heading: "تنظیم رکوردهای DNS",
    service: "paas",
    url: "https://docs.liara.ir/paas/domains",
    path: "paas/domains.md",
    text: "برای اتصال دامنه ابتدا رکورد DNS را تنظیم و سپس وضعیت دامنه را بررسی کنید.",
  },
  {
    id: "database",
    title: "اتصال به PostgreSQL",
    heading: "متغیرهای محیطی",
    service: "dbaas",
    url: "https://docs.liara.ir/dbaas/postgresql",
    path: "dbaas/postgresql.md",
    text: "رشته اتصال دیتابیس را در متغیر محیطی قرار دهید.",
  },
];

describe("InMemoryDocsRetriever", () => {
  it("normalizes Arabic and Persian characters", () => {
    expect(normalizePersian("تنظيم  كليد")).toBe("تنظیم کلید");
  });

  it("expands bilingual domain terms", () => {
    expect(tokenize("domain")).toEqual(expect.arrayContaining(["domain", "دامنه", "dns"]));
  });

  it("returns the most relevant cited section", async () => {
    const retriever = new InMemoryDocsRetriever(chunks);
    const result = await retriever.retrieve("چطور domain را با DNS وصل کنم؟", 2);
    expect(result.sources[0]).toMatchObject({ id: "domain", citationIndex: 1 });
    expect(result.sources[0].score).toBeGreaterThan(result.sources[1]?.score ?? 0);
  });
});

describe("CachedDocsRetriever", () => {
  it("reuses a normalized retrieval result", async () => {
    const inner = new InMemoryDocsRetriever([chunks[0]]);
    const cached = new CachedDocsRetriever(inner);
    const first = await cached.retrieve("اتصال دامنه");
    const second = await cached.retrieve("اتصال  دامنه");
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(second.sources).toEqual(first.sources);
  });
});
