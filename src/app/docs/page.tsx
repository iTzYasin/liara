import type { Metadata } from "next";
import { connection } from "next/server";
import { DocsPreview } from "@/components/demo/docs-preview";

export const metadata: Metadata = {
  title: "مستندات نمایشی لیارا",
  description: "شبیه‌سازی خانه مستندات لیارا و ورود مستقیم به دستیار مستندات.",
};

export default async function DocsPage() {
  await connection();
  return <DocsPreview />;
}
