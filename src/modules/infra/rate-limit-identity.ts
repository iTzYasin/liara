import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export const VISITOR_COOKIE_NAME = "liara_visitor";

const processSecret = randomBytes(32).toString("base64url");

function signature(id: string, secret: string) {
  return createHmac("sha256", secret).update(id).digest("base64url");
}

function validSignature(id: string, candidate: string, secret: string) {
  const expected = signature(id, secret);
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface VisitorIdentity {
  id: string;
  cookieValue: string;
  isNew: boolean;
}

export function resolveVisitorIdentity(
  rawCookie: string | undefined,
  secret = process.env.RATE_LIMIT_IDENTITY_SECRET || processSecret,
): VisitorIdentity {
  if (rawCookie && rawCookie.length <= 200) {
    const separator = rawCookie.lastIndexOf(".");
    const id = rawCookie.slice(0, separator);
    const candidate = rawCookie.slice(separator + 1);
    if (/^[0-9a-f-]{36}$/i.test(id) && candidate && validSignature(id, candidate, secret)) {
      return { id, cookieValue: rawCookie, isNew: false };
    }
  }
  const id = randomUUID();
  return { id, cookieValue: `${id}.${signature(id, secret)}`, isNew: true };
}

export function serializeVisitorCookie(identity: VisitorIdentity, production: boolean) {
  return [
    `${VISITOR_COOKIE_NAME}=${identity.cookieValue}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=2592000",
    production ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

export function resolveClientAddress(headers: Headers, trustedProxyHops: number) {
  const hops = Number.isInteger(trustedProxyHops)
    ? Math.min(10, Math.max(0, trustedProxyHops))
    : 0;
  if (!hops) return undefined;

  const forwarded = headers.get("x-forwarded-for")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean) ?? [];
  if (forwarded.length) {
    const candidate = forwarded[Math.max(0, forwarded.length - hops)];
    if (candidate && isIP(candidate)) return candidate;
  }
  const realIp = headers.get("x-real-ip")?.trim();
  return realIp && isIP(realIp) ? realIp : undefined;
}

export function rateLimitKeys(visitorId: string, headers: Headers, trustedProxyHops: number) {
  const keys = [`visitor:${visitorId}`];
  const address = resolveClientAddress(headers, trustedProxyHops);
  if (address) keys.push(`ip:${address}`);
  return keys;
}
