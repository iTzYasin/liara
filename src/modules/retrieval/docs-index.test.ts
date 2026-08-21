import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileDocsRetriever } from "@/modules/retrieval/docs-retriever";

const docsRetriever = new FileDocsRetriever();

describe("versioned docs index", () => {
  it("keeps production builds read-only with respect to the committed corpus", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { scripts?: { build?: string } };

    expect(packageJson.scripts?.build).not.toContain("docs:index");
  });

  it("stores a stable content hash and breadcrumb on every chunk", async () => {
    const index = JSON.parse(
      await readFile(path.join(process.cwd(), "data", "liara-docs-index.json"), "utf8"),
    ) as {
      chunks: Array<{ content_hash?: string; breadcrumb?: string[]; text?: string }>;
    };

    expect(index.chunks.length).toBeGreaterThan(1_000);
    expect(index.chunks.every((chunk) => /^[a-f0-9]{32}$/.test(chunk.content_hash ?? ""))).toBe(true);
    expect(index.chunks.every((chunk) => (chunk.breadcrumb?.length ?? 0) >= 2)).toBe(true);
    expect(index.chunks.some((chunk) => /^Original link:/i.test(chunk.text ?? ""))).toBe(false);
  });

  it("keeps natural domain plus SSL wording inside the PaaS domain flow", async () => {
    const result = await docsRetriever.retrieve(
      "چطور دامنه را اضافه کنم و بعد SSL را فعال کنم؟",
      3,
    );

    expect(result.sources.slice(0, 2).map((source) => source.path)).toEqual(
      expect.arrayContaining(["paas/domains/add-domain.md", "paas/domains/enable-ssl.md"]),
    );
  }, 20_000);

  it("uses an explicit platform-app hint to exclude VPS and bucket domain docs", async () => {
    const result = await docsRetriever.retrieve(
      "منظورم فقط دامنه برنامه پلتفرمی و گواهی SSL است",
      3,
    );

    expect(result.sources[0]?.service).toBe("paas");
    expect(result.sources.slice(0, 3).every((source) => source.service === "paas")).toBe(true);
    expect(result.sources.map((source) => source.path)).toContain("paas/domains/enable-ssl.md");
  }, 20_000);
});
