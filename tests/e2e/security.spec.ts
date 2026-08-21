import { expect, test } from "@playwright/test";

test("serves a fresh strict nonce CSP on every document response", async ({ request }) => {
  const first = await request.get("/");
  const second = await request.get("/");
  const firstPolicy = first.headers()["content-security-policy"] ?? "";
  const secondPolicy = second.headers()["content-security-policy"] ?? "";
  const firstNonce = firstPolicy.match(/'nonce-([^']+)'/)?.[1];
  const secondNonce = secondPolicy.match(/'nonce-([^']+)'/)?.[1];

  expect(first.status()).toBe(200);
  expect(firstPolicy).toContain("script-src 'self'");
  expect(firstPolicy).toContain("'strict-dynamic'");
  expect(firstPolicy).toContain("script-src-attr 'none'");
  expect(firstPolicy).not.toContain("'unsafe-inline'");
  expect(firstNonce).toBeTruthy();
  expect(secondNonce).toBeTruthy();
  expect(secondNonce).not.toBe(firstNonce);
});

test("issues an HttpOnly signed visitor cookie before parsing an invalid chat body", async ({ request }) => {
  const response = await request.post("/api/chat", { data: {} });
  const cookie = response.headers()["set-cookie"] ?? "";

  expect(response.status()).toBe(422);
  expect(cookie).toMatch(/^liara_visitor=[0-9a-f-]{36}\.[A-Za-z0-9_-]+;/i);
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Lax");
});
