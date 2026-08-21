import { getDocsRetriever } from "@/modules/retrieval/docs-retriever";

export const dynamic = "force-dynamic";

interface ModelProviderEnvironment {
  [key: string]: string | undefined;
  MODEL_PROVIDER?: string;
  AVALAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  DEMO_MODE?: string;
}

export function isModelProviderReady(
  environment: ModelProviderEnvironment = process.env,
) {
  if (environment.DEMO_MODE === "true") return true;
  const provider = environment.MODEL_PROVIDER ?? "gemini";
  if (provider === "avalai") return Boolean(environment.AVALAI_API_KEY);
  if (provider === "gemini") return Boolean(environment.GEMINI_API_KEY);
  return false;
}

export async function GET() {
  const docs = await getDocsRetriever().status();
  const providerReady = isModelProviderReady();
  const ready = docs.ready && providerReady;
  return Response.json(
    { status: ready ? "ready" : "not-ready", docs, providerReady },
    { status: ready ? 200 : 503 },
  );
}
