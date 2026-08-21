import { describe, expect, it } from "vitest";
import {
  InvalidJsonBodyError,
  readJsonBody,
  RequestBodyTooLargeError,
} from "@/modules/security/request-body";

describe("readJsonBody", () => {
  it("parses a UTF-8 JSON request within the byte limit", async () => {
    const request = new Request("https://example.test/api", {
      method: "POST",
      body: JSON.stringify({ message: "سلام" }),
    });

    await expect(readJsonBody(request, 100)).resolves.toEqual({ message: "سلام" });
  });

  it("rejects a chunked body as soon as it exceeds the byte limit", async () => {
    const encoder = new TextEncoder();
    const request = new Request("https://example.test/api", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('{"message":"'));
          controller.enqueue(encoder.encode("too large"));
          controller.enqueue(encoder.encode('"}'));
          controller.close();
        },
      }),
      // Required by Node for a streaming request body; ignored by the Web API.
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(readJsonBody(request, 12)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });

  it("distinguishes malformed JSON from an oversized body", async () => {
    const request = new Request("https://example.test/api", {
      method: "POST",
      body: "not-json",
    });

    await expect(readJsonBody(request, 100)).rejects.toBeInstanceOf(InvalidJsonBodyError);
  });
});
