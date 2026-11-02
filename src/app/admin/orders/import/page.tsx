import type { Metadata } from "next";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/planning";
import { todayIn } from "@/lib/time";
import { ImportClient } from "./import-client";

export const metadata: Metadata = { title: "Import orders" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  await requireUser(STAFF);
  const { date } = await searchParams;
  const s = await getSettings(await getDb());
  return <ImportClient defaultDate={date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayIn(s.timezone)} />;
}
