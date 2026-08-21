import { describe, expect, it } from "vitest";
import { enforceCitationPolicy } from "@/modules/agent/citation-policy";
import type { SourceDocument } from "@/modules/chat/types";

const sources: SourceDocument[] = [
  {
    id: "domain",
    citationIndex: 1,
    title: "اتصال دامنه",
    heading: "تنظیم DNS",
    breadcrumb: ["پلتفرم ابری", "دامنه", "تنظیم DNS"],
    service: "paas",
    url: "https://docs.liara.ir/paas/domains",
    snippet: "رکورد DNS را تنظیم کنید.",
    score: 42,
  },
  {
    id: "env",
    citationIndex: 2,
    title: "متغیرهای محیطی",
    heading: "ثبت متغیر",
    breadcrumb: ["پلتفرم ابری", "تنظیمات", "متغیرهای محیطی"],
    service: "paas",
    url: "https://docs.liara.ir/paas/envs",
    snippet: "متغیر را در تنظیمات ثبت کنید.",
    score: 30,
  },
];

describe("enforceCitationPolicy", () => {
  it("removes a claim with an unknown citation before it reaches the user", () => {
    const result = enforceCitationPolicy(
      "دامنه با تنظیم DNS متصل می‌شود. [[1]]\n\nلیارا این قابلیت خیالی را هم دارد. [[99]]",
      sources,
    );

    expect(result.text).toContain("تنظیم DNS");
    expect(result.text).not.toContain("قابلیت خیالی");
    expect(result.text).not.toContain("[[99]]");
    expect(result.sources).toHaveLength(1);
    expect(result.invalidCitationCount).toBe(1);
    expect(result.confidence).toBe("medium");
  });

  it("replaces an entirely ungrounded answer with a controlled refusal", () => {
    const result = enforceCitationPolicy("لیارا به‌صورت قطعی این قابلیت را ارائه می‌کند.", sources);

    expect(result.text).toContain("ارجاع معتبر");
    expect(result.text).not.toContain("به‌صورت قطعی");
    expect(result.sources).toEqual([]);
    expect(result.invalidCitationCount).toBeGreaterThan(0);
    expect(result.confidence).toBe("low");
  });

  it("renumbers used sources and removes retrieved-but-unused sources", () => {
    const result = enforceCitationPolicy("متغیر محیطی را از تنظیمات ثبت کنید. [[2]]", sources);

    expect(result.text).toContain("[[1]]");
    expect(result.text).not.toContain("[[2]]");
    expect(result.sources).toEqual([
      expect.objectContaining({ id: "env", citationIndex: 1 }),
    ]);
    expect(result.invalidCitationCount).toBe(0);
    expect(result.confidence).toBe("high");
  });

  it("removes a malformed marker while preserving a claim with a valid citation", () => {
    const result = enforceCitationPolicy(
      "تنظیم DNS در مستندات لیارا توضیح داده شده است. [[S4]] [[1]]",
      sources,
    );

    expect(result.text).toContain("تنظیم DNS");
    expect(result.text).toContain("[[1]]");
    expect(result.text).not.toContain("[[S4]]");
    expect(result.invalidCitationCount).toBe(1);
    expect(result.sources).toHaveLength(1);
  });

  it("removes a provider-style combined malformed citation", () => {
    const result = enforceCitationPolicy(
      "متغیر محیطی را در تنظیمات لیارا ثبت کنید. [[2], [7]] [[2]]",
      sources,
    );

    expect(result.text).toContain("متغیر محیطی");
    expect(result.text).toContain("[[1]]");
    expect(result.text).not.toContain("[[2], [7]]");
    expect(result.invalidCitationCount).toBe(1);
    expect(result.sources).toEqual([expect.objectContaining({ id: "env" })]);
  });

  it("removes a heading when citation enforcement strips its only content", () => {
    const result = enforceCitationPolicy(
      [
        "دامنه را با تنظیم DNS متصل کنید. [[1]]",
        "### راهنمای عمومی خارج از مستندات لیارا",
        "لیارا بدون هیچ تنظیمی دامنه را خودکار متصل می‌کند.",
        "### قدم بعدی",
        "- وضعیت DNS را بررسی کنید. [[1]]",
      ].join("\n\n"),
      sources,
    );

    expect(result.text).not.toContain("### راهنمای عمومی خارج از مستندات لیارا");
    expect(result.text).toContain("### قدم بعدی");
  });
});
