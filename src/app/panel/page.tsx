import type { Metadata } from "next";
import { connection } from "next/server";
import { PanelDashboard } from "@/components/demo/panel-dashboard";

export const metadata: Metadata = {
  title: "پیشخوان نمایشی لیارا",
  description: "شبیه‌سازی پیشخوان خالی لیارا و ورود مستقیم به دستیار.",
};

export default async function PanelPage() {
  await connection();
  return <PanelDashboard />;
}
