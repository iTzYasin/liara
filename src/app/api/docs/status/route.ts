import { getDocsRetriever } from "@/modules/retrieval/docs-retriever";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await getDocsRetriever().status());
}
