import { metrics } from "@/modules/observability/metrics";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(metrics.snapshot(), {
    headers: { "Cache-Control": "no-store" },
  });
}
