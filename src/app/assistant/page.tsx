import type { Metadata } from "next";
import { DemoAssistantGate } from "@/components/demo/demo-assistant-gate";

export const metadata: Metadata = {
  title: "دستیار لیارا | گفتگوی مستند",
  description: "ورود مستقیم از پیشخوان یا مستندات به دستیار فارسی لیارا.",
};

interface AssistantPageProps {
  searchParams: Promise<{ source?: string | string[] }>;
}

export default async function AssistantPage({ searchParams }: AssistantPageProps) {
  const params = await searchParams;
  const source = typeof params.source === "string" ? params.source : undefined;

  return <DemoAssistantGate source={source} />;
}
