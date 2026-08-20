import { NextRequest } from "next/server";
import { chatRequestSchema } from "@/modules/chat/types";
import { streamAgentTurn, createModelAdapter } from "@/modules/agent/agent";
import { getDocsRetriever } from "@/modules/retrieval/docs-retriever";
import { chatRateLimiter } from "@/modules/infra/rate-limiter";
import { logEvent } from "@/modules/infra/logger";
import { metrics } from "@/modules/observability/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function sse(event: unknown) {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 16_000_000) {
    return Response.json({ message: "حجم درخواست بیشتر از حد مجاز است." }, { status: 413 });
  }
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const clientKey = forwarded || request.headers.get("x-real-ip") || "anonymous";
  const rate = chatRateLimiter.check(clientKey);
  if (!rate.allowed) {
    return Response.json(
      { message: `تعداد درخواست‌ها زیاد است. ${rate.retryAfterSeconds} ثانیه دیگر تلاش کنید.` },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ message: "ساختار درخواست معتبر نیست." }, { status: 400 });
  }
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { message: "پیام یا فایل ارسالی معتبر نیست.", issues: parsed.error.issues.length },
      { status: 422 },
    );
  }
  const configuredMaxBytes = Number(process.env.MAX_UPLOAD_BYTES ?? 10_485_760);
  const attachmentBytes = parsed.data.attachments.reduce((sum, attachment) => sum + attachment.size, 0);
  if (attachmentBytes > configuredMaxBytes) {
    return Response.json({ message: "مجموع حجم فایل‌ها بیشتر از حد مجاز است." }, { status: 413 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
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
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-RateLimit-Remaining-Minute": String(rate.remainingMinute),
    },
  });
}
