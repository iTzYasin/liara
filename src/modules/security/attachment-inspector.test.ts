import { describe, expect, it } from "vitest";
import {
  detectBinaryMime,
  inspectAttachmentContent,
} from "@/modules/security/attachment-inspector";

describe("attachment content inspection", () => {
  it("detects supported binary types from magic bytes", () => {
    expect(detectBinaryMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
      .toBe("image/png");
    expect(detectBinaryMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])))
      .toBe("image/jpeg");
    expect(detectBinaryMime(new TextEncoder().encode("%PDF-1.7")))
      .toBe("application/pdf");
  });

  it("rejects an image whose declared MIME does not match its bytes", () => {
    const result = inspectAttachmentContent({
      id: "spoofed",
      name: "error.png",
      mimeType: "image/png",
      size: 5,
      kind: "image",
      content: "data:image/png;base64,aGVsbG8=",
    });

    expect(result).toMatchObject({ valid: false, reason: "mime-signature-mismatch" });
  });

  it("rejects binary control characters disguised as a text file", () => {
    const result = inspectAttachmentContent({
      id: "binary",
      name: "app.log",
      mimeType: "text/plain",
      size: 4,
      kind: "text",
      content: "safe\u0000binary",
    });

    expect(result).toMatchObject({ valid: false, reason: "binary-text-content" });
  });
});
