import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { InMemoryDocsRetriever } from "@/modules/retrieval/docs-retriever";

interface GoldenCase {
  query: string;
  expectedService: string;
}

describe("versioned retrieval golden set", () => {
  it("retrieves the expected Liara product area in top 8", async () => {
    const index = JSON.parse(
      await readFile(path.join(process.cwd(), "data", "liara-docs-index.json"), "utf8"),
    ) as {
      documentCount: number;
      chunkCount: number;
      sourceCommit: string;
      chunks: ConstructorParameters<typeof InMemoryDocsRetriever>[0];
    };
    const cases = JSON.parse(
      await readFile(path.join(process.cwd(), "data", "retrieval-golden-set.json"), "utf8"),
    ) as GoldenCase[];
    const retriever = new InMemoryDocsRetriever(index.chunks, {
      documents: index.documentCount,
      chunks: index.chunkCount,
      sourceCommit: index.sourceCommit,
    });

    let hits = 0;
    for (const item of cases) {
      const result = await retriever.retrieve(item.query, 8);
      if (result.sources.some((source) => source.service === item.expectedService)) hits += 1;
      expect(result.sources.every((source) => source.url.startsWith("https://docs.liara.ir/"))).toBe(true);
    }

    const recallAt8 = hits / cases.length;
    expect(recallAt8).toBeGreaterThanOrEqual(0.9);
  });
});
