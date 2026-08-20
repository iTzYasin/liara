import { z } from "zod";
import { logEvent } from "@/modules/infra/logger";
import { metrics } from "@/modules/observability/metrics";

const feedbackSchema = z.object({
  requestId: z.string().min(1).max(100),
  rating: z.enum(["up", "down"]),
  reason: z.enum(["incomplete", "irrelevant-source", "not-resolved", "unclear", "no-reason"]).optional(),
});

export async function POST(request: Request) {
  const parsed = feedbackSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false }, { status: 422 });
  logEvent("info", "feedback.received", {
    request_id: parsed.data.requestId,
    rating: parsed.data.rating,
    has_reason: Boolean(parsed.data.reason),
  });
  metrics.record({
    type: "feedback",
    rating: parsed.data.rating,
    reason: parsed.data.reason,
  });
  return Response.json({ ok: true });
}
