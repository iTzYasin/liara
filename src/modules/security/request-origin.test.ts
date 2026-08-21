import { describe, expect, it } from "vitest";
import {
  isAllowedRequestOrigin,
  resolveApplicationOrigin,
} from "@/modules/security/request-origin";

describe("request origin policy", () => {
  it("allows same-origin and explicitly configured browser requests", () => {
    expect(isAllowedRequestOrigin("https://assistant.example", "https://assistant.example", ""))
      .toBe(true);
    expect(isAllowedRequestOrigin(
      "https://preview.example",
      "https://assistant.example",
      "https://preview.example",
    )).toBe(true);
  });

  it("blocks an unrelated browser origin but permits clients without Origin", () => {
    expect(isAllowedRequestOrigin("https://evil.example", "https://assistant.example", ""))
      .toBe(false);
    expect(isAllowedRequestOrigin(null, "https://assistant.example", "")).toBe(true);
  });

  it("uses the actual Host header and only trusts forwarded host when configured", () => {
    const headers = new Headers({
      host: "127.0.0.1:3000",
      "x-forwarded-host": "assistant.example",
      "x-forwarded-proto": "https",
    });

    expect(resolveApplicationOrigin(headers, "http:", 0)).toBe("http://127.0.0.1:3000");
    expect(resolveApplicationOrigin(headers, "http:", 1)).toBe("https://assistant.example");
  });
});
