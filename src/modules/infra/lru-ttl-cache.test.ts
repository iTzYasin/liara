import { describe, expect, it } from "vitest";
import { LruTtlCache } from "@/modules/infra/lru-ttl-cache";

describe("LruTtlCache", () => {
  it("expires values and evicts the least recently used entry", () => {
    const cache = new LruTtlCache<string, number>(2, 100);
    cache.set("a", 1, 0);
    cache.set("b", 2, 0);
    expect(cache.get("a", 20)).toBe(1);
    cache.set("c", 3, 20);
    expect(cache.get("b", 20)).toBeUndefined();
    expect(cache.get("a", 101)).toBeUndefined();
    expect(cache.get("c", 101)).toBe(3);
  });
});
