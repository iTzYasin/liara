import type { Metadata } from "next";
import { connection } from "next/server";
import { DocsPreview } from "@/components/demo/docs-preview";

export const metadata: Metadata = {
  title: "مستندات لیارا",
  description: "مستندات سرویس‌های ابری لیارا و دسترسی مستقیم به دستیار مستندات.",
};

export default async function Home() {
  await connection();
  return <DocsPreview />;
}
