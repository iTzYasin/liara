import { describe, expect, it } from "vitest";
import { CachedDocsRetriever, InMemoryDocsRetriever, normalizePersian, tokenize } from "@/modules/retrieval/docs-retriever";

const chunks = [
  {
    id: "domain",
    title: "اتصال دامنه به برنامه",
    heading: "تنظیم رکوردهای DNS",
    breadcrumb: ["پلتفرم ابری", "دامنه", "تنظیم رکوردهای DNS"],
    content_hash: "hash-domain",
    service: "paas",
    url: "https://docs.liara.ir/paas/domains",
    path: "paas/domains.md",
    text: "برای اتصال دامنه ابتدا رکورد DNS را تنظیم و سپس وضعیت دامنه را بررسی کنید.",
  },
  {
    id: "database",
    title: "اتصال به PostgreSQL",
    heading: "متغیرهای محیطی",
    breadcrumb: ["دیتابیس", "PostgreSQL", "متغیرهای محیطی"],
    content_hash: "hash-database",
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
    expect(result.sources[0].breadcrumb).toEqual(["پلتفرم ابری", "دامنه", "تنظیم رکوردهای DNS"]);
    expect(result.sources[0].score).toBeGreaterThan(result.sources[1]?.score ?? 0);
  });

  it("does not treat Persian conversational filler as missing evidence", async () => {
    const retriever = new InMemoryDocsRetriever(chunks);
    const result = await retriever.retrieve("برای اتصال دامنه به برنامه لیارا باید چه کار کنم؟", 2);
    expect(result.sources[0]).toMatchObject({ id: "domain" });
    expect(result.queryCoverage).toBeGreaterThanOrEqual(0.75);
  });

  it("routes a domain plus SSL setup question to PaaS instead of a bucket domain page", async () => {
    const retriever = new InMemoryDocsRetriever([
      {
        id: "bucket-domain",
        title: "اضافه کردن دامنه خریداری شده به باکت",
        heading: "دامنه باکت",
        service: "object-storage",
        url: "https://docs.liara.ir/object-storage/domain",
        path: "object-storage/how-tos/add-domain.md",
        text: "دامنه خریداری‌شده را به باکت اضافه کنید.",
      },
      {
        id: "app-domain",
        title: "اضافه کردن دامنه خریداری شده به برنامه",
        heading: "افزودن دامنه",
        service: "paas",
        url: "https://docs.liara.ir/paas/domains/add-domain",
        path: "paas/domains/add-domain.md",
        text: "دامنه را به برنامه اضافه کنید.",
      },
      {
        id: "app-ssl",
        title: "فعال‌سازی SSL دامنه برنامه",
        heading: "فعال‌سازی SSL",
        service: "paas",
        url: "https://docs.liara.ir/paas/domains/enable-ssl",
        path: "paas/domains/enable-ssl.md",
        text: "پس از افزودن دامنه SSL را فعال کنید.",
      },
    ]);

    const result = await retriever.retrieve("چطور دامنه را اضافه کنم و بعد SSL را فعال کنم؟", 3);

    expect(result.sources.slice(0, 2).map((source) => source.service)).toEqual(["paas", "paas"]);
    expect(result.sources.slice(0, 2).map((source) => source.path)).toEqual(
      expect.arrayContaining(["paas/domains/add-domain.md", "paas/domains/enable-ssl.md"]),
    );
  });

  it("reports low evidence coverage for a question outside the docs domain", async () => {
    const retriever = new InMemoryDocsRetriever(chunks);
    const result = await retriever.retrieve("رزرو بلیت قطار برای سفر خانوادگی");
    expect(result.queryCoverage).toBeLessThan(0.35);
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
