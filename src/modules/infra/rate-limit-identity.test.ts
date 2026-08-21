import { describe, expect, it } from "vitest";
import {
  resolveClientAddress,
  resolveVisitorIdentity,
  rateLimitKeys,
} from "@/modules/infra/rate-limit-identity";

describe("rate-limit identity", () => {
  it("ignores spoofable forwarding headers unless proxy trust is explicit", () => {
    const headers = new Headers({ "x-forwarded-for": "198.51.100.7" });
    expect(resolveClientAddress(headers, 0)).toBeUndefined();
    expect(rateLimitKeys("visitor-id", headers, 0)).toEqual(["visitor:visitor-id"]);
  });

  it("selects the untrusted client from the right of a validated proxy chain", () => {
    const headers = new Headers({
      "x-forwarded-for": "192.0.2.10, 203.0.113.20",
    });
    expect(resolveClientAddress(headers, 1)).toBe("203.0.113.20");
    expect(rateLimitKeys("visitor-id", headers, 1)).toEqual([
      "visitor:visitor-id",
      "ip:203.0.113.20",
    ]);
  });

  it("rejects a forged visitor cookie and mints a signed replacement", () => {
    const secret = "test-secret-with-enough-entropy";
    const forged = resolveVisitorIdentity("attacker.signature", secret);
    expect(forged.isNew).toBe(true);
    const verified = resolveVisitorIdentity(forged.cookieValue, secret);
    expect(verified).toMatchObject({ id: forged.id, isNew: false });
  });
});
