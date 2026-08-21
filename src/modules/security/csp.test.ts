import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy } from "@/modules/security/csp";

describe("strict content security policy", () => {
  it("uses a per-request nonce and never allows unsafe inline scripts or styles", () => {
    const csp = buildContentSecurityPolicy("nonce-for-test", false);
    expect(csp).toContain("script-src 'self' 'nonce-nonce-for-test' 'strict-dynamic'");
    expect(csp).toContain("style-src 'self' 'nonce-nonce-for-test'");
    expect(csp).toContain("script-src-attr 'none'");
    expect(csp).toContain("style-src-attr 'none'");
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it("allows the style and eval capabilities required by the Next development runtime", () => {
    const csp = buildContentSecurityPolicy("dev-nonce", true);

    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain("style-src-attr 'none'");
  });
});
