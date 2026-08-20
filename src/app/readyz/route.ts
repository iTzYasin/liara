import { getDocsRetriever } from "@/modules/retrieval/docs-retriever";

export const dynamic = "force-dynamic";

export async function GET() {
  const docs = await getDocsRetriever().status();
  const providerReady = Boolean(process.env.GEMINI_API_KEY) || process.env.DEMO_MODE !== "false";
  const ready = docs.ready && providerReady;
  return Response.json(
    { status: ready ? "ready" : "not-ready", docs, providerReady },
    { status: ready ? 200 : 503 },
  );
}
