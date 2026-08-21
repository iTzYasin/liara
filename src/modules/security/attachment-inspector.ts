import type { ChatAttachment } from "@/modules/chat/types";

export type SupportedBinaryMime = "image/png" | "image/jpeg" | "image/webp" | "application/pdf";

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

export function detectBinaryMime(bytes: Uint8Array): SupportedBinaryMime | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46])
    && startsWith(bytes.slice(8), [0x57, 0x45, 0x42, 0x50])
  ) return "image/webp";
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  return undefined;
}

function dataUrlBytes(value: string) {
  const match = /^data:[^;,]+;base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) return undefined;
  try {
    const decoded = atob(match[1].slice(0, 64));
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}

export function inspectAttachmentContent(attachment: ChatAttachment): {
  valid: boolean;
  reason?: "mime-signature-mismatch" | "invalid-data-url" | "binary-text-content";
  detectedMime?: SupportedBinaryMime;
} {
  if (attachment.kind === "text") {
    const sample = attachment.content.slice(0, 8_192);
    const disallowedControls = [...sample].filter((character) => {
      const code = character.charCodeAt(0);
      return code === 0 || (code < 32 && ![9, 10, 13].includes(code));
    }).length;
    return disallowedControls > Math.max(0, sample.length * 0.01)
      ? { valid: false, reason: "binary-text-content" }
      : { valid: true };
  }

  const bytes = dataUrlBytes(attachment.content);
  if (!bytes) return { valid: false, reason: "invalid-data-url" };
  const detectedMime = detectBinaryMime(bytes);
  if (!detectedMime || detectedMime !== attachment.mimeType) {
    return { valid: false, reason: "mime-signature-mismatch", detectedMime };
  }
  if (attachment.kind === "image" && !detectedMime.startsWith("image/")) {
    return { valid: false, reason: "mime-signature-mismatch", detectedMime };
  }
  if (attachment.kind === "pdf" && detectedMime !== "application/pdf") {
    return { valid: false, reason: "mime-signature-mismatch", detectedMime };
  }
  return { valid: true, detectedMime };
}
