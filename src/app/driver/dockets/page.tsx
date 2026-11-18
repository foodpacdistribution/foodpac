import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { listDockets } from "@/lib/dockets";
import { getSettings } from "@/lib/planning";
import { todayIn } from "@/lib/time";
import { DocketsClient } from "./dockets-client";

export const metadata: Metadata = { title: "Invoices" };

export default async function DriverDocketsPage() {
  const user = await requireUser(["driver"]);
  const db = await getDb();
  const s = await getSettings(db);
  const today = todayIn(s.timezone);
  const dockets = user.driverId ? await listDockets(db, today, user.driverId) : [];
  return <DocketsClient today={today} linked={!!user.driverId} dockets={dockets} />;
}
