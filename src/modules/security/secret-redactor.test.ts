import { describe, expect, it } from "vitest";
import { redactSensitiveText } from "@/modules/security/secret-redactor";

describe("redactSensitiveText", () => {
  it("masks common credentials while preserving useful context", () => {
    const result = redactSensitiveText([
      "API_KEY=sk-this-is-a-long-secret-value-123456",
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
      "DATABASE_URL=postgres://user:super-secret@database.example/db",
    ].join("\n"));

    expect(result.text).not.toContain("this-is-a-long-secret");
    expect(result.text).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(result.text).not.toContain("super-secret");
    expect(result.text).toContain("API_KEY=[SECRET_");
    expect(result.text).toContain("postgres://user:[SECRET_");
    expect(result.count).toBeGreaterThanOrEqual(3);
  });

  it("does not mask normal commands and version numbers", () => {
    const input = "npm install @liara/cli && node --version v24.13.1";
    expect(redactSensitiveText(input)).toEqual({ text: input, count: 0, categories: [] });
  });

  it("masks private key blocks", () => {
    const result = redactSensitiveText(
      "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----",
    );
    expect(result.text).toBe("[SECRET_1]");
    expect(result.categories).toContain("private-key");
  });

  it("masks sensitive environment variables with service prefixes", () => {
    const result = redactSensitiveText([
      "AWS_SECRET_ACCESS_KEY=seeded-object-secret",
      "SMTP_PASSWORD=seeded-mail-secret",
      "LIARA_TOKEN=seeded-cli-token",
    ].join("\n"));

    expect(result.text).not.toMatch(/seeded-(?:object|mail|cli)-secret/);
    expect(result.text).toContain("AWS_SECRET_ACCESS_KEY=[SECRET_");
    expect(result.text).toContain("SMTP_PASSWORD=[SECRET_");
    expect(result.text).toContain("LIARA_TOKEN=[SECRET_");
    expect(result.count).toBe(3);
  });
});
