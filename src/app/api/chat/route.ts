import { NextRequest } from "next/server";
import { chatRequestSchema } from "@/modules/chat/types";
import { streamAgentTurn } from "@/modules/agent/agent";
import { createModelAdapter } from "@/modules/agent/model-provider";
import { getDocsRetriever } from "@/modules/retrieval/docs-retriever";
import { chatRateLimiter } from "@/modules/infra/rate-limiter";
import { logEvent } from "@/modules/infra/logger";
import { metrics } from "@/modules/observability/metrics";
import {
  rateLimitKeys,
  resolveVisitorIdentity,
  serializeVisitorCookie,
  VISITOR_COOKIE_NAME,
} from "@/modules/infra/rate-limit-identity";
import { inspectAttachmentContent } from "@/modules/security/attachment-inspector";
import {
  isAllowedRequestOrigin,
  resolveApplicationOrigin,
} from "@/modules/security/request-origin";
import {
  readJsonBody,
  RequestBodyTooLargeError,
} from "@/modules/security/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function sse(event: unknown) {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function POST(request: NextRequest) {
  const trustedProxyHops = Number(process.env.TRUSTED_PROXY_HOPS ?? 0);
  const applicationOrigin = resolveApplicationOrigin(
    request.headers,
    request.nextUrl.protocol,
    trustedProxyHops,
  );
  if (!isAllowedRequestOrigin(request.headers.get("origin"), applicationOrigin)) {
    return Response.json({ message: "Origin درخواست مجاز نیست." }, { status: 403 });
  }
  const visitor = resolveVisitorIdentity(request.cookies.get(VISITOR_COOKIE_NAME)?.value);
  const rate = await chatRateLimiter.check(rateLimitKeys(visitor.id, request.headers, trustedProxyHops));
  const responseHeaders = (extra?: HeadersInit) => {
    const headers = new Headers(extra);
    headers.set("X-RateLimit-Remaining-Minute", String(rate.remainingMinute));
    headers.set("X-Chat-Limit-Remaining", String(rate.remainingMessages));
    headers.set("X-Chat-Limit-Reset", new Date(rate.resetsAt).toISOString());
    if (visitor.isNew) {
      headers.set(
        "Set-Cookie",
        serializeVisitorCookie(visitor, process.env.NODE_ENV === "production"),
      );
    }
    return headers;
  };
  const json = (body: unknown, status: number, headers?: HeadersInit) =>
    Response.json(body, { status, headers: responseHeaders(headers) });

  if (!rate.allowed) {
    const lockedUntil = new Date(rate.resetsAt).toISOString();
    return json(
      {
        code: "RATE_LIMITED",
        message: `سقف استفاده شما تکمیل شده است. ${rate.retryAfterSeconds} ثانیه دیگر دوباره می‌توانید پیام بفرستید.`,
        retryAfterSeconds: rate.retryAfterSeconds,
        lockedUntil,
      },
      429,
      {
        "Retry-After": String(rate.retryAfterSeconds),
        "X-Chat-Limit-Reset": lockedUntil,
      },
    );
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 16_000_000) {
    return json({ message: "حجم درخواست بیشتر از حد مجاز است." }, 413);
  }

  let body: unknown;
  try {
    body = await readJsonBody(request, 16_000_000);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json({ message: "حجم درخواست بیشتر از حد مجاز است." }, 413);
    }
    return json({ message: "ساختار درخواست معتبر نیست." }, 400);
  }
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { message: "پیام یا فایل ارسالی معتبر نیست.", issues: parsed.error.issues.length },
      422,
    );
  }
  const configuredMaxBytes = Number(process.env.MAX_UPLOAD_BYTES ?? 10_485_760);
  const attachmentBytes = parsed.data.attachments.reduce((sum, attachment) => sum + attachment.size, 0);
  if (attachmentBytes > configuredMaxBytes) {
    return json({ message: "مجموع حجم فایل‌ها بیشتر از حد مجاز است." }, 413);
  }
  const invalidAttachment = parsed.data.attachments.find((attachment) =>
    !inspectAttachmentContent(attachment).valid);
  if (invalidAttachment) {
    return json({
      message: `محتوای فایل «${invalidAttachment.name}» با نوع اعلام‌شده آن مطابقت ندارد.`,
    }, 415);
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(sse({
          type: "quota",
          remaining: rate.remainingMessages,
          resetsAt: new Date(rate.resetsAt).toISOString(),
        }));
        for await (const event of streamAgentTurn(parsed.data, {
          retriever: getDocsRetriever(),
          model: createModelAdapter(),
        })) {
          if (request.signal.aborted) break;
          controller.enqueue(sse(event));
        }
      } catch (error) {
        if (request.signal.aborted) return;
        logEvent("error", "chat.failed", {
          error_name: error instanceof Error ? error.name : "UnknownError",
        });
        metrics.record({ type: "chat.failed" });
        controller.enqueue(
          sse({
            type: "error",
            message: "پاسخ کامل نشد. پیام شما حفظ شده و می‌توانید دوباره تلاش کنید.",
            retryable: true,
          }),
        );
        controller.enqueue(sse({ type: "done" }));
      } finally {
        try {
          controller.close();
        } catch {
          // The browser may have already canceled and closed its SSE stream.
        }
      }
    },
  });

  return new Response(stream, {
    headers: responseHeaders({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    }),
  });
}
